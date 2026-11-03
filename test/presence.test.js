import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActivityType } from 'discord.js';
import { PresenceManager, STATE, aggregateInfos, formatPresence, normalizeServerInfo, presenceFor, struggling } from '../src/presence.js';
import { PRESENCE_LINES } from '../src/theme.js';

const silentLogger = { info() {}, warn() {} };

// The shipped lines, straight from the theme: if somebody edits the bio, these tests say so.
const options = {
  enabled: true,
  intervalSeconds: 5,
  restingOnReconnect: false,
  formats: PRESENCE_LINES,
};

test('formatPresence replaces known placeholders and keeps unknown ones', () => {
  assert.equal(
    formatPresence('{players}/{max} {queued}/{joining}', { players: 3, max: 100, queued: 1, joining: 0 }),
    '3/100 1/0',
  );
  assert.equal(formatPresence('{nope} {players}', { players: 7 }), '{nope} 7');
});

test('normalizeServerInfo fills in the fields the server omits', () => {
  assert.equal(normalizeServerInfo(null), null);
  assert.deepEqual(normalizeServerInfo({ Players: 5, MaxPlayers: 100, Queued: 2, Joining: 1, Restarting: true, Server: 'POP' }), {
    players: 5,
    max: 100,
    queued: 2,
    joining: 1,
    uptime: null,
    restarting: true,
    hostname: 'POP',
    map: null,
    framerate: null,
    entityCount: null,
    memory: null,
  });

  const rich = normalizeServerInfo({ Players: 5, MaxPlayers: 100, Map: 'Procedural Map', Framerate: 60, EntityCount: 1234, Memory: 4096 });
  assert.equal(rich.map, 'Procedural Map');
  assert.equal(rich.framerate, 60);
  assert.equal(rich.entityCount, 1234);
  assert.equal(rich.memory, 4096);
});

test('the bio is four lines and nothing else', () => {
  assert.deepEqual(PRESENCE_LINES, {
    online: '🟢 RCON ┆👥 {players}/{max}┆⏳Q: {queued}',
    offline: '🛑 RCON ┆ OFFLINE',
    resting: '⏳ RCON ┆ RESTING',
    problem: '⚠️ RCON ┆ PROBLEM',
  });
});

test('presenceFor reports each of the four states', () => {
  const online = presenceFor(
    { connected: true, reconnecting: false, info: { players: 0, max: 100, queued: 1000, joining: 0, restarting: false } },
    options,
  );
  assert.equal(online.state, STATE.ONLINE);
  assert.equal(online.text, '🟢 RCON ┆👥 0/100┆⏳Q: 1000');

  const offline = presenceFor({ connected: false, reconnecting: false, info: null }, options);
  assert.equal(offline.state, STATE.OFFLINE);
  assert.equal(offline.text, '🛑 RCON ┆ OFFLINE');

  const resting = presenceFor({ connected: true, reconnecting: false, info: { players: 1, max: 100, restarting: true } }, options);
  assert.equal(resting.state, STATE.RESTING);
  assert.equal(resting.text, '⏳ RCON ┆ RESTING');

  // Connected, but the server never answered serverinfo: that is the ⚠️ state, not silence.
  const quiet = presenceFor({ connected: true, reconnecting: false, info: null }, options);
  assert.equal(quiet.state, STATE.PROBLEM);
  assert.equal(quiet.text, '⚠️ RCON ┆ PROBLEM');
});

test('struggling spots a server that answers but is not well', () => {
  const base = { connected: true, reconnecting: false, latencyMs: 40 };

  assert.equal(struggling({ ...base, info: { players: 3, max: 100, framerate: 60 } }), false);
  assert.equal(struggling({ ...base, info: null }), true, 'RCON up, serverinfo silent');
  assert.equal(struggling({ ...base, info: { players: 3, max: 100, framerate: 4 } }), true, 'a map at four frames a second');
  assert.equal(struggling({ ...base, latencyMs: 4000, info: { players: 3, max: 100, framerate: 60 } }), true, 'a slow RCON round-trip');
  assert.equal(struggling({ connected: false, reconnecting: false, info: null }), false, 'offline is its own line');
  assert.equal(struggling({ ...base, info: { players: 3, max: 100, framerate: 0 } }), false, 'Rust reports 0 fps while loading; that is not a verdict');
});

test('the PROBLEM line only appears when the mode is on', () => {
  const strained = { connected: true, reconnecting: false, latencyMs: 5000, info: { players: 3, max: 100, queued: 0, framerate: 60, restarting: false } };

  assert.equal(presenceFor(strained, options).state, STATE.PROBLEM);
  assert.equal(presenceFor(strained, options).text, '⚠️ RCON ┆ PROBLEM');

  const off = presenceFor(strained, { ...options, problem: false });
  assert.equal(off.state, STATE.ONLINE, 'with the mode off a slow server still reads as online');
  assert.equal(off.text, '🟢 RCON ┆👥 3/100┆⏳Q: 0');

  // With the mode off, a socket that never answers falls back to the offline line.
  const silent = { connected: true, reconnecting: false, info: null };
  assert.equal(presenceFor(silent, { ...options, problem: false }).state, STATE.OFFLINE);
});

