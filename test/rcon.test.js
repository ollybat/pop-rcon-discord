import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { RustRconClient } from '../src/rcon.js';
import { startMockRconServer } from './helpers/mock-rcon-server.js';

const silentLogger = { info() {}, warn() {}, error() {} };

function clientFor(server, overrides = {}) {
  return new RustRconClient({
    host: '127.0.0.1',
    port: server.port,
    password: 'hunter2',
    autoReconnect: false,
    timeoutMs: 2000,
    logger: silentLogger,
    ...overrides,
  });
}

test('authenticates with the password in the URL path', async (t) => {
  const server = await startMockRconServer();
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());
  await client.connect();

  assert.equal(server.state.paths[0], '/hunter2');
  assert.equal(client.connected, true);
});

test('resolves a command reply by identifier', async (t) => {
  const server = await startMockRconServer({
    onCommand(frame, socket) {
      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: 'echo:' + frame.Message,
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    },
  });
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());
  await client.connect();

  const response = await client.send('server.info');
  assert.equal(response.message, 'echo:server.info');
  assert.equal(response.type, 'Generic');
  assert.equal(server.state.requests[0].Name, 'WebRcon');
});

test('sendJson parses JSON replies and falls back to null', async (t) => {
  const server = await startMockRconServer({
    onCommand(frame, socket) {
      const isList = frame.Message === 'playerlist';
      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: isList ? JSON.stringify([{ SteamID: '7656119', DisplayName: 'olly' }]) : 'ok',
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    },
  });
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());
  await client.connect();

  const players = await client.sendJson('playerlist');
  assert.deepEqual(players.data, [{ SteamID: '7656119', DisplayName: 'olly' }]);

  const plain = await client.sendJson('say hi');
  assert.equal(plain.data, null);
  assert.equal(plain.message, 'ok');
});

test('emits chat broadcasts that carry no identifier', async (t) => {
  const server = await startMockRconServer();
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());

  const chatPromise = once(client, 'chat');
  await client.connect();

  server.broadcast({
    Identifier: 0,
    Message: 'hello world',
    Type: 'Chat',
    Stacktrace: null,
    Username: 'olly',
    Channel: 'global',
  });

  const [chat] = await chatPromise;
  assert.equal(chat.message, 'hello world');
  assert.equal(chat.raw.Username, 'olly');
});

test('rejects when a command times out', async (t) => {
  const server = await startMockRconServer({ onCommand() {} });
  t.after(() => server.close());

  const client = clientFor(server, { timeoutMs: 150 });
  t.after(() => client.close());
  await client.connect();

  await assert.rejects(() => client.send('server.info'), /timed out/);
});

test('rejects commands while disconnected', async () => {
  const client = new RustRconClient({
    host: '127.0.0.1',
    port: 1,
    password: 'x',
    autoReconnect: false,
    logger: silentLogger,
  });

  await assert.rejects(() => client.send('server.info'), /Not connected/);
});

test('reconnects on its own after the server drops the connection', async (t) => {
  const server = await startMockRconServer();
  t.after(() => server.close());

  const client = clientFor(server, { autoReconnect: true, maxReconnectDelayMs: 250 });
  t.after(() => client.close());
  await client.connect();

  const dropped = once(client, 'disconnected');
  const back = once(client, 'connected');

  server.dropAll();
  await dropped;
  await back;

  assert.equal(client.connected, true);
  assert.equal(server.state.connections, 2);
});

test('close() stops the reconnect loop', async (t) => {
  const server = await startMockRconServer();
  t.after(() => server.close());

  const client = clientFor(server, { autoReconnect: true, maxReconnectDelayMs: 100 });
  await client.connect();
  await client.close();
  await new Promise((resolve) => setTimeout(resolve, 300));

  assert.equal(server.state.connections, 1, 'a closed client must not dial again');
});
