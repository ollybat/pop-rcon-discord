import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bar, chunk, clock, codeBlock, duration, maskPassword, plural, quoteArgument, truncate } from '../src/format.js';

test('duration reads like a human wrote it', () => {
  assert.equal(duration(0), '0s');
  assert.equal(duration(59), '59s');
  assert.equal(duration(60), '1m');
  assert.equal(duration(3600 + 120), '1h 2m');
  assert.equal(duration(86400 * 2 + 3600 * 5), '2d 5h');
  assert.equal(duration(-1), '—');
  assert.equal(duration(null), '—');
  assert.equal(duration('nope'), '—');
});

test('truncate keeps the limit and marks the cut', () => {
  assert.equal(truncate('abc', 10), 'abc');
  const cut = truncate('x'.repeat(50), 20);
  assert.ok(cut.length <= 20, 'never longer than the limit');
  assert.match(cut, /truncated/);
});

test('codeBlock wraps in fences', () => {
  assert.equal(codeBlock('hello'), '```\nhello\n```');
});

test('clock prints a UTC time', () => {
  assert.equal(clock(new Date('2024-05-06T07:08:09Z')), '07:08:09 UTC');
  assert.equal(clock('nonsense'), '—');
});

test('plural handles one and many', () => {
  assert.equal(plural(1, 'player'), '1 player');
  assert.equal(plural(0, 'player'), '0 players');
  assert.equal(plural(3, 'player', 'players!'), '3 players!');
});

test('chunk splits a list', () => {
  assert.deepEqual(chunk([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  assert.deepEqual(chunk([], 2), []);
});

test('bar fills proportionally and never overflows', () => {
  assert.equal(bar(0, 100, 10), '░'.repeat(10));
  assert.equal(bar(100, 100, 10), '█'.repeat(10));
  assert.equal(bar(50, 100, 10), '█'.repeat(5) + '░'.repeat(5));
  assert.equal(bar(999, 100, 4), '████');
  assert.equal(bar(1, 0, 4), '░░░░');
});

test('quoteArgument protects RCON arguments', () => {
  assert.equal(quoteArgument('hello world'), '"hello world"');
  assert.equal(quoteArgument('say "hi"'), '"say hi"');
  assert.equal(quoteArgument('two\nlines'), '"two lines"');
  assert.equal(quoteArgument(undefined), '""');
});

test('maskPassword never leaks the middle of a secret', () => {
  assert.equal(maskPassword('hunter2'), 'hu***r2');
  assert.equal(maskPassword('abcd'), '****');
  assert.equal(maskPassword(''), '(not set)');
  assert.equal(maskPassword(null), '(not set)');
});
