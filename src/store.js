import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { chmodSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export const MAX_SERVERS = 3;
export const CONFIG_VERSION = 3;

/** How many days of peaks are kept per server. */
export const HISTORY_DAYS = 90;

export function emptyGuildConfig(guildId) {
  return {
    version: CONFIG_VERSION,
    guildId,
    roles: { owner: null, coOwner: null, headAdmin: null, admin: null, moderator: null },
    logs: { joinLeave: null, commands: null, errors: null, status: null },
    servers: [null, null, null],
    // The optional live population board: one channel, one message the bot keeps up to date.
    board: { channelId: null, messageId: null, enabled: false },
    // What the bot is allowed to shout about: milestones (a new peak, a full server, a queue
    // forming), an outage that lasts, and the recovery afterwards.
    alerts: { enabled: true, milestones: true, outage: true },
    // The daily digest: yesterday's numbers, once a day, in a channel of your choosing.
    digest: { enabled: false, channelId: null, hour: null, lastSent: null },

    // slot -> { day, peak, peakAt }: the busiest moment of the current UTC day.
    stats: {},
    updatedAt: null,
  };
}

function cleanId(value) {
  const text = String(value ?? '').trim();
  return /^[0-9]{5,25}$/.test(text) ? text : null;
}

/** Accepts what a modal or the env can produce and returns a server entry or a reason. */
export function normalizeServerInput({ name, host, port, password } = {}) {
  const cleanHost = String(host ?? '').trim().replace(/^wss?:\/\//i, '').replace(/\/.*$/, '');
  const cleanPort = Number(String(port ?? '').trim() || 28016);
  const cleanName = String(name ?? '').trim();
  const cleanPassword = String(password ?? '');

  if (!cleanHost || /\s/.test(cleanHost)) return { ok: false, error: 'The server address does not look like a hostname or IP.' };
  if (!Number.isInteger(cleanPort) || cleanPort < 1 || cleanPort > 65535) {
    return { ok: false, error: 'The RCON port must be a whole number between 1 and 65535.' };
  }
  if (!cleanPassword) return { ok: false, error: 'The RCON password cannot be empty - it must match +rcon.password.' };

  return {
    ok: true,
    value: {
      name: cleanName || cleanHost,
      host: cleanHost,
      port: cleanPort,
      password: cleanPassword,
    },
  };
}

export function normalizeGuildConfig(raw, guildId) {
  const base = emptyGuildConfig(guildId ?? raw?.guildId ?? null);
  if (!raw || typeof raw !== 'object') return base;

  const config = base;
  config.version = Number(raw.version) || CONFIG_VERSION;

  for (const key of Object.keys(base.roles)) config.roles[key] = cleanId(raw.roles?.[key]);
  for (const key of Object.keys(base.logs)) config.logs[key] = cleanId(raw.logs?.[key]);

  const servers = Array.isArray(raw.servers) ? raw.servers : [];
  for (let slot = 0; slot < MAX_SERVERS; slot += 1) {
    const entry = servers[slot];
    if (!entry || typeof entry !== 'object') continue;

    const cleaned = normalizeServerInput(entry);
    config.servers[slot] = cleaned.ok
      ? { ...cleaned.value, name: String(entry.name ?? '').trim() || cleaned.value.host }
      : null;
  }

  const boardChannel = cleanId(raw.board?.channelId);
  config.board = {
    channelId: boardChannel,
    messageId: cleanId(raw.board?.messageId),
    // A board without a channel is meaningless, so it is never "on" without one.
    enabled: raw.board?.enabled === true && Boolean(boardChannel),
  };
  const digestHour = Math.floor(Number(raw.digest?.hour));
  config.digest = {
    enabled: raw.digest?.enabled === true && Boolean(cleanId(raw.digest?.channelId)),
    channelId: cleanId(raw.digest?.channelId),
    hour: Number.isInteger(digestHour) && digestHour >= 0 && digestHour <= 23 ? digestHour : null,
    lastSent: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.digest?.lastSent ?? '')) ? String(raw.digest.lastSent) : null,
  };

  config.alerts = {
    enabled: raw.alerts?.enabled !== false,
    milestones: raw.alerts?.milestones !== false,
    outage: raw.alerts?.outage !== false,
  };

  config.stats = normalizeStats(raw.stats);
  config.updatedAt = typeof raw.updatedAt === 'string' ? raw.updatedAt : null;
  return config;
}

