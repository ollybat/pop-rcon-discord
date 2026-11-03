import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDigestRunner, dayStamp, digestDue, digestFor, shiftDay } from '../src/digest.js';
import { emptyGuildConfig, normalizeGuildConfig, recordPeak } from '../src/store.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };
const CHANNEL = '111111111111111111';

/** A guild with one server and a record of the last `days` days, ending yesterday. */
function guildWithHistory({ at = new Date('2026-11-03T20:00:00.000Z'), peaks = {}, slot = 1, servers = null } = {}) {
  const config = emptyGuildConfig('g');
  config.servers = servers ?? [{ name: 'spinback 5x', host: 'h', port: 28016, password: 'secret' }, null, null];
  for (const [day, peak] of Object.entries(peaks)) {
    recordPeak(config, slot, peak, new Date(day + 'T18:00:00.000Z'));
  }
  config.__at = at;
  return config;
}

function makeStore(configs) {
  const map = new Map(Object.entries(configs));
  return {
    get: (id) => map.get(id) ?? null,
    listGuildIds: () => [...map.keys()],
    update: async (id, fn) => {
      const next = fn(map.get(id));
      map.set(id, next);
      return next;
    },
  };
}

function makeClient({ channelId = CHANNEL, missing = false, sendFails = false } = {}) {
  const sent = [];
  const channel = {
    id: channelId,
    send: async (payload) => {
      if (sendFails) throw new Error('no permission');
      sent.push(payload);
      return { id: 'msg-1' };
    },
  };
  return { client: { channels: { fetch: async () => (missing ? null : channel), cache: new Map([[channelId, channel]]) } }, sent };
}

test('day stamps are UTC, and shifting them crosses months and years', () => {
  assert.equal(dayStamp(new Date('2026-11-03T23:59:59.000Z')), '2026-11-03');
  assert.equal(dayStamp(new Date('2026-11-04T00:00:01.000Z')), '2026-11-04');
  assert.equal(dayStamp('nonsense'), null);
  assert.equal(shiftDay('2026-11-03', -1), '2026-11-02');
  assert.equal(shiftDay('2026-03-01', -1), '2026-02-28');
  assert.equal(shiftDay('2027-01-01', -1), '2026-12-31');
  assert.equal(shiftDay('2026-11-03', 7), '2026-11-10');
});

test('the digest reports yesterday, the week and the best day', () => {
  const config = guildWithHistory({
    peaks: {
      '2026-10-20': 9,
      '2026-10-27': 12,
      '2026-10-28': 14,
      '2026-10-29': 16,
      '2026-10-30': 18,
      '2026-10-31': 31,
      '2026-11-01': 22,
      '2026-11-02': 27,
    },
  });

  const digest = digestFor({ config, at: new Date('2026-11-03T20:00:00.000Z') });
  assert.equal(digest.today, '2026-11-03');
  assert.equal(digest.yesterday, '2026-11-02');
  assert.equal(digest.hasYesterday, true);
  assert.equal(digest.anyRecorded, true);

  const server = digest.servers[0];
  assert.equal(server.name, 'spinback 5x');
  assert.equal(server.yesterday, 27);
  assert.equal(server.dayBefore, 22);
  assert.equal(server.change, 5, 'the day before is the one before yesterday');
  assert.equal(server.week.days, 7, 'all seven days of the window were recorded');
  assert.equal(server.week.average, 20, '9 is outside the window');
  assert.equal(server.previousWeek.average, 9, 'only the one far-off day is in the week before');
  assert.equal(server.previousWeek.days, 1);
  assert.equal(server.trend, 11);
  assert.equal(server.recordedDays, 8);
  assert.equal(server.allTime.peak, 31);
  assert.equal(server.allTime.day, '2026-10-31');
  assert.equal(digest.combined, null, 'one server needs no total');
});

test('a missing day is reported as missing, not as a zero', () => {
  const config = guildWithHistory({ peaks: { '2026-10-01': 18 } });
  const digest = digestFor({ config, at: new Date('2026-11-03T20:00:00.000Z') });
  const server = digest.servers[0];

  assert.equal(server.yesterday, null);
  assert.equal(server.change, null, 'nothing to compare');
  assert.equal(digest.hasYesterday, false);
  assert.equal(server.week.days, 0, 'the old day is outside the window');
  assert.equal(server.dayBefore, null, 'and so is the day before yesterday');
  assert.equal(server.week.average, null);
  assert.equal(server.recordedDays, 1);
  assert.equal(digest.anyRecorded, true, 'there is history, just not for yesterday');

  const empty = digestFor({ config: emptyGuildConfig('g'), at: new Date('2026-11-03T20:00:00.000Z') });
  assert.equal(empty.anyRecorded, false, 'no servers, nothing recorded');
  assert.deepEqual(empty.servers, []);
});

