/**
 * Small runtime counters, so /ping can answer "is this thing healthy?" with numbers instead of a
 * feeling. Everything is in memory: a restart is meant to zero it.
 */

export const STAT_KEYS = ['polls', 'commands', 'dmForwarded', 'dmAnswered', 'dmReplied', 'errors', 'rconErrors', 'peaks'];
export const RECENT_ERROR_LIMIT = 5;

export function createStats({ startedAt = Date.now() } = {}) {
  const counts = new Map(STAT_KEYS.map((key) => [key, 0]));
  const recent = [];
  let lastError = null;
  let lastErrorAt = null;

  function inc(key, by = 1) {
    const name = String(key);
    counts.set(name, (counts.get(name) ?? 0) + (Number(by) || 1));
  }

  function get(key) {
    return counts.get(String(key)) ?? 0;
  }

  /** Remember a failure. The message is kept short and never longer than one line. */
  function note(message, { key = 'errors' } = {}) {
    inc(key);
    const text = String(message ?? 'unknown error').replace(/\s+/g, ' ').slice(0, 160);
    lastError = text;
    lastErrorAt = new Date().toISOString();
    recent.unshift({ at: lastErrorAt, message: text });
    while (recent.length > RECENT_ERROR_LIMIT) recent.pop();
    return text;
  }

  function reset() {
    for (const key of counts.keys()) counts.set(key, 0);
    recent.length = 0;
    lastError = null;
    lastErrorAt = null;
  }

  /** A plain object (safe for JSON) with everything /ping and /health want to show. */
  function snapshot(at = Date.now()) {
    const ms = at instanceof Date ? at.getTime() : Number(at);
    const now = Number.isFinite(ms) ? ms : Date.now();
    const out = { uptimeSeconds: Math.max(0, Math.round((now - startedAt) / 1000)), startedAt: new Date(startedAt).toISOString() };
    for (const key of STAT_KEYS) out[key] = get(key);
    out.lastError = lastError;
    out.lastErrorAt = lastErrorAt;
    out.recentErrors = recent.map((entry) => ({ ...entry }));
    return out;
  }

  return { startedAt, inc, get, note, reset, snapshot, counts };
}

/** The own process counters. */
export const stats = createStats();
