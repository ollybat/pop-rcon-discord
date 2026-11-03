import assert from 'node:assert/strict';
import { test } from 'node:test';
import { POP_ID, parsePopId, popPayload, popPlaceholder, popRows } from '../src/pop.js';
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
  assert.ok(!names.some((name) => name.includes('Trend')), 'the compact view drops the chart');
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