function normalizeStats(raw) {
  const stats = {};
  if (!raw || typeof raw !== 'object') return stats;

  for (const [key, entry] of Object.entries(raw)) {
    if (!/^[123]$/.test(key)) continue;
    if (!entry || typeof entry !== 'object') continue;

    const day = String(entry.day ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;

    const peak = Math.max(0, Math.floor(Number(entry.peak) || 0));
    const days = cleanDays(entry.days);
    if (!(day in days)) days[day] = peak;

    stats[key] = {
      day,
      peak,
      peakAt: typeof entry.peakAt === 'string' ? entry.peakAt : null,
      best: cleanBest(entry.best, days),
      days: pruneDays(days),
    };
  }

  return stats;
}

/** A { 'YYYY-MM-DD': players } map with the junk removed. */
function cleanDays(raw) {
  const days = {};
  if (!raw || typeof raw !== 'object') return days;

  for (const [day, value] of Object.entries(raw)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const count = Number(value);
    if (!Number.isFinite(count) || count < 0) continue;
    days[day] = Math.floor(count);
  }

  return days;
}

/** Keep the newest HISTORY_DAYS days. */
function pruneDays(days) {
  const keys = Object.keys(days).sort();
  if (keys.length <= HISTORY_DAYS) return days;

  const kept = {};
  for (const day of keys.slice(keys.length - HISTORY_DAYS)) kept[day] = days[day];
  return kept;
}

/** The best day ever: the stored one if it is valid, otherwise the best in the history. */
function cleanBest(raw, days) {
  const stored = raw && typeof raw === 'object' ? Number(raw.peak) : NaN;
  if (Number.isFinite(stored) && stored >= 0) {
    return {
      peak: Math.floor(stored),
      day: /^\d{4}-\d{2}-\d{2}$/.test(String(raw.day ?? '')) ? String(raw.day) : null,
      at: typeof raw.at === 'string' ? raw.at : null,
    };
  }

  const entries = Object.entries(days);
  if (entries.length === 0) return null;

  let best = { peak: -1, day: null, at: null };
  for (const [day, count] of entries) if (count > best.peak) best = { peak: count, day, at: null };
  return best.peak >= 0 ? best : null;
}

/** The UTC day a timestamp belongs to, as YYYY-MM-DD. */
export function dayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 10);
}

/**
 * Remember the busiest moment of the day for one server slot.
 * Returns true when something actually changed, so callers only write to disk on a new peak.
 */
export function recordPeak(config, slot, players, at = new Date()) {
  const value = Number(players);
  if (!config || !Number.isFinite(value) || value < 0) return false;

  if (!config.stats || typeof config.stats !== 'object') config.stats = {};

  const key = String(slot);
  const day = dayKey(at);
  if (!day) return false;

  const stamp = at instanceof Date ? at.toISOString() : new Date(at).toISOString();
  const count = Math.floor(value);
  const entry = config.stats[key] ?? { day: '', peak: 0, peakAt: null, best: null, days: {} };
  entry.days = cleanDays(entry.days);

  let changed = false;
  if (entry.day !== day) {
    entry.day = day;
    entry.peak = count;
    entry.peakAt = stamp;
    changed = true;
  } else if (count > entry.peak) {
    entry.peak = count;
    entry.peakAt = stamp;
    changed = true;
  }

  if (count > (entry.days[day] ?? -1)) entry.days[day] = count;
  if (count > (entry.best?.peak ?? -1)) entry.best = { peak: count, day, at: stamp };
  entry.days = pruneDays(entry.days);

  config.stats[key] = entry;
  return changed;
}

