import assert from 'node:assert/strict';
import { test } from 'node:test';
import { boardKey, boardNote, createBoardManager } from '../src/board.js';
import { normalizeGuildConfig } from '../src/store.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function snapshot(slot, players = 5, connected = true) {
  return {
    slot,
    name: 'Server ' + slot,
    host: '127.0.0.1',
    port: 28016,
    connected,
    info: connected ? { players, max: 100, queued: 0, joining: 0, uptime: 60, restarting: false, hostname: 'S' + slot } : null,
    players: [],
    error: connected ? null : 'ECONNREFUSED',
  };
}

/** A store whose get() returns a real normalized config and remembers updates. */
function makeStore(guildId, { board = {}, alerts = { enabled: true } } = {}) {
  let config = normalizeGuildConfig({ guildId, servers: [{ name: 'S', host: 'h', port: 28016, password: 'secret' }], board, alerts }, guildId);
  const calls = [];
  return {
    calls,
    get: () => config,
    listGuildIds: () => [guildId],
    update: async (id, fn) => {
      calls.push('update');
      config = fn(config);
      return config;
    },
    set: (next) => { config = next; },
  };
}

/** A client with one channel whose messages can be fetched, edited, deleted or missing. */
function makeClient({ channelId = 'chan', missing = false, sendFails = false, editFails = false } = {}) {
  const sent = [];
  const edits = [];
  const message = {
    id: 'msg-1',
    edit: async (payload) => {
      if (editFails) throw new Error('no permission');
      edits.push(payload);
      return message;
    },
  };

  const channel = {
    id: channelId,
    send: async (payload) => {
      if (sendFails) throw new Error('no permission');
      sent.push(payload);
      return message;
    },
    messages: {
      fetch: async (id) => {
        if (missing) throw new Error('Unknown Message');
        return message;
      },
    },
  };

  return {
    client: { channels: { fetch: async () => channel, cache: new Map([[channelId, channel]]) } },
    sent,
    edits,
    message,
  };
}

function makeServers(snapshots) {
  return { snapshots: () => snapshots };
}

test('boardKey changes only when a number a reader would notice changes', () => {
  const a = boardKey([snapshot(1, 5), snapshot(2, 2)]);
  assert.equal(a, boardKey([snapshot(1, 5), snapshot(2, 2)]));
  assert.notEqual(a, boardKey([snapshot(1, 6), snapshot(2, 2)]));
  assert.notEqual(a, boardKey([snapshot(1, 5), snapshot(2, 2, false)]));
  assert.equal(boardKey([snapshot(1, 5, false)]), boardKey([snapshot(1, 5, false)]));
  assert.equal(boardKey([]), '');
  assert.equal(boardKey(null), '');
});

test('boardNote says what it is and when it stops', () => {
  assert.match(boardNote({ intervalSeconds: 30 }), /📌 board/);
  const live = boardNote({ live: true, until: Date.UTC(2026, 10, 2, 20, 0), at: Date.UTC(2026, 10, 2, 19, 0) });
  assert.match(live, /🔴 live/);
  assert.match(live, /press ⏸ to stop/);
  assert.match(live, /<t:\d+:t>/);
  assert.equal(boardNote({}), '-# 📌 board — I refresh this message every 30s');
});

test('a disabled board does nothing at all', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: false } });
  const { client } = makeClient();
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1)]), logger: silentLogger });

  const result = await manager.syncGuild('g');
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'off');
});

test('the first pass posts the board and remembers the message id', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true } });
  const { client, sent } = makeClient();
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 7)]), logger: silentLogger });

  const result = await manager.syncGuild('g');
  assert.equal(result.ok, true);
  assert.equal(result.reason, 'posted');
  assert.equal(sent.length, 1, 'one board message');
  assert.match(sent[0].embeds[0].data.description, /📌 board/);
  assert.equal(store.get().board.messageId, 'msg-1', 'the message id is persisted for the next restart');
});

test('a second pass edits the same message, and skips the edit when nothing changed', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true } });
  const { client, edits } = makeClient();
  let snapshots = [snapshot(1, 7)];
  const manager = createBoardManager({ client, store, servers: { snapshots: () => snapshots }, logger: silentLogger });

  await manager.syncGuild('g');
  const again = await manager.syncGuild('g');
  assert.equal(again.reason, 'unchanged');
  assert.equal(edits.length, 0, 'a quiet server costs no API call');

  snapshots = [snapshot(1, 12)];
  const changed = await manager.syncGuild('g');
  assert.equal(changed.reason, 'edited');
  assert.equal(edits.length, 1);
  assert.match(edits[0].embeds[0].data.title, /12\/100/);
});

