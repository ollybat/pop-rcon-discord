import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { WebSocketServer } from 'ws';
import { RustRconClient } from '../src/rcon.js';

const silentLogger = { info() {}, warn() {}, error() {} };

async function startFakeServer(onConnection) {
  const wss = new WebSocketServer({ port: 0 });
  await new Promise((resolve) => wss.once('listening', resolve));

  const port = wss.address().port;
  wss.on('connection', (socket, request) => onConnection(socket, request));

  return {
    port,
    close: () => {
      for (const socket of wss.clients) socket.terminate();
      return new Promise((resolve) => wss.close(resolve));
    },
  };
}

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
  const seen = {};
  const server = await startFakeServer((socket, request) => {
    seen.url = request.url;
  });
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());
  await client.connect();

  assert.equal(seen.url, '/hunter2');
  assert.equal(client.connected, true);
});

test('resolves a command reply by identifier', async (t) => {
  const server = await startFakeServer((socket) => {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: 'echo:' + frame.Message,
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    });
  });
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());
  await client.connect();

  const response = await client.send('server.info');
  assert.equal(response.message, 'echo:server.info');
  assert.equal(response.type, 'Generic');
});

test('sendJson parses JSON replies and falls back to null', async (t) => {
  const server = await startFakeServer((socket) => {
    socket.on('message', (raw) => {
      const frame = JSON.parse(raw.toString());
      const isList = frame.Message === 'playerlist';
      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: isList ? JSON.stringify([{ SteamID: '7656119', DisplayName: 'olly' }]) : 'ok',
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    });
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
  const server = await startFakeServer((socket) => {
    socket.send(
      JSON.stringify({ Identifier: 0, Message: 'hello world', Type: 'Chat', Stacktrace: null, Username: 'olly' }),
    );
  });
  t.after(() => server.close());

  const client = clientFor(server);
  t.after(() => client.close());

  const chatPromise = once(client, 'chat');
  await client.connect();
  const [chat] = await chatPromise;

  assert.equal(chat.message, 'hello world');
  assert.equal(chat.raw.Username, 'olly');
});

test('rejects when a command times out', async (t) => {
  const server = await startFakeServer(() => {});
  t.after(() => server.close());

  const client = clientFor(server, { timeoutMs: 150 });
  t.after(() => client.close());
  await client.connect();

  await assert.rejects(() => client.send('server.info'), /timed out/);
});

test('rejects commands while disconnected', async () => {
  const client = new RustRconClient({ host: '127.0.0.1', port: 1, password: 'x', autoReconnect: false, logger: silentLogger });
  await assert.rejects(() => client.send('server.info'), /Not connected/);
});
