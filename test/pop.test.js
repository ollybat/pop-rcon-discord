import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POP_ID, handlePopComponent, parsePopId, popPayload, popPlaceholder, popRows } from '../src/pop.js';
import { emptyGuildConfig } from '../src/store.js';

function snapshot(slot, players = 0, connected = true) {
  return {
    slot,
    name: 'Server ' + slot,
    host: '127.0.0.1',
    port: 28016,
    connected,
    info: connected
      ? { players, max: 100, queued: 1, joining: 0, uptime: 600, restarting: false, hostname: 'S' + slot }
      : null,
    players: [],
    latencyMs: 5,
    at: new Date().toISOString(),
    error: connected ? null : 'ECONNREFUSED',
  };
}

test('parsePopId reads every button', () => {
  assert.equal(POP_ID, 'sb:pop');
  assert.equal(parsePopId('sb:setup:main'), null);
  assert.deepEqual(parsePopId('sb:pop:view:2:0'), { action: 'view', slot: 2, players: false, details: true });
  assert.deepEqual(parsePopId('sb:pop:refresh:all:1'), { action: 'refresh', slot: null, players: true, details: true });
  assert.deepEqual(parsePopId('sb:pop:toggle:1'), { action: 'toggle', slot: 1, players: true, details: true });
  assert.deepEqual(parsePopId('sb:pop:details:1:1:0'), { action: 'details', slot: 1, players: true, details: false });
  assert.deepEqual(parsePopId('sb:pop:view:99:1').slot, 99);
});

test('popPayload builds a summary plus one embed per server', () => {
  const payload = popPayload({ snapshots: [snapshot(1, 12), snapshot(2, 4)], config: emptyGuildConfig('g'), showPlayers: true });

  assert.equal(payload.embeds.length, 3, 'summary plus two servers');
  assert.match(payload.embeds[0].data.description, /16\/200/);
  assert.match(payload.embeds[1].data.title, /12\/100/);
  assert.equal(payload.components.length, 2, 'server switches and the action row');
});

test('popPayload with a focus shows one server and disables its own button', () => {
  const payload = popPayload({ snapshots: [snapshot(1, 12), snapshot(2, 4)], config: emptyGuildConfig('g'), focus: 2 });

  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /4\/100/);

  const labels = payload.components[0].components.map((button) => button.data);
  assert.equal(labels.find((button) => button.label === 'Server 2').disabled, true);
  assert.equal(labels.find((button) => button.label === 'All').disabled, false);
});

test('popPayload falls back to the setup hint when nothing is configured', () => {
  const payload = popPayload({ snapshots: [] });
  assert.match(payload.embeds[0].data.description, /\/setup/);
  assert.deepEqual(payload.components, []);
  assert.deepEqual(popPlaceholder().embeds.length, 1);
});

test('the toggle button flips the player list', () => {
  const on = popRows({ snapshots: [snapshot(1, 3)], focus: 1, showPlayers: true });
  const onLabels = on.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(onLabels.includes('Hide players'));
  assert.ok(onLabels.includes('Refresh'));

  const off = popRows({ snapshots: [snapshot(1, 3)], focus: 1, showPlayers: false });
  const offLabels = off.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(offLabels.includes('Show players'));
  assert.ok(!offLabels.includes('All servers'), 'a single server does not need the All button');
});

test('an offline server still gets a red button', () => {
  const rows = popRows({ snapshots: [snapshot(1, 0, false)], focus: null, showPlayers: true });
  const emoji = rows[0].components.map((button) => button.data.emoji?.name);
  assert.deepEqual(emoji, ['🔴']);
});

test('the More/Less button switches the compact view', () => {
  const full = popRows({ snapshots: [snapshot(1, 3)], focus: null, showPlayers: true, details: true });
  const fullLabels = full.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(fullLabels.includes('Less'), 'the expanded view offers Less');

  const compact = popRows({ snapshots: [snapshot(1, 3)], focus: null, showPlayers: true, details: false });
  const compactLabels = compact.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(compactLabels.includes('More'));

  const payload = popPayload({ snapshots: [snapshot(1, 12)], config: emptyGuildConfig('g'), details: false, guildId: 'g' });
  const names = payload.embeds[0].data.fields.map((field) => field.name);
  assert.ok(names.some((name) => name.includes('Population')));
  assert.ok(!names.some((name) => name.includes('Map')), 'the compact view folds the server facts into its header line');
});

test('a server with history shows its direction and shape', async () => {
  const { history, slotKey } = await import('../src/history.js');
  history.reset();
  for (const players of [4, 6, 5, 9, 12]) history.push(slotKey('g', 1), { players, max: 100, queued: 0 });

  const payload = popPayload({ snapshots: [snapshot(1, 12)], config: emptyGuildConfig('g'), guildId: 'g' });
  const fields = payload.embeds[0].data.fields;
  const population = fields.find((field) => field.name.includes('Population'));
  assert.match(population.value, /▲ \+3/, 'twelve now against nine a reading ago');

  const trend = fields.find((field) => field.name.includes('Trend'));
  assert.ok(trend, 'the trend field is there');
  assert.match(trend.value, /averaging 7\.2/);
  assert.match(trend.value, /last 5 readings/);
});

test('the action row offers a live switch, unless the message is already a board', () => {
  const rows = popRows({ snapshots: [snapshot(1, 3)], focus: 1 });
  const ids = rows.at(-1).components.map((component) => component.data.custom_id);
  assert.ok(ids.includes('sb:pop:live:1:1:1'), 'members can keep an answer live');
  assert.deepEqual(parsePopId('sb:pop:live:all:0:1'), { action: 'live', slot: null, players: false, details: true });

  const board = popRows({ snapshots: [snapshot(1, 3)], focus: 1, allowLive: false });
  const boardIds = board.at(-1).components.map((component) => component.data.custom_id);
  assert.equal(boardIds.some((id) => id.includes(':live:')), false, 'a board message has no live button');
});

