import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActivityType } from 'discord.js';
import { PresenceManager, STATE, aggregateInfos, formatPresence, normalizeServerInfo, presenceFor } from '../src/presence.js';

const silentLogger = { info() {}, warn() {} };

const options = {
  enabled: true,
  intervalSeconds: 5,
  restingOnReconnect: false,
  formats: {
    online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
    offline: '🔴 RCON┆OFFLINE',
    resting: '🟡 RCON┆RESTING',
  },
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

test('presenceFor reports each of the three states', () => {
  const online = presenceFor(
    { connected: true, reconnecting: false, info: { players: 0, max: 100, queued: 1000, joining: 0, restarting: false } },
    options,
  );
  assert.equal(online.state, STATE.ONLINE);
  assert.equal(online.text, '🟢 RCON┆👥  0/100 ⏳1000/0');

  const offline = presenceFor({ connected: false, reconnecting: false, info: null }, options);
  assert.equal(offline.state, STATE.OFFLINE);
  assert.equal(offline.text, '🔴 RCON┆OFFLINE');

  const resting = presenceFor({ connected: true, reconnecting: false, info: { players: 1, max: 100, restarting: true } }, options);
  assert.equal(resting.state, STATE.RESTING);
  assert.equal(resting.text, '🟡 RCON┆RESTING');

  // Connected, but the server never answered serverinfo: there are no counts to show.
  assert.equal(presenceFor({ connected: true, reconnecting: false, info: null }, options).state, STATE.OFFLINE);
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
    activities: [{ name: '🔴 RCON┆OFFLINE', type: ActivityType.Watching }],
    status: 'dnd',
  });

  snapshot = { connected: true, reconnecting: false, info: { players: 4, max: 100, queued: 0, joining: 0, restarting: false } };
  await manager.refresh();
  assert.equal(manager.state, STATE.ONLINE);
  assert.equal(applied.at(-1).activities[0].name, '🟢 RCON┆👥  4/100 ⏳0/0');
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
