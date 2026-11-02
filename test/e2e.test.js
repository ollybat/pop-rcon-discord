import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildStore } from '../src/store.js';
import { ServerManager } from '../src/servers.js';
import { PresenceManager, STATE } from '../src/presence.js';
import { startMockRconServer } from './helpers/mock-rcon-server.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const presenceOptions = {
  enabled: true,
  intervalSeconds: 5,
  restingOnReconnect: false,
  formats: {
    online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
    offline: '🔴 RCON┆OFFLINE',
    resting: '🟡 RCON┆RESTING',
  },
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(check, timeoutMs = 4000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return true;
    await sleep(25);
  }
  return false;
}

test('the bot follows a Rust server end to end', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-e2e-'));
  const roster = [{ SteamID: '1', DisplayName: 'alpha', Ping: 20, ConnectedSeconds: 100 }];

  const mock = await startMockRconServer({
    onCommand(frame, socket) {
      const reply = (message) => socket.send(JSON.stringify({ Identifier: frame.Identifier, Message: message, Type: 'Generic', Stacktrace: null }));

      if (frame.Message === 'serverinfo') {
        reply(
          JSON.stringify({
            Players: roster.length,
            MaxPlayers: 100,
            Queued: 1,
            Joining: 2,
            Uptime: 1234,
            Restarting: false,
            Server: 'Spinback 5X EU',
          }),
        );
        return;
      }

      if (frame.Message === 'playerlist') {
        reply(JSON.stringify(roster));
        return;
      }

      reply('ok');
    },
  });

  const store = new GuildStore({ dir, logger: silentLogger });
  await store.save('guild-1', {
    roles: { owner: '111' },
    logs: { joinLeave: '222' },
    servers: [{ name: 'Spinback 5X EU', host: '127.0.0.1', port: mock.port, password: 'hunter2' }],
  });

  const changes = [];
  const manager = new ServerManager({
    store,
    logger: silentLogger,
    pollIntervalSeconds: 5,
    onChanges: (guildId, event) => changes.push({ guildId, ...event }),
  });

  t.after(async () => {
    await manager.stopAll();
    await mock.close();
    await rm(dir, { recursive: true, force: true });
  });

  await manager.syncGuild('guild-1');
  assert.equal(await waitFor(() => manager.monitorFor('guild-1', 1)?.connected), true, 'the monitor connects to the mock server');

  const [snapshot] = await manager.refreshGuild('guild-1');
  assert.equal(snapshot.connected, true);
  assert.equal(snapshot.info.players, 1);
  assert.equal(snapshot.info.max, 100);
  assert.equal(snapshot.info.hostname, 'Spinback 5X EU');
  assert.deepEqual(
    snapshot.players.map((player) => player.name),
    ['alpha'],
  );
  assert.equal(changes.length, 0, 'the first poll seeds the roster instead of reporting everyone as a join');

  roster.push({ SteamID: '2', DisplayName: 'bravo', Ping: 30, ConnectedSeconds: 10 });
  await manager.refreshGuild('guild-1');
  assert.equal(changes.length, 1);
  assert.deepEqual(
    changes[0].joined.map((player) => player.name),
    ['bravo'],
  );
  assert.equal(changes[0].server.name, 'Spinback 5X EU');

  roster.length = 0;
  await manager.refreshGuild('guild-1');
  assert.equal(changes.length, 2);
  assert.deepEqual(
    changes[1].left.map((player) => player.name).sort(),
    ['alpha', 'bravo'],
  );
  assert.ok(
    changes[1].left.every((player) => typeof player.sessionSeconds === 'number'),
    'a leave carries the session length',
  );

  const applied = [];
  const client = { user: { setPresence: (payload) => applied.push(payload) } };
  const presence = new PresenceManager({
    client,
    options: presenceOptions,
    logger: silentLogger,
    provider: async () => {
      const current = manager.monitorFor('guild-1', 1).snapshot;
      return { connected: current.connected, reconnecting: false, info: current.info };
    },
  });

  await presence.refresh();
  assert.equal(presence.state, STATE.ONLINE);
  assert.equal(applied.at(-1).activities[0].name, '🟢 RCON┆👥  0/100 ⏳1/2');

  // The server goes away: the presence falls back to offline.
  await mock.close();
  await waitFor(() => !manager.monitorFor('guild-1', 1).connected);
  await presence.refresh();
  assert.equal(presence.state, STATE.OFFLINE);
  assert.equal(applied.at(-1).activities[0].name, '🔴 RCON┆OFFLINE');
});
