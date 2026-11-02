import assert from 'node:assert/strict';
import { once } from 'node:events';
import { test } from 'node:test';
import { PresenceManager, STATE } from '../src/presence.js';
import { RustRconClient } from '../src/rcon.js';
import { ChannelRelay, formatChatMessage } from '../src/relay.js';
import { startMockRconServer } from './helpers/mock-rcon-server.js';

const silentLogger = { info() {}, warn() {}, error() {} };

const formats = {
  online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
  offline: '🔴 RCON┆OFFLINE',
  resting: '🟡 RCON┆RESTING',
};

function presenceOptions(overrides = {}) {
  return { enabled: true, intervalSeconds: 60, restingOnReconnect: false, formats, ...overrides };
}

function fakeDiscord() {
  const sent = [];
  const presence = [];
  const channel = {
    isTextBased: () => true,
    send: async (content) => {
      sent.push(content);
    },
  };

  return {
    sent,
    presence,
    client: {
      channels: { fetch: async () => channel },
      user: { setPresence: (payload) => presence.push(payload) },
    },
  };
}

test('a live server turns the status green and its chat reaches the channel', async (t) => {
  const server = await startMockRconServer({
    onCommand(frame, socket) {
      const isInfo = frame.Message === 'serverinfo';
      const payload = isInfo
        ? { Server: 'POP', Players: 12, MaxPlayers: 100, Queued: 0, Joining: 3 }
        : { players: [] };

      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: JSON.stringify(payload),
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    },
  });
  t.after(() => server.close());

  const discord = fakeDiscord();
  const rcon = new RustRconClient({
    host: '127.0.0.1',
    port: server.port,
    password: 'hunter2',
    autoReconnect: false,
    timeoutMs: 2000,
    logger: silentLogger,
  });
  t.after(() => rcon.close());

  const relay = new ChannelRelay({ client: discord.client, channelId: '4242', logger: silentLogger });
  const presence = new PresenceManager({ client: discord.client, rcon, options: presenceOptions(), logger: silentLogger });

  rcon.on('connected', () => relay.rconConnected(rcon.target).catch(() => {}));
  rcon.on('disconnected', (info) => relay.rconDisconnected(info).catch(() => {}));
  rcon.on('chat', (payload) => relay.chat(payload).catch(() => {}));

  const chatSeen = once(rcon, 'chat');

  await rcon.connect();
  await presence.refresh();

  assert.equal(presence.state, STATE.ONLINE);
  assert.equal(presence.text, '🟢 RCON┆👥  12/100 ⏳0/3');
  assert.equal(discord.presence.at(-1).activities[0].name, '🟢 RCON┆👥  12/100 ⏳0/3');
  assert.equal(discord.presence.at(-1).status, 'online');
  assert.equal(discord.sent[0].embeds.length, 1);

  server.broadcast({
    Identifier: 0,
    Message: 'hello world',
    Type: 'Chat',
    Stacktrace: null,
    Username: 'olly',
    Channel: 'global',
  });

  await chatSeen;
  await new Promise((resolve) => setTimeout(resolve, 25));

  assert.ok(
    discord.sent.some((entry) => entry === '**[global] olly:** hello world'),
    'the chat line should be posted verbatim',
  );
});

test('a restarting server reports the yellow state', async (t) => {
  const server = await startMockRconServer({
    onCommand(frame, socket) {
      socket.send(
        JSON.stringify({
          Identifier: frame.Identifier,
          Message: JSON.stringify({ Server: 'POP', Players: 0, MaxPlayers: 100, Restarting: true }),
          Type: 'Generic',
          Stacktrace: null,
        }),
      );
    },
  });
  t.after(() => server.close());

  const discord = fakeDiscord();
  const rcon = new RustRconClient({
    host: '127.0.0.1',
    port: server.port,
    password: 'hunter2',
    autoReconnect: false,
    logger: silentLogger,
  });
  t.after(() => rcon.close());

  const presence = new PresenceManager({ client: discord.client, rcon, options: presenceOptions(), logger: silentLogger });

  await rcon.connect();
  await presence.refresh();

  assert.equal(presence.state, STATE.RESTING);
  assert.equal(discord.presence.at(-1).activities[0].name, '🟡 RCON┆RESTING');
  assert.equal(discord.presence.at(-1).status, 'idle');
});

test('the status is red while the socket is down', async () => {
  const discord = fakeDiscord();
  const rcon = {
    connected: false,
    reconnectAttempts: 0,
    reconnectTimer: null,
    on() {},
    async sendJson() {
      throw new Error('serverinfo must not be requested while disconnected');
    },
  };

  const presence = new PresenceManager({ client: discord.client, rcon, options: presenceOptions(), logger: silentLogger });
  await presence.refresh();

  assert.equal(presence.state, STATE.OFFLINE);
  assert.equal(discord.presence.at(-1).activities[0].name, '🔴 RCON┆OFFLINE');
  assert.equal(discord.presence.at(-1).status, 'dnd');
});

test('the relay does nothing without a channel id', async () => {
  const discord = fakeDiscord();
  const relay = new ChannelRelay({ client: discord.client, channelId: null, logger: silentLogger });

  assert.equal(relay.enabled, false);
  assert.equal(await relay.send('nope'), false);
  assert.equal(discord.sent.length, 0);
});

test('formatChatMessage falls back for missing fields', () => {
  assert.equal(formatChatMessage({ message: 'hi', raw: {} }), '**[global] unknown:** hi');
  assert.equal(formatChatMessage({ message: 'hi' }), '**[global] unknown:** hi');
});
