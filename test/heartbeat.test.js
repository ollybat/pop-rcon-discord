import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Heartbeat, describeGap } from '../src/heartbeat.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('describeGap turns a last beat into how long the bot was away', () => {
  const at = new Date('2026-11-03T05:34:00.000Z');

  assert.deepEqual(describeGap(null, at), { known: false, seconds: null, at: null }, 'no beat means no claim');
  assert.deepEqual(describeGap('not a date', at), { known: false, seconds: null, at: null });

  const fresh = describeGap('2026-11-03T05:33:50.000Z', at);
  assert.equal(fresh.known, true);
  assert.equal(fresh.seconds, 10);
  assert.equal(fresh.at.toISOString(), '2026-11-03T05:33:50.000Z');

  // Today's real gap: the host stopped the app and started it again about two minutes later.
  assert.equal(describeGap('2026-11-03T05:32:00.000Z', at).seconds, 120);

  // A clock that went backwards must not produce a negative age.
  assert.equal(describeGap('2026-11-03T05:40:00.000Z', at).seconds, 0);
});

test('the heartbeat writes a beat it can read back, without a leftover temp file', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-heartbeat-'));
  const path = join(dir, 'heartbeat.json');
  const now = () => new Date('2026-11-03T06:00:00.000Z');
  const heartbeat = new Heartbeat({ path, logger: silentLogger, now });

  assert.equal(await heartbeat.read(), null, 'nothing on disk yet');
  assert.equal(await heartbeat.beat(), '2026-11-03T06:00:00.000Z');
  assert.equal(await heartbeat.read(), '2026-11-03T06:00:00.000Z');

  const raw = JSON.parse(await readFile(path, 'utf8'));
  assert.deepEqual(raw, { at: '2026-11-03T06:00:00.000Z' });
  assert.deepEqual((await readdirNames(dir)).filter((name) => name.includes('.tmp-')), [], 'the write is atomic');

  await rm(dir, { recursive: true, force: true });
});

test('a corrupt beat file is treated as no beat at all', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-heartbeat-'));
  const path = join(dir, 'heartbeat.json');
  await writeFile(path, 'not json at all', 'utf8');

  const heartbeat = new Heartbeat({ path, logger: silentLogger });
  assert.equal(await heartbeat.read(), null);

  await rm(dir, { recursive: true, force: true });
});

test('a heartbeat with nowhere to write is silent, not fatal', async () => {
  const heartbeat = new Heartbeat({ path: null, logger: silentLogger });
  assert.equal(await heartbeat.beat(), null);
  assert.equal(await heartbeat.read(), null);
  heartbeat.stop();
});

test('the beat timer starts and stops cleanly', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-heartbeat-'));
  const path = join(dir, 'heartbeat.json');
  const heartbeat = new Heartbeat({ path, intervalMs: 15000, logger: silentLogger });

  await heartbeat.start();
  assert.ok(heartbeat.timer, 'beating while the bot runs');
  assert.equal(await heartbeat.read() !== null, true, 'and it beat once immediately');

  heartbeat.stop();
  assert.equal(heartbeat.timer, null);

  await rm(dir, { recursive: true, force: true });
});

// node:fs/promises has readdir, but naming it here keeps the import list obvious.
async function readdirNames(dir) {
  const { readdir } = await import('node:fs/promises');
  return readdir(dir);
}