test('a note lands on the first embed, where it is read', () => {
  const one = popPayload({ snapshots: [snapshot(1, 3)], config: emptyGuildConfig('g'), note: '-# live now' });
  assert.match(one.embeds[0].data.description, /-# live now/);

  const many = popPayload({ snapshots: [snapshot(1, 3), snapshot(2, 4)], config: emptyGuildConfig('g'), note: '-# live now' });
  assert.match(many.embeds[0].data.description, /-# live now/, 'the summary carries it');
  assert.equal(/live now/.test(many.embeds[1].data.description ?? ''), false, 'the server embeds do not repeat it');
});
test('a live answer remembers what the last button asked for', async () => {
  const entry = { focus: 1, showPlayers: true, details: true };
  const interaction = {
    customId: 'sb:pop:toggle:all:0:1',
    guild: { id: 'g' },
    channelId: '111111111111111111',
    message: { id: '222222222222222222' },
    update: async () => {},
  };
  const ctx = {
    store: { get: () => emptyGuildConfig('g') },
    servers: { snapshots: () => [snapshot(1, 3)] },
    board: { liveEntry: () => entry },
    pollSeconds: 20,
  };

  assert.equal(await handlePopComponent(interaction, ctx), true);
  assert.equal(entry.showPlayers, false, 'the next refresh keeps the hidden-player view');
  assert.equal(entry.focus, null, 'and the wider view');
});

test('a normal answer is untouched by the live bookkeeping', async () => {
  const interaction = {
    customId: 'sb:pop:details:1:1:0',
    guild: { id: 'g' },
    channelId: '111111111111111111',
    message: { id: '222222222222222222' },
    update: async () => {},
  };
  const ctx = {
    store: { get: () => emptyGuildConfig('g') },
    servers: { snapshots: () => [snapshot(1, 3)] },
    board: { liveEntry: () => null },
  };

  assert.equal(await handlePopComponent(interaction, ctx), true);
});


/** A server that reports everything, so the compact layout has something to leave out. */
function richSnapshot(slot, players = 12, roster = []) {
  return {
    slot,
    name: 'Server ' + slot,
    host: '127.0.0.1',
    port: 28016,
    connected: true,
    info: {
      players,
      max: 100,
      queued: 3,
      joining: 1,
      uptime: 8000,
      restarting: false,
      hostname: 'S' + slot,
      map: 'Procedural Map',
      framerate: 61,
      entityCount: 21543,
      memory: 3800,
    },
    players: roster,
    latencyMs: 38,
    at: new Date().toISOString(),
    error: null,
  };
}

test('the compact answer is much shorter and still carries the numbers', () => {
  const config = emptyGuildConfig('g');
  const roster = [
    { id: 'a', name: 'alpha', seconds: 7200, ping: 40 },
    { id: 'b', name: 'bravo', seconds: 600, ping: 210 },
  ];
  const compact = popPayload({ snapshots: [richSnapshot(1, 12, roster)], config, details: false, guildId: 'g' }).embeds[0].data;
  const full = popPayload({ snapshots: [richSnapshot(1, 12, roster)], config, details: true, guildId: 'g' }).embeds[0].data;

  assert.ok(compact.fields.length < full.fields.length, 'the compact answer has fewer fields');
  assert.ok(compact.fields.length <= 3, 'it stays at three fields at most');

  // Smaller, not emptier: the reading, the shape and the roster all survive.
  assert.match(compact.title, /12\/100/);
  const population = compact.fields.find((field) => field.name.includes('Population'));
  assert.match(population.value, /[\u2588\u2591]/, 'the bar is still drawn');
  assert.match(compact.description, /up 2h 13m/);
  assert.match(compact.description, /38 ms/);
  assert.match(compact.description, /Procedural Map/);
  assert.match(compact.description, /61 fps/);
  assert.match(compact.description, /21.5k entities/);
  assert.match(compact.description, /3.7 GB/, 'memory reads in GB once it is big');
  const players = compact.fields.find((field) => field.name.includes('On right now'));
  assert.ok(!players.value.includes('\n'), 'the roster is one line, not one line per player');
  assert.match(players.value, /alpha/);
  assert.match(players.value, /\u{1F534}/u, 'a bad connection still keeps its warning');
  assert.ok(!/\u{1F7E2}/u.test(players.value), 'the ordinary green dots are the noise that goes');
});

test('the compact answer leaves out what is not there', () => {
  const config = emptyGuildConfig('g');
  const quiet = richSnapshot(1, 0, []);
  quiet.info.queued = 0;
  const data = popPayload({ snapshots: [quiet], config, details: false, guildId: 'g' }).embeds[0].data;

  assert.match(data.description, /nobody on/);
  assert.ok(!/queued/.test(data.description), 'an empty queue is not worth a word');
  assert.ok(!data.fields.some((field) => field.name.includes('On right now')), 'and an empty roster is not worth a field');
});

test('a server with no readings yet still gets a tidy compact answer', () => {
  // A guild nothing has polled yet: history is per guild, and this one is brand new.
  const data = popPayload({ snapshots: [richSnapshot(1, 4, [])], config: emptyGuildConfig('fresh-guild'), details: false, guildId: 'fresh-guild' }).embeds[0].data;
  assert.ok(!data.fields.some((field) => field.name.includes('Trend')), 'no history, no chart');
  assert.match(data.fields[0].value, /[\u2588\u2591]/);
});
