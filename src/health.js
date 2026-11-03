/**
 * Turns the numbers Rust reports into a short verdict with a reason.
 *
 * Everything here is derived from what the server itself says on the last poll - no guessing, no
 * stored player history - and every verdict carries the reading it came from, so nobody has to
 * trust a colour.
 */

export const VERDICT = {
  healthy: { emoji: '🟢', label: 'answering normally' },
  idle: { emoji: '🟢', label: 'answering, nobody on' },
  full: { emoji: '🟢', label: 'answering, every slot taken' },
  restarting: { emoji: '🟡', label: 'restarting' },
  strained: { emoji: '🟠', label: 'working hard' },
  quiet: { emoji: '🤔', label: 'RCON up, serverinfo silent' },
  offline: { emoji: '📴', label: 'not answering' },
  unknown: { emoji: '⚪', label: 'no reading yet' },
};

/** A restart the bot saw happen, and whether it looked like more than a restart. */
export function recentRestart(snapshot, { now = new Date(), windowMinutes = 30 } = {}) {
  const restart = snapshot?.restart;
  if (!restart || !restart.at) return null;

  const at = new Date(restart.at);
  if (Number.isNaN(at.getTime())) return null;

  const ageMs = now.getTime() - at.getTime();
  if (ageMs < 0 || ageMs > windowMinutes * 60 * 1000) return null;

  return { ...restart, at, ageMs, minutes: Math.max(0, Math.round(ageMs / 60000)) };
}

/**
 * The verdict for one server. `problems` are the raw readings behind a strained verdict, so the
 * embed can show them instead of asking for trust.
 */
export function serverVerdict(snapshot, { now = new Date(), latencyWarnMs = 1500, framerateWarn = 20 } = {}) {
  if (!snapshot) return { id: 'unknown', ...VERDICT.unknown, problems: [], hint: null, restart: null };

  const restart = recentRestart(snapshot, { now });

  if (!snapshot.connected) {
    return {
      id: 'offline',
      ...VERDICT.offline,
      problems: [],
      restart: null,
      hint: snapshot.error ? String(snapshot.error) : null,
    };
  }

  const info = snapshot.info;
  if (!info) {
    return { id: 'quiet', ...VERDICT.quiet, problems: [], hint: 'The RCON session is up but the command did not answer in time.', restart };
  }

  if (info.restarting) return { id: 'restarting', ...VERDICT.restarting, problems: [], hint: 'Rust is between restarts; the map is loading.', restart };

  const problems = [];
  if (Number.isFinite(info.framerate) && info.framerate > 0 && info.framerate < framerateWarn) problems.push(info.framerate + ' fps');
  if (Number.isFinite(snapshot.latencyMs) && snapshot.latencyMs > latencyWarnMs) problems.push('RCON answered in ' + Math.round(snapshot.latencyMs) + ' ms');

  if (problems.length > 0) {
    return { id: 'strained', ...VERDICT.strained, problems, restart, hint: 'That is the map and its population, not the Discord bot.' };
  }

  if (Number.isFinite(info.max) && info.max > 0 && info.players >= info.max) {
    return { id: 'full', ...VERDICT.full, problems: [], restart, hint: info.queued > 0 ? info.queued + ' waiting in the queue.' : null };
  }

  if (info.players === 0) return { id: 'idle', ...VERDICT.idle, problems: [], restart, hint: null };

  return { id: 'healthy', ...VERDICT.healthy, problems: [], restart, hint: null };
}

/** One line for the whole guild, for the top of /ping. */
export function fleetVerdict(verdicts = []) {
  const list = verdicts.filter(Boolean);
  if (list.length === 0) return { emoji: '⚪', label: 'no servers configured yet' };

  const down = list.filter((verdict) => verdict.id === 'offline').length;
  const strained = list.filter((verdict) => verdict.id === 'strained').length;
  const quiet = list.filter((verdict) => verdict.id === 'quiet').length;

  if (down > 0) return { emoji: '📴', label: down === list.length ? 'nothing answers' : down + ' of ' + list.length + ' not answering' };
  if (strained > 0) return { emoji: '🟠', label: strained + ' of ' + list.length + ' working hard' };
  if (quiet > 0) return { emoji: '🤔', label: quiet + ' of ' + list.length + ' silent on serverinfo' };

  return { emoji: '🟢', label: 'every server answers' };
}
