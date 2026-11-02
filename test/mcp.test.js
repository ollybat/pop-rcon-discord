import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import {
  TOOL_DEFINITIONS,
  bar,
  createSession,
  handleMessage,
  human,
  loadServers,
  normalizeServerInfo,
  pickServer,
  stderrLogger,
  toPlayerList,
} from '../mcp/server.js';

const silent = () => stderrLogger({ write() {} });

test('every tool is documented and has a strict schema', () => {
  const names = TOOL_DEFINITIONS.map((tool) => tool.name);
  assert.deepEqual(names, ['list_servers', 'server_status', 'players', 'pop_report', 'records', 'server_save', 'broadcast', 'rcon']);

  for (const tool of TOOL_DEFINITIONS) {
    assert.ok(tool.description.length > 20, tool.name + ' needs a description');
    assert.equal(tool.inputSchema.type, 'object');
    assert.equal(tool.inputSchema.additionalProperties, false);
  }

  assert.deepEqual(TOOL_DEFINITIONS.find((tool) => tool.name === 'broadcast').inputSchema.required, ['message']);
});

test('loadServers reads what /setup saved, plus the environment fallback', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spinback-mcp-'));
  await mkdir(join(dir, 'guilds'), { recursive: true });
  await writeFile(
    join(dir, 'guilds', '111.json'),
    JSON.stringify({
      servers: [{ name: 'Spinback 5X EU', host: '127.0.0.1', port: 28020, password: 'secret' }, null, null],
      stats: { 1: { day: '2026-11-02', peak: 63, peakAt: null, best: { peak: 63, day: '2026-11-02', at: null }, days: { '2026-11-02': 63 } } },
    }),
  );

  const servers = loadServers({ dataDir: dir, env: { RCON_HOST: '10.0.0.1', RCON_PORT: '28016', RCON_PASSWORD: 'pw', RCON_NAME: 'Env server' } });

  assert.equal(servers.length, 2);
  assert.equal(servers[0].key, '111:1');
  assert.equal(servers[0].name, 'Spinback 5X EU');
  assert.equal(servers[0].port, 28020);
  assert.equal(servers[0].stats.peak, 63);
  assert.equal(servers[1].key, 'env:1');
  assert.equal(servers[1].host, '10.0.0.1');
  assert.equal(servers[1].name, 'Env server');

  await rm(dir, { recursive: true, force: true });
});

test('loadServers copes with an empty or broken data directory', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'spinback-mcp-'));
  await mkdir(join(dir, 'guilds'), { recursive: true });
  await writeFile(join(dir, 'guilds', 'broken.json'), '{ this is not json');
  await writeFile(join(dir, 'guilds', 'empty.json'), JSON.stringify({ servers: [null, null, null] }));

  assert.deepEqual(loadServers({ dataDir: dir, env: {} }), []);
  assert.deepEqual(loadServers({ dataDir: join(dir, 'nope'), env: {} }), []);

  await rm(dir, { recursive: true, force: true });
});

test('pickServer understands keys, slots and partial names', () => {
  const servers = [
    { key: '111:1', slot: 1, name: 'Spinback 5X EU', host: '10.0.0.1', guildId: '111' },
    { key: '222:2', slot: 2, name: 'Backup', host: '10.0.0.2', guildId: '222' },
  ];

  assert.equal(pickServer(servers, '111:1').server.name, 'Spinback 5X EU');
  assert.equal(pickServer(servers, '2').server.name, 'Backup');
  assert.equal(pickServer(servers, '5X').server.key, '111:1');
  assert.equal(pickServer(servers, '10.0.0.2').server.key, '222:2');
  assert.equal(pickServer(servers, null).server.key, '111:1');
  assert.match(pickServer(servers, 'nowhere').error, /No server matches/);
  assert.match(pickServer([], null).error, /No Rust servers are configured/);

  const ambiguous = [{ key: 'a:1', slot: 1, name: 'A', host: 'h1' }, { key: 'b:1', slot: 1, name: 'B', host: 'h2' }];
  assert.match(pickServer(ambiguous, '1').error, /more than one server/);
});

