import { ActivityType } from 'discord.js';

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
  };
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

/** Keeps the bot's "Watching ..." activity in sync with the Rust server. */
export class PresenceManager {
  constructor({ client, rcon, options, logger = console }) {
    this.client = client;
    this.rcon = rcon;
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

    // React to a connection change immediately instead of waiting for the next poll.
    this.rcon.on('connected', refresh);
    this.rcon.on('disconnected', refresh);

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
    const connected = this.rcon.connected;
    const reconnecting = Boolean(this.rcon.reconnectTimer) || this.rcon.reconnectAttempts > 0;
    let info = null;

    if (connected) {
      try {
        const { data } = await this.rcon.sendJson('serverinfo');
        info = normalizeServerInfo(data);
      } catch (error) {
        this.logger.warn('[presence] could not read serverinfo: ' + error.message);
      }
    }

    this.info = info;
    this.apply(presenceFor({ connected, reconnecting, info }, this.options));
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