/** The best day ever recorded for a slot, or null. */
export function bestFor(config, slot) {
  const entry = config?.stats?.[String(slot)];
  if (!entry) return null;
  return entry.best ?? cleanBest(null, cleanDays(entry.days));
}

/** The recorded days for a slot, newest first. */
export function historyFor(config, slot, limit = HISTORY_DAYS) {
  const days = cleanDays(config?.stats?.[String(slot)]?.days);
  return Object.entries(days)
    .map(([day, peak]) => ({ day, peak }))
    .sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0))
    .slice(0, Math.max(1, limit));
}

/** The busiest recorded days for a slot, highest first. */
export function topDays(config, slot, limit = 5) {
  return historyFor(config, slot, HISTORY_DAYS)
    .sort((a, b) => b.peak - a.peak || (a.day < b.day ? 1 : -1))
    .slice(0, Math.max(1, limit));
}

/** Today's peak for a slot, or null when there is nothing recorded for today. */
export function peakFor(config, slot, at = new Date()) {
  const entry = config?.stats?.[String(slot)];
  if (!entry || entry.day !== dayKey(at)) return null;
  return { peak: entry.peak, at: entry.peakAt };
}

export function configuredServers(config) {
  return (config?.servers ?? [])
    .map((server, index) => (server ? { slot: index + 1, ...server } : null))
    .filter(Boolean);
}

export function describeConfig(config) {
  const roles = Object.entries(config?.roles ?? {}).filter(([, value]) => Boolean(value)).length;
  const logs = Object.entries(config?.logs ?? {}).filter(([, value]) => Boolean(value)).length;
  const servers = configuredServers(config).length;
  const ready = Boolean(config?.roles?.owner) && servers > 0;
  return { roles, logs, servers, ready };
}

/** One JSON file per guild, written atomically so a crash cannot leave half a file. */
export class GuildStore {
  constructor({ dir = './data', logger = console } = {}) {
    this.dir = dir;
    this.logger = logger;
    this.cache = new Map();
    this.writing = new Map();
  }

  dirFor(guildId) {
    return join(this.dir, 'guilds');
  }

  pathFor(guildId) {
    return join(this.dirFor(guildId), guildId + '.json');
  }

  listGuildIds() {
    const dir = this.dirFor(null);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5));
  }

  /** Cached, synchronous read - index.js and the commands use this on every event. */
  get(guildId) {
    return this.cache.get(String(guildId)) ?? emptyGuildConfig(String(guildId));
  }

  has(guildId) {
    return this.cache.has(String(guildId));
  }

  async load(guildId) {
    const id = String(guildId);
    try {
      const text = await readFile(this.pathFor(id), 'utf8');
      const config = normalizeGuildConfig(JSON.parse(text), id);
      this.cache.set(id, config);
      return config;
    } catch (error) {
      if (error && error.code !== 'ENOENT') this.logger.warn('[store] could not read ' + id + ': ' + error.message);
      const config = emptyGuildConfig(id);
      this.cache.set(id, config);
      return config;
    }
  }

  async save(guildId, config) {
    const id = String(guildId);
    const clean = normalizeGuildConfig(config, id);
    clean.updatedAt = new Date().toISOString();
    this.cache.set(id, clean);

    const dir = this.dirFor(id);
    await mkdir(dir, { recursive: true });

    const target = this.pathFor(id);
    const temp = target + '.tmp-' + process.pid;
    await writeFile(temp, JSON.stringify(clean, null, 2) + '\n', { mode: 0o600 });
    await rename(temp, target);
    try {
      chmodSync(target, 0o600);
    } catch {
      // Windows or a filesystem without POSIX modes - not fatal.
    }

    return clean;
  }

  /** Read, mutate, write. The mutator may be async. */
  async update(guildId, mutate) {
    const id = String(guildId);
    const current = this.cache.has(id) ? this.cache.get(id) : await this.load(id);
    const next = (await mutate(structuredCloneSafe(current))) ?? current;
    return this.save(id, next);
  }
}

/** structuredClone is not in every Node 18 build, so clone the plain object by hand. */
function structuredCloneSafe(value) {
  return JSON.parse(JSON.stringify(value));
}