test('the session answers tool calls even with nothing configured', async () => {
  const session = createSession({ servers: [], options: { logger: silent() } });

  assert.equal(session.listTools().length, TOOL_DEFINITIONS.length);
  for (const tool of session.listTools()) assert.ok(!('handler' in tool), 'handlers must stay private');

  const status = await session.callTool('server_status', {});
  assert.match(status.content[0].text, /No Rust servers are configured/);

  const records = await session.callTool('records', {});
  assert.match(records.content[0].text, /No Rust servers are configured/);

  const raw = await session.callTool('rcon', { command: 'serverinfo' });
  assert.match(raw.content[0].text, /--allow-rcon/);

  const unknown = await session.callTool('nope', {});
  assert.equal(unknown.isError, true);

  await session.close();
});

test('handleMessage speaks JSON-RPC 2.0', async () => {
  const session = createSession({ servers: [], options: { logger: silent() } });

  const init = await handleMessage(session, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} });
  assert.equal(init.jsonrpc, '2.0');
  assert.equal(init.result.serverInfo.name, 'spinback');
  assert.equal(init.result.protocolVersion, '2024-11-05');
  assert.ok(init.result.instructions.includes('list_servers'));

  assert.equal(await handleMessage(session, { jsonrpc: '2.0', method: 'notifications/initialized' }), null, 'notifications get no reply');

  const pong = await handleMessage(session, { jsonrpc: '2.0', id: 2, method: 'ping' });
  assert.deepEqual(pong.result, {});

  const list = await handleMessage(session, { jsonrpc: '2.0', id: 3, method: 'tools/list' });
  assert.equal(list.result.tools.length, TOOL_DEFINITIONS.length);

  const call = await handleMessage(session, {
    jsonrpc: '2.0',
    id: 4,
    method: 'tools/call',
    params: { name: 'list_servers', arguments: {} },
  });
  assert.match(call.result.content[0].text, /No Rust servers are configured/);

  const missing = await handleMessage(session, { jsonrpc: '2.0', id: 5, method: 'does/not/exist' });
  assert.equal(missing.error.code, -32601);
  assert.match(missing.error.message, /does\/not\/exist/);

  const broken = await handleMessage(session, { id: 6 });
  assert.equal(broken.error.code, -32600);

  await session.close();
});

test('the helpers match what Rust actually returns', () => {
  const info = normalizeServerInfo({ Players: 5, MaxPlayers: 100, Queued: '2', Joining: 1, Restarting: true, Uptime: 3600, Hostname: 'Spinback 5X EU', Map: 'Procedural Map' });
  assert.equal(info.players, 5);
  assert.equal(info.max, 100);
  assert.equal(info.queued, 2);
  assert.equal(info.restarting, true);
  assert.equal(info.hostname, 'Spinback 5X EU');
  assert.equal(normalizeServerInfo(null), null);

  const players = toPlayerList([
    { SteamID: '76561198', DisplayName: 'Zed', Ping: 40, ConnectedSeconds: 3660 },
    { SteamID: '76561199', DisplayName: 'Ann', Ping: 12, ConnectedSeconds: 60 },
  ]);
  assert.deepEqual(
    players.map((player) => player.name),
    ['Ann', 'Zed'],
    'sorted by name',
  );
  assert.equal(players[1].seconds, 3660);
  assert.deepEqual(toPlayerList(null), []);
  assert.deepEqual(toPlayerList({ nope: true }), []);

  assert.equal(human(3660), '1h 1m');
  assert.equal(human(null), 'unknown');
  assert.equal(bar(50, 100, 10), '#####.....');
  assert.equal(bar(0, 0, 4), '....');
});

test('a raw fetch against a dead port fails cleanly instead of hanging forever', async () => {
  const session = createSession({
    servers: [{ key: 'test:1', slot: 1, name: 'Dead', host: '127.0.0.1', port: 1, password: 'x', guildId: null }],
    options: { logger: silent(), allowAnyRcon: false },
  });

  const result = await session.callTool('server_status', {});
  assert.equal(result.isError, undefined, 'the tool itself does not throw');
  assert.match(result.content[0].text, /ECONNREFUSED|could not|Could not/i);

  await session.close();
});
