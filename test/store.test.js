import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GuildStore,
  configuredServers,
  bestFor,
  dayKey,
  describeConfig,
  historyFor,
  emptyGuildConfig,
  normalizeGuildConfig,
  normalizeServerInput,
  peakFor,
  recordPeak,
  topDays,
} from '../src/store.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('normalizeServerInput accepts real server details and cleans the host', () => {
  const result = normalizeServerInput({ name: ' Spinback 5X EU ', host: ' wss://play.example.com/', port: '28016', password: 'secret' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: 'Spinback 5X EU', host: 'play.example.com', port: 28016, password: 'secret' });
});

test('normalizeServerInput defaults the port and the name', () => {
  const result = normalizeServerInput({ host: '1.2.3.4', password: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.port, 28016);
  assert.equal(result.value.name, '1.2.3.4');
});

test('normalizeServerInput refuses junk', () => {
  assert.equal(normalizeServerInput({ host: '', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: 'two words', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', port: '70000', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', port: 'abc', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', password: '' }).ok, false);
  assert.match(normalizeServerInput({ host: '1.2.3.4', password: '' }).error, /password/i);
});

test('normalizeGuildConfig drops ids and servers that are not usable', () => {
  const config = normalizeGuildConfig(
    {
      roles: { owner: '111111111111111111', coOwner: 'nope' },
      logs: { joinLeave: '222222222222222222' },
      servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }, null, { host: '', password: '' }],
    },
    'guild-1',
  );

  assert.equal(config.roles.owner, '111111111111111111');
  assert.equal(config.roles.coOwner, null);
  assert.equal(config.logs.joinLeave, '222222222222222222');
  assert.equal(config.logs.errors, null);
  assert.equal(configuredServers(config).length, 1);
  assert.equal(configuredServers(config)[0].slot, 1);
  assert.equal(configuredServers(config)[0].name, '1.2.3.4');
});

test('describeConfig reports readiness', () => {
  const empty = describeConfig(emptyGuildConfig('g'));
  assert.deepEqual(empty, { roles: 0, logs: 0, servers: 0, ready: false });

  const ready = describeConfig({
    roles: { owner: '1', admin: '2' },
    logs: { errors: '3' },
    servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }],
  });
  assert.deepEqual(ready, { roles: 2, logs: 1, servers: 1, ready: true });

  // Roles without a server (or the other way round) is still not ready.
  assert.equal(describeConfig({ roles: { owner: '1' }, servers: [null, null, null] }).ready, false);
  assert.equal(describeConfig({ roles: {}, servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }] }).ready, false);
});

test('GuildStore round-trips a config through the disk, privately', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const store = new GuildStore({ dir, logger: silentLogger });
  assert.deepEqual(store.listGuildIds(), []);
  assert.equal(store.get('guild-1').roles.owner, null);

  await store.save('guild-1', {
    roles: { owner: '111111111111111111', admin: 'nope' },
    logs: { joinLeave: '222222222222222222' },
    servers: [{ name: 'Spinback 5X EU', host: '1.2.3.4', port: 28016, password: 'x' }],
  });

  assert.deepEqual(store.listGuildIds(), ['guild-1']);
  assert.equal(store.get('guild-1').roles.admin, null, 'an invalid role id is not stored');
  assert.ok(store.get('guild-1').updatedAt);

  const mode = (await stat(store.pathFor('guild-1'))).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600, 'the file holds RCON passwords');

  const fresh = new GuildStore({ dir, logger: silentLogger });
  const loaded = await fresh.load('guild-1');
  assert.equal(loaded.roles.owner, '111111111111111111');
  assert.equal(configuredServers(loaded)[0].host, '1.2.3.4');
  assert.equal(configuredServers(loaded)[0].password, 'x');
});

