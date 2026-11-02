import assert from 'node:assert/strict';
import { test } from 'node:test';
import { maskSecret, presenceLine, summarizeServerInfo } from '../src/summary.js';

const formats = {
  online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
  offline: '🔴 RCON┆OFFLINE',
  resting: '🟡 RCON┆RESTING',
};

test('maskSecret never reveals the middle of a password', () => {
  assert.equal(maskSecret(''), '(not set)');
  assert.equal(maskSecret('abc'), '***');
  assert.equal(maskSecret('abcd'), '****');
  assert.equal(maskSecret('hunter2'), 'hu***r2');
});

test('summarizeServerInfo explains a reply that is not JSON', () => {
  const result = summarizeServerInfo('not json');
  assert.equal(result.ok, false);
  assert.equal(result.info, null);
  assert.match(result.lines[0], /did not return JSON/);
});

test('summarizeServerInfo lists the fields the bot cares about', () => {
  const result = summarizeServerInfo({
    Players: 7,
    MaxPlayers: 100,
    Queued: 1,
    Joining: 0,
    Uptime: 3600,
    Restarting: false,
    Server: 'POP',
  });

  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [
    'hostname    POP',
    'players     7/100',
    'queued      1',
    'joining     0',
    'uptime      3600s',
    'restarting  no',
  ]);
});

test('summarizeServerInfo copes with a server that omits everything', () => {
  const result = summarizeServerInfo({});
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines, [
    'hostname    Rust server',
    'players     0/0',
    'queued      0',
    'joining     0',
    'uptime      unknown',
    'restarting  no',
  ]);
});

test('presenceLine matches the status the bot would show', () => {
  assert.equal(
    presenceLine({ players: 2, max: 100, queued: 0, joining: 0, restarting: false }, formats),
    '🟢 RCON┆👥  2/100 ⏳0/0',
  );
  assert.equal(presenceLine({ restarting: true }, formats), '🟡 RCON┆RESTING');
  assert.equal(presenceLine(null, formats), '🟢 RCON┆👥  —/— ⏳0/0');
});