test('two servers get a combined line for the days both had a reading', () => {
  const config = guildWithHistory({
    servers: [{ name: 'one', host: 'a', port: 28016, password: 'p' }, { name: 'two', host: 'b', port: 28016, password: 'p' }, null],
    peaks: { '2026-11-02': 27 },
  });
  recordPeak(config, 2, 40, new Date('2026-11-02T19:00:00.000Z'));
  recordPeak(config, 2, 5, new Date('2026-11-01T19:00:00.000Z'));

  const digest = digestFor({ config, at: new Date('2026-11-03T20:00:00.000Z') });
  assert.equal(digest.servers.length, 2);
  assert.equal(digest.servers[1].yesterday, 40);
  assert.equal(digest.combined, 67);
});

test('the digest is only due when it is on, has a channel, the hour has come, and today is unsent', () => {
  const base = { enabled: true, channelId: CHANNEL, hour: 20, lastSent: null };
  const at = new Date('2026-11-03T20:30:00.000Z');

  assert.equal(digestDue({ config: { digest: base }, at }), true);
  assert.equal(digestDue({ config: { digest: { ...base, enabled: false } }, at }), false);
  assert.equal(digestDue({ config: { digest: { ...base, channelId: null } }, at }), false);
  assert.equal(digestDue({ config: { digest: base }, at: new Date('2026-11-03T19:59:00.000Z') }), false, 'before the hour');
  assert.equal(digestDue({ config: { digest: { ...base, lastSent: '2026-11-03' } }, at }), false, 'already sent today');
  assert.equal(digestDue({ config: { digest: { ...base, lastSent: '2026-11-02' } }, at }), true, 'yesterday does not count');
  assert.equal(digestDue({ config: { digest: { ...base, hour: null } }, at, defaultHour: 21 }), false, 'the default hour applies');
  assert.equal(digestDue({ config: {}, at }), false);
});

test('the runner sends once a day and remembers the day it sent', async () => {
  const config = guildWithHistory({ peaks: { '2026-11-02': 27 } });
  config.digest = { enabled: true, channelId: CHANNEL, hour: 20, lastSent: null };
  const store = makeStore({ g: config });
  const { client, sent } = makeClient();
  const runner = createDigestRunner({
    client,
    store,
    logger: silentLogger,
    now: () => new Date('2026-11-03T20:05:00.000Z'),
    build: ({ config: guildConfig, at }) => ({ embeds: [digestFor({ config: guildConfig, at })] }),
  });

  const first = await runner.runDue();
  assert.equal(first[0].sent, true);
  assert.equal(sent.length, 1);
  assert.equal(store.get('g').digest.lastSent, '2026-11-03', 'the day is written down');

  const second = await runner.runDue();
  assert.equal(second[0].sent, false);
  assert.equal(second[0].reason, 'not due');
  assert.equal(sent.length, 1, 'no second digest the same day');
});

test('a missing channel or a refused send is warned about once, and retried the next day', async () => {
  const config = guildWithHistory({ peaks: { '2026-11-02': 27 } });
  config.digest = { enabled: true, channelId: CHANNEL, hour: 20, lastSent: null };
  const store = makeStore({ g: config });
  const warnings = [];
  const logger = { ...silentLogger, warn: (line) => warnings.push(line) };

  const gone = createDigestRunner({ client: makeClient({ missing: true }).client, store, logger, now: () => new Date('2026-11-03T20:05:00.000Z'), build: () => ({ embeds: [] }) });
  assert.equal((await gone.runDue())[0].sent, false);
  assert.equal((await gone.runDue())[0].sent, false);
  assert.equal(warnings.length, 1, 'a gone channel is not reported every minute');
  assert.equal(store.get('g').digest.lastSent, null, 'nothing was sent, so nothing is recorded');

  const refused = createDigestRunner({ client: makeClient({ sendFails: true }).client, store, logger, now: () => new Date('2026-11-03T20:05:00.000Z'), build: () => ({ embeds: [] }) });
  assert.equal((await refused.runDue())[0].sent, false);
  assert.equal(store.get('g').digest.lastSent, null);
  assert.equal(warnings.length, 2);
});

test('the runner can be started and stopped without leaving a timer behind', async () => {
  const config = guildWithHistory({ peaks: { '2026-11-02': 27 } });
  config.digest = { enabled: true, channelId: CHANNEL, hour: 20, lastSent: null };
  const store = makeStore({ g: config });
  const runner = createDigestRunner({ client: makeClient().client, store, logger: silentLogger, now: () => new Date('2026-11-03T20:05:00.000Z'), build: () => ({ embeds: [] }) });

  const timer = runner.start(30);
  assert.ok(timer);
  assert.equal(runner.start(30), timer, 'starting twice does not stack timers');
  runner.stop();
  assert.ok(runner.start(30), 'and it can start again');
  runner.stop();
});

test('a guild with nothing to say is left alone', async () => {
  const config = normalizeGuildConfig({ servers: [{ name: 's', host: 'h', port: 28016, password: 'p' }] }, 'g');
  const store = makeStore({ g: config });
  const { client, sent } = makeClient();
  const runner = createDigestRunner({ client, store, logger: silentLogger, now: () => new Date('2026-11-03T20:05:00.000Z'), build: () => ({ embeds: [] }) });

  const results = await runner.runDue();
  assert.equal(results[0].sent, false);
  assert.equal(sent.length, 0, 'the digest is off, so nothing is posted');
});