test('an old reading is refreshed even when nothing changed', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true } });
  const { client, edits } = makeClient();
  let clock = 1000;
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 7)]), logger: silentLogger, forceSeconds: 60, now: () => clock });

  await manager.syncGuild('g');
  clock += 61 * 1000;
  const refreshed = await manager.syncGuild('g');
  assert.equal(refreshed.reason, 'edited');
  assert.equal(edits.length, 1, 'the timestamp in the note moves even when the numbers do not');
});

test('a deleted board message is re-posted instead of going quiet', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true, messageId: 'msg-gone' } });
  const { client, sent } = makeClient({ missing: true });
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 4)]), logger: silentLogger });

  const result = await manager.syncGuild('g');
  assert.equal(result.reason, 'posted');
  assert.equal(sent.length, 1);
});

test('a channel the bot cannot write to is reported once, not on every pass', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true, messageId: 'msg-1' } });
  const warnings = [];
  const { client } = makeClient({ editFails: true });
  const manager = createBoardManager({
    client,
    store,
    servers: makeServers([snapshot(1, 4)]),
    logger: { ...silentLogger, warn: (line) => warnings.push(line) },
  });

  const first = await manager.syncGuild('g');
  const second = await manager.syncGuild('g');
  assert.equal(first.ok, false);
  assert.equal(second.reason, 'could not edit', 'the guild is blocked after the first hard failure');
  assert.equal(warnings.length, 1);

  manager.unblock('g');
  assert.equal(manager.blocked.has('g'), false);
});

test('a board in a channel that vanished gives up quietly', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true } });
  const client = { channels: { fetch: async () => null, cache: new Map() } };
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 4)]), logger: silentLogger });

  const result = await manager.syncGuild('g');
  assert.equal(result.ok, false);
  assert.match(result.reason, /channel/);
});

test('a live /pop message refreshes itself and then stops', async () => {
  const store = makeStore('g');
  const { client, edits } = makeClient();
  let clock = 0;
  const manager = createBoardManager({
    client,
    store,
    servers: makeServers([snapshot(1, 3)]),
    logger: silentLogger,
    liveMinutes: 1,
    forceSeconds: 60,
    now: () => clock,
  });

  const until = await manager.startLive({ guildId: 'g', channelId: 'chan', messageId: 'msg-live' });
  assert.equal(until, 60000, 'one minute of updates');
  assert.equal(edits.length, 1, 'starting it refreshes the message at once');
  assert.match(edits[0].embeds[0].data.description, /🔴 live/);
  assert.ok(manager.liveEntry({ channelId: 'chan', messageId: 'msg-live' }));

  clock = 61 * 1000;
  await manager.tick();
  assert.equal(manager.liveEntry({ channelId: 'chan', messageId: 'msg-live' }), null, 'it expires on its own');
  assert.equal(edits.length, 2, 'and says so on the message');
});

test('pressing the live button again stops the updates', async () => {
  const store = makeStore('g');
  const { client } = makeClient();
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 3)]), logger: silentLogger });

  await manager.startLive({ guildId: 'g', channelId: 'chan', messageId: 'msg-live' });
  assert.equal(manager.stopLive({ channelId: 'chan', messageId: 'msg-live' }), true);
  assert.equal(manager.stopLive({ channelId: 'chan', messageId: 'msg-live' }), false);
  assert.equal(manager.liveEntry({ channelId: 'chan', messageId: 'msg-live' }), null);
});

test('a live message that cannot be edited is not registered', async () => {
  const store = makeStore('g');
  const { client } = makeClient({ editFails: true });
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 3)]), logger: silentLogger });

  const until = await manager.startLive({ guildId: 'g', channelId: 'chan', messageId: 'msg-live' });
  assert.equal(until, null);
  assert.equal(manager.live.size, 0);
});

test('the ticker walks the board and the live messages, then stops cleanly', async () => {
  const store = makeStore('g', { board: { channelId: 'chan', enabled: true } });
  const { client, sent } = makeClient();
  const manager = createBoardManager({ client, store, servers: makeServers([snapshot(1, 9)]), logger: silentLogger, intervalSeconds: 30 });

  const timer = manager.start();
  assert.ok(timer, 'the ticker is running');
  assert.equal(manager.start(), null, 'starting twice does not stack timers');

  await manager.tick();
  assert.equal(sent.length, 1, 'the first tick posts the board');

  manager.stop();
  assert.equal(manager.live.size, 0);
  assert.ok(manager.start(), 'a stopped manager can be started again');
  manager.stop();
});

test('an empty guild list is fine', async () => {
  const store = { get: () => null, listGuildIds: () => [], update: async () => null };
  const { client } = makeClient();
  const manager = createBoardManager({ client, store, servers: makeServers([]), logger: silentLogger });
  await manager.tick();
  assert.equal(manager.live.size, 0);
});