test('restingOnReconnect shows the yellow state while the client backs off', () => {
  const result = presenceFor({ connected: false, reconnecting: true, info: null }, { ...options, restingOnReconnect: true });
  assert.equal(result.state, STATE.RESTING);
});

test('aggregateInfos adds every online server together', () => {
  const infos = aggregateInfos([
    { connected: true, info: { players: 3, max: 100, queued: 1, joining: 0, uptime: 900, restarting: false, hostname: 'A' } },
    { connected: true, info: { players: 4, max: 200, queued: 0, joining: 2, uptime: 300, restarting: false, hostname: 'B' } },
    { connected: false, info: null },
  ]);

  assert.equal(infos.players, 7);
  assert.equal(infos.max, 300);
  assert.equal(infos.queued, 1);
  assert.equal(infos.joining, 2);
  assert.equal(infos.uptime, 300);
  assert.equal(infos.servers, 2);
  assert.equal(infos.map, null, 'a summed view has no single map');
  assert.equal(infos.entityCount, 0);
  assert.equal(aggregateInfos([]), null);
  assert.equal(aggregateInfos([{ connected: false, info: null }]), null);
});

test('PresenceManager pushes a Watching activity and only re-pushes on change', async () => {
  const applied = [];
  const client = { user: { setPresence: (payload) => applied.push(payload) } };

  let snapshot = { connected: false, reconnecting: false, info: null };
  const manager = new PresenceManager({ client, provider: async () => snapshot, options, logger: silentLogger });

  await manager.refresh();
  assert.equal(manager.state, STATE.OFFLINE);
  assert.deepEqual(applied.at(-1), {
    activities: [{ name: '🛑 RCON ┆ OFFLINE', type: ActivityType.Watching }],
    status: 'dnd',
  });

  snapshot = { connected: true, reconnecting: false, info: { players: 4, max: 100, queued: 0, joining: 0, restarting: false } };
  await manager.refresh();
  assert.equal(manager.state, STATE.ONLINE);
  assert.equal(applied.at(-1).activities[0].name, '🟢 RCON ┆👥 4/100┆⏳Q: 0');
  assert.equal(applied.at(-1).status, 'online');

  const pushes = applied.length;
  await manager.refresh();
  assert.equal(applied.length, pushes, 'an unchanged state must not be re-pushed');

  snapshot = { connected: true, reconnecting: false, info: { players: 5, max: 100, queued: 0, joining: 0, restarting: false } };
  await manager.refresh();
  assert.equal(applied.length, pushes + 1, 'a changed player count is a new activity name');

  snapshot = { connected: false, reconnecting: false, info: null };
  await manager.refresh();
  assert.equal(manager.state, STATE.OFFLINE);
});

test('PresenceManager survives a provider that throws', async () => {
  const applied = [];
  const client = { user: { setPresence: (payload) => applied.push(payload) } };
  const manager = new PresenceManager({
    client,
    provider: async () => {
      throw new Error('socket exploded');
    },
    options,
    logger: silentLogger,
  });

  await manager.refresh();
  assert.equal(manager.state, STATE.OFFLINE);
  assert.equal(applied.length, 1);
});

test('the label never rotates: one server, one line', async () => {
  const applied = [];
  const manager = new PresenceManager({
    client: { user: { setPresence: (payload) => applied.push(payload) } },
    logger: silentLogger,
    options,
    provider: async () => ({ connected: true, reconnecting: false, info: { players: 7, max: 100, queued: 2, restarting: false } }),
  });

  for (let pass = 0; pass < 4; pass += 1) await manager.refresh();

  assert.equal(applied.length, 1, 'a line that did not change is never re-pushed');
  assert.equal(applied[0].activities[0].name, '🟢 RCON ┆👥 7/100┆⏳Q: 2');
});

test('the PROBLEM switch is read on every poll, so /setup applies at once', async () => {
  const applied = [];
  let problem = false;
  const strained = { connected: true, reconnecting: false, latencyMs: 5000, info: { players: 2, max: 100, queued: 0, framerate: 60, restarting: false } };
  const manager = new PresenceManager({
    client: { user: { setPresence: (payload) => applied.push(payload) } },
    logger: silentLogger,
    options: { ...options, problem: () => problem },
    provider: async () => strained,
  });

  await manager.refresh();
  assert.equal(manager.state, STATE.ONLINE);

  problem = true;
  await manager.refresh();
  assert.equal(manager.state, STATE.PROBLEM);
  assert.equal(applied.at(-1).activities[0].name, '⚠️ RCON ┆ PROBLEM');
  assert.equal(applied.at(-1).status, 'idle');

  problem = false;
  await manager.refresh();
  assert.equal(manager.state, STATE.ONLINE);
});
