import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_POINTS, NEWCOMER_WINDOW_MS, createHistoryStore, slotKey } from '../src/history.js';

const info = (players, max = 100, queued = 0) => ({ players, max, queued });

test('slotKey pairs a guild with a slot', () => {
  assert.equal(slotKey('g1', 2), 'g1#2');
  assert.equal(slotKey(null, null), '?#0');
});

test('push keeps the last readings and skips junk', () => {
  const history = createHistoryStore({ points: 3 });

  assert.equal(history.push('a', info(1), 1000).players, 1);
  assert.equal(history.push('a', info(2), 2000).players, 2);
  history.push('a', info(3), 3000);
  history.push('a', info(4), 4000);

  assert.deepEqual(history.series('a').map((sample) => sample.players), [2, 3, 4], 'only three points are kept');
  assert.equal(history.latest('a').players, 4);
  assert.equal(history.previous('a').players, 3);
  assert.equal(history.previous('a', 3), null, 'there is nothing that far back');

  assert.equal(history.push('a', null), null);
  assert.equal(history.push('a', { players: 'nope' }), null);
  assert.equal(history.push('b', info(-5), 1).players, 0, 'a negative count is clamped');
  assert.deepEqual(history.series('nothing'), []);
});

test('delta, average and the window peak describe the recent past', () => {
  const history = createHistoryStore();
  assert.equal(history.delta('a'), null, 'no history, no trend');

  for (const players of [10, 12, 9, 15]) history.push('a', info(players));

  assert.equal(history.delta('a'), 6, '15 now against 9 one reading ago');
  assert.equal(history.delta('a', 3), 5, '15 now against 10 three readings ago');
  assert.equal(history.average('a'), 11.5);
  assert.equal(history.windowPeak('a').players, 15);
});

test('observeRoster remembers the first time it saw a player', () => {
  const history = createHistoryStore();
  const key = slotKey('g1', 1);
  const now = 1000000;

  const first = history.observeRoster(key, [{ id: 'a', name: 'alpha', ping: 40 }], now);
  assert.equal(first.length, 1);
  assert.equal(first[0].isNew, true, 'a player we have just met is a newcomer');
  assert.equal(first[0].seconds, 0);

  const later = history.observeRoster(key, [{ id: 'a', name: 'alpha', ping: 40 }], now + NEWCOMER_WINDOW_MS + 1000);
  assert.equal(later[0].seconds, Math.round((NEWCOMER_WINDOW_MS + 1000) / 1000), 'the session grows');
  assert.equal(later[0].isNew, false, 'no longer a newcomer');

  assert.equal(history.roster(key).length, 1);
  assert.equal(history.roster(key)[0].ping, undefined, 'the roster only remembers ids and times');
});

test('the roster forgets players who left, and reports newcomers by id', () => {
  const history = createHistoryStore();
  const key = slotKey('g1', 1);

  history.observeRoster(key, [{ id: 'a', name: 'alpha' }], 1000);
  history.observeRoster(key, [{ id: 'b', name: 'beta' }], 2000);

  assert.deepEqual(history.roster(key).map((entry) => entry.id), ['b'], 'alpha left');
  assert.deepEqual(history.observeRoster(key, [], 3000), []);
  assert.deepEqual(history.roster(key), []);

  assert.deepEqual(history.observeRoster(key, [{ name: 'nameless' }], 4000), [], 'a player without an id is skipped');
  assert.deepEqual(history.observeRoster(key, null, 4000), []);
});

test('forget and reset clear the memory', () => {
  const history = createHistoryStore();
  history.push('a', info(5));
  history.observeRoster('a', [{ id: 'a' }]);

  history.forget('a');
  assert.deepEqual(history.series('a'), []);
  assert.deepEqual(history.roster('a'), []);

  history.push('b', info(5));
  history.reset();
  assert.deepEqual(history.series('b'), []);
  assert.equal(history.points, DEFAULT_POINTS);
});
