import assert from 'node:assert/strict';
import { test } from 'node:test';
import { capEvents, diffPlayers, effectiveServers, playerId, serverSignature, toPlayerList } from '../src/servers.js';

test('toPlayerList normalises the JSON playerlist reply', () => {
  assert.deepEqual(toPlayerList(null), []);
  assert.deepEqual(
    toPlayerList([
      { SteamID: '76561198000000002', DisplayName: 'bravo', Ping: 42, ConnectedSeconds: 90 },
      { SteamID: '76561198000000001', DisplayName: 'alpha', Ping: '7', ConnectedSeconds: '3' },
    ]),
    [
      { id: '76561198000000001', name: 'alpha', ping: 7, seconds: 3 },
      { id: '76561198000000002', name: 'bravo', ping: 42, seconds: 90 },
    ],
  );
});

test('playerId falls back to the display name when there is no SteamID', () => {
  assert.equal(playerId({ SteamID: '1' }), '1');
  assert.equal(playerId({ SteamId: '2' }), '2');
  assert.equal(playerId({ DisplayName: 'ghost' }), 'name:ghost');
  assert.equal(playerId({}), 'unknown');
});

test('diffPlayers reports who joined and who left', () => {
  const previous = new Map([
    ['1', { id: '1', name: 'alpha' }],
    ['2', { id: '2', name: 'bravo' }],
  ]);
  const current = [
    { id: '2', name: 'bravo' },
    { id: '3', name: 'charlie' },
  ];

  const changes = diffPlayers(previous, current);
  assert.deepEqual(
    changes.joined.map((player) => player.name),
    ['charlie'],
  );
  assert.deepEqual(
    changes.left.map((player) => player.name),
    ['alpha'],
  );
});

test('capEvents collapses a restart-sized change into one summary', () => {
  const small = capEvents({ joined: [{ id: '1' }], left: [] });
  assert.equal(small.massChange, false);
  assert.equal(small.total, 1);
  assert.equal(small.joined.length, 1);

  const big = capEvents({ joined: Array.from({ length: 12 }, (_, index) => ({ id: String(index) })), left: [] });
  assert.equal(big.massChange, true);
  assert.equal(big.joined.length, 0);
  assert.equal(big.joinedCount, 12);
  assert.equal(big.overflow, 4);
});

test('effectiveServers puts the .env server in slot 1 only when slot 1 is empty', () => {
  const envServer = { name: 'From env', host: '10.0.0.1', port: 28016, password: 'p' };

  const empty = effectiveServers({ servers: [null, null, null] }, envServer);
  assert.equal(empty.length, 1);
  assert.equal(empty[0].slot, 1);
  assert.equal(empty[0].fromEnv, true);

  const saved = effectiveServers(
    { servers: [{ name: 'Saved', host: '10.0.0.2', port: 28016, password: 'p' }, null, null] },
    envServer,
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].name, 'Saved');
  assert.equal(saved[0].fromEnv, undefined);

  const both = effectiveServers(
    { servers: [null, { name: 'Slot two', host: '10.0.0.3', port: 28016, password: 'p' }, null] },
    envServer,
  );
  assert.deepEqual(
    both.map((server) => server.slot),
    [1, 2],
  );
});

test('serverSignature changes when a server changes', () => {
  const a = serverSignature([{ slot: 1, host: 'h', port: 1, password: 'p', name: 'n' }]);
  const b = serverSignature([{ slot: 1, host: 'h', port: 2, password: 'p', name: 'n' }]);
  assert.notEqual(a, b);
  assert.equal(a, serverSignature([{ slot: 1, host: 'h', port: 1, password: 'p', name: 'n' }]));
});

test('a poll diffs the roster, not the internal map', async () => {
  // A monitor that polls the same roster twice must report no changes at all. Passing the player
  // Map to diffPlayers instead of the array reported every player as leaving and joining.
  const { ServerMonitor } = await import('../src/servers.js');
  const monitor = new ServerMonitor({
    guildId: 'guild-1',
    server: { slot: 1, name: 'Spinback 5X EU', host: '127.0.0.1', port: 28016, password: 'x' },
    pollIntervalMs: 60000,
    logger: silentLogger,
  });

  const events = [];
  monitor.onChanges = (changes) => events.push(changes);

  const players = [{ id: '1', name: 'alpha', ping: 20, seconds: 100 }];
  monitor.rcon = {
    connected: true,
    sendJson: async (command) =>
      command === 'serverinfo'
        ? { data: { Players: 1, MaxPlayers: 100, Queued: 0, Joining: 0, Uptime: 60, Restarting: false, Server: 'Spinback 5X EU' } }
        : { data: [{ SteamID: '1', DisplayName: 'alpha', Ping: 20, ConnectedSeconds: 100 }] },
  };

  await monitor.refresh();
  assert.equal(monitor.seeded, true, 'the first poll seeds');
  assert.equal(events.length, 0, 'nothing is reported out of the first poll');

  await monitor.refresh();
  assert.deepEqual(events, [], 'a second poll of the same roster is silent');
  assert.deepEqual([...monitor.players.keys()], ['1']);
});
