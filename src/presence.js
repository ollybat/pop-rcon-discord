import { ActivityType } from 'discord.js';
import { COLORS, STATUS } from './theme.js';

export const STATE = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  RESTING: 'resting',
};

// The colour of the bot's own status dot for each RCON state.
const DOT = {
  online: 'online',
  offline: 'dnd',
  resting: 'idle',
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
 * Decide which of the three states the server is in.
 * snapshot: { connected, reconnecting, info }
 */
export function presenceFor(snapshot, options) {
  const formats = options.formats ?? {};

  if (!snapshot.connected) {
    const state = options.restingOnReconnect && snapshot.reconnecting ? STATE.RESTING : STATE.OFFLINE;
    return { state, text: formatPresence(formats[state]) };
  }

  if (!snapshot.info) {
    // Socket is up but the server did not answer, so there are no counts to show.
    return { state: STATE.OFFLINE, text: formatPresence(formats.offline) };
  }

  if (snapshot.info.restarting) {
    return { state: STATE.RESTING, text: formatPresence(formats.resting) };
  }

  return { state: STATE.ONLINE, text: formatPresence(formats.online, snapshot.info) };
}

/**
 * Keeps the bot's "Watching ..." activity in sync with the Rust servers.
 * The provider is an async function returning { connected, reconnecting, info }.
 */
export class PresenceManager {
  constructor({ client, provider, options, logger = console }) {
    this.client = client;
    this.provider = provider;
    this.options = options;
    this.logger = logger;
    // Which of the rotating activity frames is next.
    this.tick = 0;

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

    // While the server is online the activity line rotates through the extra frames, so the bot's
    // status is worth a second glance instead of repeating one number forever.
    const frames = Array.isArray(this.options.rotateFrames) ? this.options.rotateFrames.filter(Boolean) : [];
    if (frames.length > 1 && snapshot.connected && snapshot.info && !snapshot.info.restarting) {
      const frame = frames[this.tick % frames.length];
      this.tick += 1;
      this.apply(presenceFor(snapshot, { ...this.options, formats: { ...this.options.formats, online: frame } }));
      return;
    }

    this.apply(presenceFor(snapshot, this.options));
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
