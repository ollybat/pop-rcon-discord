import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fleetVerdict, recentRestart, serverVerdict } from '../src/health.js';

function snapshot(overrides = {}) {
  return {
    slot: 1,
    name: 'spinback 5x',
    connected: true,
    latencyMs: 40,
    at: '2026-11-03T10:00:00.000Z',
    error: null,
    info: { players: 12, max: 100, queued: 0, joining: 0, uptime: 3600, restarting: false, framerate: 60, entityCount: 20000 },
    ...overrides,
  };
}

test('a healthy server is called healthy, and the reason is in the reading', () => {
  const verdict = serverVerdict(snapshot());
  assert.equal(verdict.id, 'healthy');
  assert.equal(verdict.emoji, '🟢');
  assert.deepEqual(verdict.problems, []);
});

test('every state a server can be in gets its own verdict', () => {
  assert.equal(serverVerdict(null).id, 'unknown');
  assert.equal(serverVerdict(snapshot({ connected: false, error: 'ECONNREFUSED', info: null })).id, 'offline');
  assert.match(serverVerdict(snapshot({ connected: false, error: 'ECONNREFUSED', info: null })).hint, /ECONNREFUSED/);
  assert.equal(serverVerdict(snapshot({ info: null })).id, 'quiet');
  assert.equal(serverVerdict(snapshot({ info: { players: 0, max: 100, restarting: true } })).id, 'restarting');
  assert.equal(serverVerdict(snapshot({ info: { players: 0, max: 100, restarting: false, framerate: 0 } })).id, 'idle');
  assert.equal(serverVerdict(snapshot({ info: { players: 100, max: 100, queued: 4, restarting: false } })).id, 'full');
  assert.match(serverVerdict(snapshot({ info: { players: 100, max: 100, queued: 4, restarting: false } })).hint, /4 waiting/);
});

test('a struggling server says which number made it look that way', () => {
  const slow = serverVerdict(snapshot({ info: { players: 40, max: 100, restarting: false, framerate: 12 } }));
  assert.equal(slow.id, 'strained');
  assert.equal(slow.emoji, '🟠');
  assert.deepEqual(slow.problems, ['12 fps']);
  assert.match(slow.hint, /not the Discord bot/);

  const laggy = serverVerdict(snapshot({ latencyMs: 2400 }));
  assert.deepEqual(laggy.problems, ['RCON answered in 2400 ms']);

  const both = serverVerdict(snapshot({ latencyMs: 2400, info: { players: 5, max: 100, restarting: false, framerate: 9 } }));
  assert.equal(both.problems.length, 2);

  assert.equal(serverVerdict(snapshot({ latencyMs: 2400 }), { latencyWarnMs: 5000 }).id, 'healthy', 'the thresholds are adjustable');
});

test('a restart is only mentioned while it is news', () => {
  const now = new Date('2026-11-03T12:00:00.000Z');
  const fresh = snapshot({ restart: { at: '2026-11-03T11:50:00.000Z', wasUpSeconds: 82000, wiped: false, entityCount: 20000 } });
  const recent = recentRestart(fresh, { now });
  assert.equal(recent.minutes, 10);
  assert.equal(recent.wasUpSeconds, 82000);
  assert.equal(recentRestart(snapshot({ restart: { at: '2026-11-03T09:00:00.000Z' } }), { now }), null, 'an old restart is not news');
  assert.equal(recentRestart(snapshot(), { now }), null);
  assert.equal(recentRestart(snapshot({ restart: { at: 'nonsense' } }), { now }), null);
  assert.equal(recentRestart(snapshot({ restart: { at: '2026-11-03T13:00:00.000Z' } }), { now }), null, 'a clock skew is not a restart');

  assert.ok(serverVerdict(fresh, { now }).restart, 'the verdict carries it too');
});

test('the fleet verdict describes the worst of the servers, not an average', () => {
  assert.deepEqual(fleetVerdict([]), { emoji: '⚪', label: 'no servers configured yet' });
  assert.deepEqual(fleetVerdict([serverVerdict(snapshot()), serverVerdict(snapshot({ slot: 2 }))]), { emoji: '🟢', label: 'every server answers' });
  assert.match(fleetVerdict([serverVerdict(snapshot()), serverVerdict(snapshot({ slot: 2, info: { players: 3, max: 100, restarting: false, framerate: 5 } }))]).label, /1 of 2 working hard/);
  assert.match(fleetVerdict([serverVerdict(snapshot({ connected: false, info: null }))]).label, /nothing answers/);
  assert.match(fleetVerdict([serverVerdict(snapshot({ connected: false, info: null })), serverVerdict(snapshot({ slot: 2 }))]).label, /1 of 2 not answering/);
  assert.match(fleetVerdict([serverVerdict(snapshot({ info: null }))]).label, /silent/);
});