test('GuildStore.update reads, mutates and writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const store = new GuildStore({ dir, logger: silentLogger });
  const updated = await store.update('guild-1', (config) => {
    config.roles.owner = '111111111111111111';
    return config;
  });

  assert.equal(updated.roles.owner, '111111111111111111');
  assert.equal(store.get('guild-1').roles.owner, '111111111111111111');

  // A guild with no file yet loads as an empty config instead of throwing.
  assert.equal((await store.load('guild-2')).roles.owner, null);
});

test('recordPeak keeps the busiest moment of the day per slot', () => {
  const config = { stats: {} };
  const morning = new Date('2026-11-02T09:00:00Z');
  const evening = new Date('2026-11-02T19:30:00Z');

  assert.equal(recordPeak(config, 1, 40, morning), true);
  assert.equal(recordPeak(config, 1, 12, evening), false, 'a lower count is not a new peak');
  assert.equal(recordPeak(config, 1, 63, evening), true);
  assert.deepEqual(peakFor(config, 1, evening), { peak: 63, at: evening.toISOString() });

  const nextDay = new Date('2026-11-03T00:05:00Z');
  assert.equal(recordPeak(config, 1, 0, nextDay), true, 'a new day resets the peak');
  assert.deepEqual(peakFor(config, 1, nextDay), { peak: 0, at: nextDay.toISOString() });
  assert.equal(peakFor(config, 1, evening), null, 'yesterday is not today');
  assert.equal(peakFor(config, 2, evening), null, 'empty slots have no peak');
  assert.equal(recordPeak(config, 1, 'many'), false, 'junk counts are ignored');
});

test('dayKey is the UTC day of a timestamp', () => {
  assert.equal(dayKey('2026-11-02T23:59:59Z'), '2026-11-02');
  assert.equal(dayKey(new Date('2026-11-02T00:00:00Z')), '2026-11-02');
  assert.equal(dayKey('nonsense'), '');
});

test('normalizeGuildConfig keeps valid stats and drops junk', () => {
  const config = normalizeGuildConfig(
    {
      stats: {
        1: { day: '2026-11-02', peak: '63', peakAt: '2026-11-02T19:30:00.000Z' },
        2: { day: 'nope', peak: 5 },
        3: 'junk',
        4: { day: '2026-11-02', peak: 1 },
      },
    },
    'guild-1',
  );

  assert.deepEqual(Object.keys(config.stats), ['1']);
  assert.equal(config.stats['1'].day, '2026-11-02');
  assert.equal(config.stats['1'].peak, 63);
  assert.equal(config.stats['1'].peakAt, '2026-11-02T19:30:00.000Z');
  assert.deepEqual(config.stats['1'].days, { '2026-11-02': 63 }, 'the stored peak seeds the history');
  assert.deepEqual(config.stats['1'].best, { peak: 63, day: '2026-11-02', at: null }, 'the best day is derived from the history when it is missing');
  assert.deepEqual(emptyGuildConfig('g').stats, {});
});

test('the record book keeps the best day and the history', () => {
  const config = { stats: {} };
  const day = (text) => new Date(text + 'T18:00:00Z');

  recordPeak(config, 1, 40, day('2026-11-01'));
  recordPeak(config, 1, 63, day('2026-11-02'));
  recordPeak(config, 1, 12, day('2026-11-03'));

  assert.deepEqual(bestFor(config, 1), { peak: 63, day: '2026-11-02', at: '2026-11-02T18:00:00.000Z' });
  assert.deepEqual(
    historyFor(config, 1).map((entry) => entry.day),
    ['2026-11-03', '2026-11-02', '2026-11-01'],
    'newest first',
  );
  assert.deepEqual(topDays(config, 1, 2), [
    { day: '2026-11-02', peak: 63 },
    { day: '2026-11-01', peak: 40 },
  ]);

  // one day is one entry, even when the peak moves
  recordPeak(config, 1, 80, day('2026-11-02'));
  assert.deepEqual(historyFor(config, 1).map((entry) => entry.peak), [12, 80, 40]);
  assert.equal(bestFor(config, 1).peak, 80);

  assert.equal(bestFor(config, 2), null);
  assert.deepEqual(historyFor(config, 2), []);
  assert.deepEqual(topDays(config, 2), []);
});

