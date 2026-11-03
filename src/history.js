/**
 * A short, in-memory memory of what every Rust server has been doing.
 *
 * /pop uses it for the trend arrow ("▲ +3 since the last reading"), the ▁▂▄▆█ shape of the last
 * few minutes and the average, and to know who walked in a moment ago. Nothing is written to disk:
 * the daily peaks in the guild config are the durable half.
 */

export const DEFAULT_POINTS = 30;
export const NEWCOMER_WINDOW_MS = 2 * 60 * 1000;

/** One key per server: a guild id and a slot. */
export function slotKey(guildId, slot) {
  return String(guildId ?? '?') + '#' + Number(slot ?? 0);
}

export function createHistoryStore({ points = DEFAULT_POINTS } = {}) {
  const samples = new Map();
  const rosters = new Map();
  const limit = Math.max(2, Number(points) || DEFAULT_POINTS);

  /** Remember one reading. Returns the stored sample, or null when there was nothing to store. */
  function push(key, info, at = Date.now()) {
    const players = Number(info?.players);
    if (!info || !Number.isFinite(players)) return null;

    const ms = at instanceof Date ? at.getTime() : Number(at);
    const sample = {
      at: Number.isFinite(ms) ? ms : Date.now(),
      players: Math.max(0, Math.floor(players)),
      max: Number.isFinite(Number(info.max)) ? Math.floor(Number(info.max)) : null,
      queued: Number.isFinite(Number(info.queued)) ? Math.floor(Number(info.queued)) : 0,
    };

    const list = samples.get(String(key)) ?? [];
    list.push(sample);
    while (list.length > limit) list.shift();
    samples.set(String(key), list);
    return sample;
  }

  function series(key, count = null) {
    const list = samples.get(String(key)) ?? [];
    return Number.isFinite(count) && count > 0 ? list.slice(-Math.floor(count)) : [...list];
  }

  function latest(key) {
    const list = samples.get(String(key)) ?? [];
    return list.length ? list[list.length - 1] : null;
  }

  /** The reading `steps` samples ago (default: the one before the latest). */
  function previous(key, steps = 1) {
    const list = samples.get(String(key)) ?? [];
    const back = Math.max(1, Math.floor(steps)) + 1;
    return list.length >= back ? list[list.length - back] : null;
  }

  /** How many players changed since that older reading: +3, -2 or 0. null when there is no history. */
  function delta(key, steps = 1) {
    const now = latest(key);
    const before = previous(key, steps);
    if (!now || !before) return null;
    return now.players - before.players;
  }

  function average(key) {
    const list = samples.get(String(key)) ?? [];
    if (list.length === 0) return null;
    return Math.round((list.reduce((sum, sample) => sum + sample.players, 0) / list.length) * 10) / 10;
  }

  /** The busiest reading in the window - not the same thing as the day's peak. */
  function windowPeak(key) {
    const list = samples.get(String(key)) ?? [];
    if (list.length === 0) return null;
    return list.reduce((best, sample) => (sample.players > best.players ? sample : best), list[0]);
  }

  /**
   * Note who is on the server right now. Keeps the first time we saw each player, and prunes the
   * ones who left, so it stays the size of the roster.
   */
  function observeRoster(key, players = [], at = Date.now()) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    const now = Number.isFinite(ms) ? ms : Date.now();
    const id = String(key);
    const entry = rosters.get(id) ?? { seen: new Map(), lastIds: new Set() };

    const rows = [];
    const current = new Set();

    for (const player of Array.isArray(players) ? players : []) {
      const playerId = String(player?.id ?? '');
      if (!playerId) continue;
      current.add(playerId);
      if (!entry.seen.has(playerId)) entry.seen.set(playerId, now);
      const since = entry.seen.get(playerId);
      rows.push({
        id: playerId,
        name: player?.name ?? 'unknown',
        ping: Number.isFinite(Number(player?.ping)) ? Number(player.ping) : null,
        since,
        seconds: Math.max(0, Math.round((now - since) / 1000)),
        isNew: now - since <= NEWCOMER_WINDOW_MS,
      });
    }

    for (const playerId of [...entry.seen.keys()]) if (!current.has(playerId)) entry.seen.delete(playerId);
    entry.lastIds = current;
    rosters.set(id, entry);
    return rows;
  }

  /** What observeRoster remembered for this server, newest arrival first. */
  function roster(key) {
    const entry = rosters.get(String(key));
    if (!entry) return [];
    const now = Date.now();
    return [...entry.seen.entries()]
      .map(([id, since]) => ({
        id,
        since,
        seconds: Math.max(0, Math.round((now - since) / 1000)),
        isNew: now - since <= NEWCOMER_WINDOW_MS,
      }))
      .sort((a, b) => a.seconds - b.seconds);
  }

  function forget(key) {
    samples.delete(String(key));
    rosters.delete(String(key));
  }

  function reset() {
    samples.clear();
    rosters.clear();
  }

  return { points: limit, push, series, latest, previous, delta, average, windowPeak, observeRoster, roster, forget, reset };
}

/** The bot has one history; tests build their own with createHistoryStore(). */
export const history = createHistoryStore();
