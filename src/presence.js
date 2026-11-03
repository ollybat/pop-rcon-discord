import { ActivityType } from 'discord.js';
import { COLORS, STATUS } from './theme.js';
import { serverVerdict } from './health.js';

export const STATE = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  RESTING: 'resting',
  PROBLEM: 'problem',
};

// The colour of the bot's own status dot for each RCON state.
const DOT = {
  online: 'online',
  offline: 'dnd',
  resting: 'idle',
  problem: 'idle',
};

export { COLORS, STATUS };

/**
 * Fill the placeholders in a presence template.
 * Unknown placeholders are left alone so a typo shows up instead of going unnoticed.
 */
export function formatPresence(template, info = {}) {
  const values = {
    players: info.players ?? '—',
    max: info.max ?? '—',
    maxPlayers: info.max ?? '—',
    queued: info.queued ?? 0,
    joining: info.joining ?? 0,
    uptime: info.uptime ?? '—',
    peak: info.peak ?? '—',
    map: info.map ?? '—',
    servers: info.servers ?? '—',
  };

  let text = String(template ?? '');
  for (const [key, value] of Object.entries(values)) {
    text = text.split('{' + key + '}').join(String(value));
  }
  return text;
}

/** Turn a Rust `serverinfo` reply into the few fields the presence needs. */
export function normalizeServerInfo(data) {
  if (!data || typeof data !== 'object') return null;

  const toNumber = (value) => (Number.isFinite(Number(value)) ? Number(value) : null);

  return {
    players: toNumber(data.Players) ?? 0,
    max: toNumber(data.MaxPlayers) ?? 0,
    queued: toNumber(data.Queued) ?? 0,
    joining: toNumber(data.Joining) ?? 0,
    uptime: toNumber(data.Uptime),
    restarting: data.Restarting === true,
    hostname: String(data.Server ?? data.Hostname ?? 'Rust server'),
    // Rust reports these too; they make /pop and /ping far more interesting.
    map: data.Map ? String(data.Map) : null,
    framerate: toNumber(data.Framerate),
    entityCount: toNumber(data.EntityCount),
    memory: toNumber(data.Memory),
  };
}

/** Sum several server snapshots so one status line can cover every server. */
export function aggregateInfos(snapshots) {
  const online = (snapshots ?? []).filter((snapshot) => snapshot && snapshot.connected && snapshot.info);
  if (online.length === 0) return null;

  return online.reduce(
    (total, snapshot) => ({
      players: total.players + snapshot.info.players,
      max: total.max + snapshot.info.max,
      queued: total.queued + snapshot.info.queued,
      joining: total.joining + snapshot.info.joining,
      uptime: total.uptime === null ? snapshot.info.uptime : Math.min(total.uptime, snapshot.info.uptime ?? total.uptime),
      restarting: total.restarting && snapshot.info.restarting,
      hostname: online.length === 1 ? snapshot.info.hostname : online.length + ' servers',
      servers: online.length,
      // A map only makes sense for a single server, so it stays null when several are summed.
      map: online.length === 1 ? snapshot.info.map ?? null : null,
      // The day's peak: the highest of the servers that are online.
      peak: Math.max(total.peak ?? 0, snapshot.info.peak ?? 0) || null,
      framerate: null,
      entityCount: total.entityCount + (snapshot.info.entityCount ?? 0),
      memory: total.memory + (snapshot.info.memory ?? 0),
    }),
    { players: 0, max: 0, queued: 0, joining: 0, uptime: null, restarting: true, hostname: null, servers: 0, map: null, framerate: null, entityCount: 0, memory: 0 },
  );
}

/**
 * Is the server up but clearly not well? RCON connecting is not the same as the server being
 * happy: a Rust map at four frames a second, an RCON round-trip of seconds, or a socket that
 * never answers serverinfo all look like an online server from the outside.
 */
export function struggling(snapshot) {
  if (!snapshot?.connected) return false;
  if (!snapshot.info) return true;
  return serverVerdict(snapshot).id === 'strained';
}

/**
 * Decide which of the four states the server is in.
 * snapshot: { connected, reconnecting, info }
 */
export function presenceFor(snapshot, options = {}) {
  const formats = options.formats ?? {};
  const problemOn = options.problem !== false;

  if (!snapshot.connected) {
    const state = options.restingOnReconnect && snapshot.reconnecting ? STATE.RESTING : STATE.OFFLINE;
    return { state, text: formatPresence(formats[state]) };
  }

  if (!snapshot.info) {
    // Socket is up but the server did not answer, so there are no counts to show. That is either
    // the ⚠️ state or, with the mode off, plain silence.
    const state = problemOn ? STATE.PROBLEM : STATE.OFFLINE;
    return { state, text: formatPresence(formats[state]) };
  }

  if (snapshot.info.restarting) {
    return { state: STATE.RESTING, text: formatPresence(formats.resting) };
  }

  if (problemOn && struggling(snapshot)) {
    return { state: STATE.PROBLEM, text: formatPresence(formats.problem) };
  }

  return { state: STATE.ONLINE, text: formatPresence(formats.online, snapshot.info) };
}

/**
 * Keeps the bot's "Watching ..." line - its bio - in sync with the Rust servers.
 * The provider is an async function returning { connected, reconnecting, info }.
 */
export class PresenceManager {
  constructor({ client, provider, options, logger = console }) {
    this.client = client;
    this.provider = provider;
    this.options = options;
    this.logger = logger;
    this.state = null;
    this.text = null;
    this.info = null;
    this.timer = null;
  }

  async start() {
    if (!this.options.enabled) {
      this.logger.info('[presence] disabled by configuration');
      return;
    }

    const refresh = () => {
      this.refresh().catch((error) => this.logger.warn('[presence] refresh failed: ' + error.message));
    };

    await this.refresh();

    this.timer = setInterval(refresh, this.options.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  async refresh() {
    let snapshot = { connected: false, reconnecting: false, info: null };

    try {
      snapshot = (await this.provider()) ?? snapshot;
    } catch (error) {
      this.logger.warn('[presence] could not read the server state: ' + error.message);
    }

    this.info = snapshot.info ?? null;

    // The line says what the server is doing and nothing else. Which state that is follows the
    // guild's own switch for the ⚠️ PROBLEM mode, read fresh every poll so /setup applies at once.
    const problem = typeof this.options.problem === 'function' ? this.options.problem() : this.options.problem !== false;
    this.apply(presenceFor(snapshot, { ...this.options, problem }));
  }

  apply(next) {
    if (next.state === this.state && next.text === this.text) return;

    const previous = this.state;
    this.state = next.state;
    this.text = next.text;

    this.client.user?.setPresence({
      // Discord caps an activity name at 128 characters.
      activities: [{ name: next.text.slice(0, 128), type: ActivityType.Watching }],
      status: DOT[next.state] ?? 'online',
    });

    if (previous !== next.state) {
      this.logger.info('[presence] ' + (previous ?? 'unknown') + ' -> ' + next.state + ' (' + next.text + ')');
    }
  }
}
