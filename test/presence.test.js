import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ActivityType } from 'discord.js';
import { PresenceManager, STATE, formatPresence, normalizeServerInfo, presenceFor } from '../src/presence.js';

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
  assert.deepEqual(
    normalizeServerInfo({ Players: 5, MaxPlayers: 100, Queued: 2, Joining: 1, Restarting: true, Server: 'POP' }),
    { players: 5, max: 100, queued: 2, joining: 1, uptime: null, restarting: true, hostname: 'POP' },
  );
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

  const resting = presenceFor(
    { connected: true, reconnecting: false, info: { players: 1, max: 100, restarting: true } },
    options,
  );
  assert.equal(resting.state, STATE.RESTING);
  assert.equal(resting.text, '🟡 RCON┆RESTING');

  // connected, but the server never answered serverinfo: no counts to show
  assert.equal(presenceFor({ connected: true, reconnecting: false, info: null }, options).state, STATE.OFFLINE);
});

test('restingOnReconnect shows the yellow state while the client backs off', () => {
  const result = presenceFor({ connected: false, reconnecting: true, info: null }, { ...options, restingOnReconnect: true });
  assert.equal(result.state, STATE.RESTING);
});

test('PresenceManager pushes a Watching activity and only re-pushes on change', async () => {
  const applied = [];
  const client = { user: { setPresence: (payload) => applied.push(payload) } };
  const listeners = {};
  const rcon = {
    connected: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    on(event, handler) {
      listeners[event] = handler;
    },
    async sendJson(command) {
      assert.equal(command, 'serverinfo');
      return { data: { Players: 4, MaxPlayers: 100, Queued: 0, Joining: 0, Server: 'POP' } };
    },
  };

  const manager = new PresenceManager({ client, rcon, options, logger: silentLogger });

  await manager.refresh();
  assert.equal(manager.state, STATE.OFFLINE);
  assert.deepEqual(applied.at(-1), {
    activities: [{ name: '🔴 RCON┆OFFLINE', type: ActivityType.Watching }],
    status: 'dnd',
  });

  rcon.connected = true;
  await manager.refresh();
  assert.equal(manager.state, STATE.ONLINE);
  assert.equal(applied.at(-1).activities[0].name, '🟢 RCON┆👥  4/100 ⏳0/0');
  assert.equal(applied.at(-1).status, 'online');

  const pushes = applied.length;
  await manager.refresh();
  assert.equal(applied.length, pushes, 'an unchanged state must not be re-pushed');

  rcon.connected = false;
  await manager.refresh();
  assert.equal(manager.state, STATE.OFFLINE);
  assert.equal(applied.length, pushes + 1);
});
