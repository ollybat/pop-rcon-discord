/**
 * Watches for outages that last, and for the recovery afterwards.
 *
 * The rules are deliberately dull, because a false "your server is down" is worse than a late
 * one: a server has to have been seen up at least once, the outage has to pass a threshold, and
 * each outage is announced exactly once, in both directions.
 */

/** What a run of unconnected snapshots means. Pure, so it is easy to reason about. */
export function outageDecision({ state = null, connected = false, seenUp = false, now = Date.now(), downAfterSeconds = 300, lastError = null } = {}) {
  if (connected) {
    if (!state) return { action: 'none', state: null };
    const seconds = Math.max(0, Math.round((now - state.since) / 1000));
    // Only the outages somebody was told about are worth a recovery message.
    return { action: state.alerted ? 'recovered' : 'quiet', state: null, seconds };
  }

  if (!seenUp) return { action: 'none', state: null };

  const current = state ?? { since: now, alerted: false, error: lastError };
  const seconds = Math.max(0, Math.round((now - current.since) / 1000));

  if (!current.alerted && seconds >= downAfterSeconds) {
    return { action: 'down', state: { ...current, alerted: true, error: lastError ?? current.error }, seconds };
  }

  return { action: 'none', state: { ...current, error: lastError ?? current.error } };
}

export function outageText(seconds) {
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  if (minutes < 1) return total + 's';
  if (minutes < 60) return minutes + 'm';
  const hours = Math.floor(minutes / 60);
  return hours + 'h ' + (minutes % 60) + 'm';
}

/**
 * Feeds snapshots in and calls `notify` when something is worth saying. State is per server and
 * lives in memory only: a restart of the bot starts the clock again rather than shouting about
 * an outage it slept through.
 */
export function createServerWatch({ notify = null, downAfterSeconds = 300, now = () => Date.now(), logger = console } = {}) {
  const state = new Map();
  const seenUp = new Set();

  const keyOf = (guildId, snapshot) => String(guildId) + ':' + (snapshot?.slot ?? '?');

  async function observe(guildId, snapshot) {
    if (!snapshot) return { action: 'none' };
    const key = keyOf(guildId, snapshot);
    const connected = Boolean(snapshot.connected);
    if (connected) seenUp.add(key);

    const decision = outageDecision({
      state: state.get(key) ?? null,
      connected,
      seenUp: seenUp.has(key),
      now: now(),
      downAfterSeconds,
      lastError: snapshot.error ?? null,
    });

    if (decision.state) state.set(key, decision.state);
    else state.delete(key);

    if (decision.action === 'none' || decision.action === 'quiet') return decision;

    try {
      await notify?.({ ...decision, guildId, snapshot });
    } catch (error) {
      logger.warn?.('[alerts] could not report ' + decision.action + ': ' + (error && error.message ? error.message : error));
    }

    return decision;
  }

  /** How long a server has been unreachable, or null when it is up. */
  function downFor(guildId, slot, at = now()) {
    const entry = state.get(String(guildId) + ':' + slot);
    return entry ? Math.max(0, Math.round((at - entry.since) / 1000)) : null;
  }

  function forget(guildId, slot = null) {
    if (slot === null) {
      for (const key of [...state.keys()]) if (key.startsWith(String(guildId) + ':')) state.delete(key);
      return;
    }
    state.delete(String(guildId) + ':' + slot);
  }

  return { observe, downFor, forget, state, seenUp };
}