test('normalizeGuildConfig keeps a history and derives a missing best day', () => {
  const config = normalizeGuildConfig(
    {
      stats: {
        1: { day: '2026-11-02', peak: 10, peakAt: null, days: { '2026-10-31': 77, '2026-11-02': 10, 'not-a-day': 99, '2026-11-01': -4 } },
        2: { day: '2026-11-02', peak: 5, peakAt: null, best: { peak: 90, day: '2026-10-01', at: '2026-10-01T00:00:00.000Z' } },
      },
    },
    'g',
  );

  assert.deepEqual(config.stats['1'].days, { '2026-10-31': 77, '2026-11-02': 10 });
  assert.deepEqual(config.stats['1'].best, { peak: 77, day: '2026-10-31', at: null }, 'the best day comes from the history');
  assert.deepEqual(config.stats['2'].best, { peak: 90, day: '2026-10-01', at: '2026-10-01T00:00:00.000Z' });
  assert.deepEqual(config.stats['2'].days, { '2026-11-02': 5 }, 'a missing history is seeded from today');
});

test('the history is capped', () => {
  const config = { stats: {} };
  for (let index = 0; index < 120; index += 1) {
    const at = new Date(Date.UTC(2026, 0, 1 + index, 12));
    recordPeak(config, 1, 10 + index, at);
  }

  const history = historyFor(config, 1);
  assert.equal(history.length, 90, 'only the last 90 days are kept');
  assert.equal(history[0].day, history[0].day, 'newest first');
  assert.ok(history[0].day > history[history.length - 1].day);
});

test('the live board is only on when it has a channel', () => {
  const empty = emptyGuildConfig('g');
  assert.deepEqual(empty.board, { channelId: null, messageId: null, enabled: false });
  assert.deepEqual(empty.alerts, { enabled: true }, 'milestones start on');

  const off = normalizeGuildConfig({ board: { channelId: '123456789012345678', enabled: true } }, 'g');
  assert.equal(off.board.channelId, '123456789012345678');
  assert.equal(off.board.enabled, true);
  assert.equal(off.board.messageId, null);

  const noChannel = normalizeGuildConfig({ board: { enabled: true, messageId: '999999999999999999' } }, 'g');
  assert.equal(noChannel.board.enabled, false, 'a board with nowhere to post is off');
  assert.equal(noChannel.board.messageId, '999999999999999999');

  const junk = normalizeGuildConfig({ board: { channelId: 'not-a-channel', enabled: true } }, 'g');
  assert.equal(junk.board.channelId, null);
  assert.equal(junk.board.enabled, false);
});

test('milestones can be turned off and survive a reload', () => {
  const config = normalizeGuildConfig({ alerts: { enabled: false } }, 'g');
  assert.equal(config.alerts.enabled, false);
  assert.equal(normalizeGuildConfig({}, 'g').alerts.enabled, true);
  assert.equal(normalizeGuildConfig({ alerts: 'nonsense' }, 'g').alerts.enabled, true);
});

test('milestones and outages can be switched off separately', () => {
  const empty = emptyGuildConfig('g');
  assert.deepEqual(empty.alerts, { enabled: true, milestones: true, outage: true }, 'both start on');

  const off = normalizeGuildConfig({ alerts: { milestones: false } }, 'g');
  assert.equal(off.alerts.milestones, false);
  assert.equal(off.alerts.outage, true, 'one switch does not move the other');

  const both = normalizeGuildConfig({ alerts: { outage: false } }, 'g');
  assert.equal(both.alerts.outage, false);
  assert.equal(both.alerts.milestones, true);

  const master = normalizeGuildConfig({ alerts: { enabled: false, milestones: true } }, 'g');
  assert.equal(master.alerts.enabled, false, 'the master switch survives');
});
