import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RECENT_ERROR_LIMIT, STAT_KEYS, createStats } from '../src/stats.js';

test('counters start at zero and add up', () => {
  const stats = createStats();
  assert.equal(stats.get('polls'), 0);
  stats.inc('polls');
  stats.inc('polls');
  stats.inc('dmForwarded', 3);
  assert.equal(stats.get('polls'), 2);
  assert.equal(stats.get('dmForwarded'), 3);
  assert.equal(stats.get('nonsense'), 0);
  assert.ok(STAT_KEYS.includes('polls'));
});

test('note() remembers the failure, keeps it short and counts it', () => {
  const stats = createStats();
  stats.note('ECONNREFUSED\n  because the server is down');
  assert.equal(stats.get('errors'), 1);
  assert.equal(stats.snapshot().lastError, 'ECONNREFUSED because the server is down', 'one line only');

  for (let index = 0; index < RECENT_ERROR_LIMIT + 3; index += 1) stats.note('failure ' + index);
  const snapshot = stats.snapshot();
  assert.equal(snapshot.recentErrors.length, RECENT_ERROR_LIMIT, 'only the latest are kept');
  assert.match(snapshot.recentErrors[0].message, /failure 7/);
  assert.ok(snapshot.lastErrorAt, 'and we know when');

  stats.inc('rconErrors', 4);
  assert.equal(stats.snapshot().rconErrors, 4);
});

test('the snapshot is plain JSON with an uptime', () => {
  const stats = createStats({ startedAt: Date.now() - 65000 });
  stats.inc('commands', 2);

  const snapshot = JSON.parse(JSON.stringify(stats.snapshot()));
  assert.equal(snapshot.commands, 2);
  assert.ok(snapshot.uptimeSeconds >= 60, 'uptime counts from the given start');
  assert.equal(snapshot.lastError, null);
  assert.ok(snapshot.startedAt);

  stats.reset();
  assert.equal(stats.get('commands'), 0);
});
