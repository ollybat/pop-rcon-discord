/**
 * The daily digest: what yesterday looked like, from the one thing the bot stores per day.
 *
 * The bot keeps a line per server per day - the busiest moment it saw - and nothing else. Every
 * number here comes from those lines, so a day the bot was not watching is reported as missing
 * rather than as a zero.
 */
import { bestFor, configuredServers, historyFor } from './store.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** The UTC stamp the store uses for a day, so the two agree on what "yesterday" means. */
export function dayStamp(at = new Date()) {
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

export function shiftDay(stamp, days) {
  const date = new Date(String(stamp) + 'T00:00:00.000Z');
  if (Number.isNaN(date.getTime())) return null;
  return dayStamp(new Date(date.getTime() + days * DAY_MS));
}

function peaksByDay(config, slot) {
  const map = new Map();
  for (const entry of historyFor(config, slot)) map.set(entry.day, entry.peak);
  return map;
}

function windowAverage(peaks, from, days) {
  const values = [];
  for (let index = 0; index < days; index += 1) {
    const stamp = shiftDay(from, -index);
    if (peaks.has(stamp)) values.push(peaks.get(stamp));
  }
  if (values.length === 0) return { average: null, days: 0 };
  return { average: Math.round(values.reduce((sum, value) => sum + value, 0) / values.length), days: values.length };
}

/**
 * Everything the digest says, per server and together. `yesterday` is the day being reported on;
 * the windows are the seven recorded days ending then, and the seven before those.
 */
export function digestFor({ config = null, at = new Date(), window = 7 } = {}) {
  const today = dayStamp(at);
  const yesterday = shiftDay(today, -1);
  const weekStart = yesterday;
  const previousStart = shiftDay(yesterday, -window);

  const servers = configuredServers(config).map((server) => {
    const peaks = peaksByDay(config, server.slot);
    const yesterdayPeak = peaks.get(yesterday) ?? null;
    const dayBefore = peaks.get(shiftDay(yesterday, -1)) ?? null;
    const thisWeek = windowAverage(peaks, weekStart, window);
    const lastWeek = windowAverage(peaks, previousStart, window);
    const best = bestFor(config, server.slot);

    return {
      slot: server.slot,
      name: server.name,
      yesterday: yesterdayPeak,
      dayBefore,
      change: yesterdayPeak !== null && dayBefore !== null ? yesterdayPeak - dayBefore : null,
      week: thisWeek,
      previousWeek: lastWeek,
      trend: thisWeek.average !== null && lastWeek.average !== null ? thisWeek.average - lastWeek.average : null,
      allTime: best && best.peak ? best : null,
      recordedDays: peaks.size,
    };
  });

  const withData = servers.filter((server) => server.yesterday !== null);
  const combined =
    servers.length > 1 && withData.length > 0
      ? withData.reduce((sum, server) => sum + server.yesterday, 0)
      : null;

  const anyRecorded = servers.reduce((sum, server) => sum + server.recordedDays, 0) > 0;

  return { today, yesterday, window, servers, combined, anyRecorded, hasYesterday: withData.length > 0 };
}

/** Should the digest go out now? Enabled, has a channel, the hour is reached, not sent today. */
export function digestDue({ config = null, at = new Date(), defaultHour = 20 } = {}) {
  const settings = config?.digest ?? null;
  if (!settings?.enabled || !settings.channelId) return false;

  const hour = Number.isInteger(settings.hour) ? settings.hour : defaultHour;
  const date = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(date.getTime()) || date.getUTCHours() < hour) return false;

  return settings.lastSent !== dayStamp(date);
}

/**
 * Sends the digest once a day per guild. Failures are warned about once per guild per day, so a
 * revoked permission does not turn into a message a minute.
 */
export function createDigestRunner({
  client = null,
  store,
  logger = console,
  now = () => new Date(),
  defaultHour = 20,
  build = null,
} = {}) {
  const warned = new Set();
  let timer = null;

  async function channelFor(channelId) {
    const fetched = await client?.channels?.fetch?.(channelId).catch(() => null);
    return fetched ?? client?.channels?.cache?.get?.(channelId) ?? null;
  }

  async function runGuild(guildId) {
    const at = now();
    const config = store.get(guildId);
    if (!digestDue({ config, at, defaultHour })) return { sent: false, reason: 'not due' };

    const stamp = dayStamp(at);
    const channel = await channelFor(config.digest.channelId);
    if (!channel || typeof channel.send !== 'function') {
      warnOnce(guildId + ':' + stamp, '[digest] ' + guildId + ': the digest channel is gone');
      return { sent: false, reason: 'no channel' };
    }

    const payload = build ? build({ config, at, guildId }) : null;
    if (!payload) return { sent: false, reason: 'nothing to build' };

    const sent = await channel.send(payload).then(() => true).catch(() => false);
    if (!sent) {
      warnOnce(guildId + ':' + stamp, '[digest] ' + guildId + ': could not post the digest');
      return { sent: false, reason: 'send failed' };
    }

    // Recorded only after it went out, so a failure is retried on the next pass.
    await store.update(guildId, (next) => {
      next.digest.lastSent = stamp;
      return next;
    }).catch(() => null);

    return { sent: true };
  }

  function warnOnce(key, line) {
    if (warned.has(key)) return;
    warned.add(key);
    logger.warn?.(line);
  }

  async function runDue() {
    const results = [];
    for (const guildId of store.listGuildIds()) {
      results.push(await runGuild(guildId).catch(() => ({ sent: false, reason: 'error' })));
    }
    return results;
  }

  /** Check every minute instead of trying to guess when a day starts. */
  function start(intervalSeconds = 60) {
    if (timer) return timer;
    timer = setInterval(() => runDue().catch(() => null), Math.max(30, intervalSeconds) * 1000);
    timer.unref?.();
    return timer;
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { runDue, runGuild, start, stop, warned };
}
