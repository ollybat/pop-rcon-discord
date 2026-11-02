import { RustRconClient } from './rcon.js';
import { normalizeServerInfo } from './presence.js';
import { configuredServers } from './store.js';

export function playerId(entry) {
  const id = entry?.SteamID ?? entry?.SteamId ?? entry?.OwnerSteamID ?? null;
  if (id !== null && id !== undefined && String(id).length > 0) return String(id);
  const name = playerName(entry);
  return name === 'unknown' ? 'unknown' : 'name:' + name;
}

export function playerName(entry) {
  return String(entry?.DisplayName ?? entry?.Name ?? entry?.displayName ?? 'unknown');
}

/** Normalise the JSON array Rust returns from `playerlist`. */
export function toPlayerList(data) {
  if (!Array.isArray(data)) return [];

  return data
    .map((entry) => ({
      id: playerId(entry),
      name: playerName(entry),
      ping: Number.isFinite(Number(entry?.Ping)) ? Number(entry.Ping) : null,
      seconds: Number.isFinite(Number(entry?.ConnectedSeconds)) ? Number(entry.ConnectedSeconds) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Who appeared and who vanished between two polls. */
export function diffPlayers(previous, current) {
  const joined = [];
  const left = [];
  const now = new Set();

  for (const player of current) {
    now.add(player.id);
    if (!previous.has(player.id)) joined.push({ ...player });
  }

  for (const [id, player] of previous) {
    if (!now.has(id)) left.push({ ...player });
  }

  return { joined, left };
}

export const MAX_EVENTS_PER_TICK = 8;

/**
 * A server restart empties a playerlist in one tick, which would otherwise spam the log.
 * Past the cap we report the change as one summary instead.
 */
export function capEvents(changes, max = MAX_EVENTS_PER_TICK) {
  const total = changes.joined.length + changes.left.length;

  if (total <= max) {
    return { joined: changes.joined, left: changes.left, joinedCount: changes.joined.length, leftCount: changes.left.length, total, massChange: false, overflow: 0 };
  }

  return {
    joined: [],
    left: [],
    joinedCount: changes.joined.length,
    leftCount: changes.left.length,
    total,
    massChange: true,
    overflow: total - max,
  };
}

/** Servers a guild should be talking to: the three slots, plus the .env server as slot 1. */
export function effectiveServers(config, envServer = null) {
  const servers = configuredServers(config ?? {});
  if (servers.some((server) => server.slot === 1)) return servers;
  if (!envServer) return servers;

  return [
    { slot: 1, name: envServer.name ?? 'Server 1 (.env)', host: envServer.host, port: envServer.port, password: envServer.password, fromEnv: true },
    ...servers,
  ];
}

export function serverSignature(servers) {
  return (servers ?? [])
    .map((server) => [server.slot, server.host, server.port, server.password, server.name].join(':'))
    .join('|');
}

export function describeServer(server) {
  return server.name + ' (' + server.host + ':' + server.port + ')';
}

/** Polls one Rust server: keeps a snapshot for /pop, and reports joins and leaves. */
export class ServerMonitor {
  constructor({ guildId, server, logger = console, pollIntervalMs = 20000, onSnapshot, onChanges, onStatus, onError, onChat }) {
    this.guildId = guildId;
    this.server = server;
    this.slot = server.slot;
    this.logger = logger;
    this.pollIntervalMs = pollIntervalMs;
    this.onSnapshot = onSnapshot;
    this.onChanges = onChanges;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onChat = onChat;

    this.players = new Map();
    this.firstSeen = new Map();
    this.seeded = false;
    this.timer = null;
    this.polling = null;

    this.rcon = new RustRconClient({
      host: server.host,
      port: server.port,
      password: server.password,
      timeoutMs: 10000,
      logger,
    });

    this.snapshot = {
      slot: this.slot,
      name: server.name,
      host: server.host,
      port: server.port,
      connected: false,
      info: null,
      players: [],
      latencyMs: null,
      at: null,
      error: null,
    };

    this.rcon.on('connected', () => {
      this.onStatus?.({ type: 'connected', server: this.server });
      this.refresh().catch(() => {});
    });

    this.rcon.on('disconnected', (details) => {
      this.onStatus?.({ type: 'disconnected', server: this.server, code: details?.code, reason: details?.reason });
    });

    this.rcon.on('chat', (payload) => {
      this.onChat?.({ server: this.server, message: payload.message, raw: payload.raw });
    });

    this.rcon.on('error', (error) => this.report(error, 'socket'));
  }

  async start() {
    await this.rcon.connect().catch((error) => this.report(error, 'connect'));
    // Seed the roster before the interval starts, so the first manual refresh cannot race it.
    await this.refresh().catch(() => {});

    this.timer = setInterval(() => {
      this.refresh().catch(() => {});
    }, this.pollIntervalMs);
    this.timer.unref?.();
  }

  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.rcon.close().catch(() => {});
  }

  get connected() {
    return this.rcon.connected;
  }

  report(error, source) {
    const message = error && error.message ? error.message : String(error);
    this.logger.warn('[server ' + this.slot + '] ' + source + ' failed: ' + message);
    this.onError?.({ server: this.server, source, message });
  }

  /** One poll: serverinfo + playerlist, then diff the roster. */
  /**
   * Poll the server once. Two callers (the interval and a /pop refresh) never overlap: the second
   * one waits for the poll already in flight, which is what stopped a double poll from reporting
   * the whole roster as fresh joins.
   */
  async refresh() {
    if (this.polling) return this.polling;

    this.polling = this.poll().finally(() => {
      this.polling = null;
    });
    return this.polling;
  }

  async poll() {
    if (!this.rcon.connected) {
      this.snapshot = { ...this.snapshot, connected: false, at: new Date().toISOString() };
      this.onSnapshot?.(this.snapshot);
      return this.snapshot;
    }

    const started = Date.now();

    try {
      const [infoReply, listReply] = await Promise.all([
        this.rcon.sendJson('serverinfo'),
        this.rcon.sendJson('playerlist'),
      ]);

      const info = normalizeServerInfo(infoReply.data);
      const players = toPlayerList(listReply.data);
      const previous = this.players;
      const next = new Map(players.map((player) => [player.id, player]));

      if (this.seeded) {
        // diffPlayers wants the new roster as an array: handing it the Map made it report a
        // phantom join and leave for every player on every single poll.
        const changes = capEvents(diffPlayers(previous, players));
        for (const player of changes.joined) this.firstSeen.set(player.id, Date.now());
        for (const player of changes.left) {
          const since = this.firstSeen.get(player.id);
          player.sessionSeconds = since ? Math.round((Date.now() - since) / 1000) : player.seconds;
          this.firstSeen.delete(player.id);
        }
        for (const id of next.keys()) if (!this.firstSeen.has(id)) this.firstSeen.set(id, Date.now());

        if (changes.total > 0) {
          this.onChanges?.({
            ...changes,
            server: this.server,
            online: players.length,
            max: info ? info.max : null,
          });
        }
      } else {
        // First successful poll: learn the roster without reporting everyone as a join.
        this.seeded = true;
        for (const id of next.keys()) if (!this.firstSeen.has(id)) this.firstSeen.set(id, Date.now());
      }

      this.players = next;
      this.snapshot = {
        slot: this.slot,
        name: this.server.name,
        host: this.server.host,
        port: this.server.port,
        connected: true,
        info,
        players,
        latencyMs: Date.now() - started,
        at: new Date().toISOString(),
        error: null,
      };
    } catch (error) {
      this.snapshot = { ...this.snapshot, connected: this.rcon.connected, error: error.message, at: new Date().toISOString() };
      this.report(error, 'poll');
    }

    this.onSnapshot?.(this.snapshot);
    return this.snapshot;
  }
}

/** Owns one monitor per configured server, per guild. */
export class ServerManager {
  constructor({ store, logger = console, pollIntervalSeconds = 20, envServer = null, onChanges = null, onStatus = null, onError = null, onChat = null, onSnapshot = null }) {
    this.store = store;
    this.logger = logger;
    this.pollIntervalMs = Math.max(5, pollIntervalSeconds) * 1000;
    this.envServer = envServer;
    this.onChanges = onChanges;
    this.onStatus = onStatus;
    this.onError = onError;
    this.onChat = onChat;
    this.onSnapshot = onSnapshot;
    this.monitors = new Map();
    this.signatures = new Map();
  }

  serversFor(guildId) {
    return effectiveServers(this.store.get(guildId), this.envServer);
  }

  list(guildId) {
    return [...(this.monitors.get(String(guildId))?.values() ?? [])];
  }

  /** Create, keep or drop monitors so they match what /setup has saved. */
  async syncGuild(guildId) {
    const id = String(guildId);
    const servers = this.serversFor(id);
    const signature = serverSignature(servers);

    if (this.signatures.get(id) === signature) return this.list(id);
    this.signatures.set(id, signature);

    const existing = this.monitors.get(id) ?? new Map();
    const wanted = new Map();

    for (const server of servers) {
      const current = existing.get(server.slot);
      if (current && current.server.host === server.host && current.server.port === server.port && current.server.password === server.password) {
        current.server = server;
        wanted.set(server.slot, current);
        continue;
      }

      if (current) await current.stop();
      const monitor = new ServerMonitor({
        guildId: id,
        server,
        logger: this.logger,
        pollIntervalMs: this.pollIntervalMs,
        onChanges: (changes) => this.onChanges?.(id, changes),
        onStatus: (status) => this.onStatus?.(id, status),
        onError: (error) => this.onError?.(id, error),
        onChat: (event) => this.onChat?.(id, event),
        onSnapshot: (snapshot) => this.onSnapshot?.(id, snapshot),
      });
      wanted.set(server.slot, monitor);
      monitor.start().catch(() => {});
    }

    for (const [slot, monitor] of existing) {
      if (!wanted.has(slot)) await monitor.stop();
    }

    this.monitors.set(id, wanted);
    return this.list(id);
  }

  async stopGuild(guildId) {
    const id = String(guildId);
    for (const monitor of this.monitors.get(id)?.values() ?? []) await monitor.stop();
    this.monitors.delete(id);
    this.signatures.delete(id);
  }

  async stopAll() {
    for (const id of [...this.monitors.keys()]) await this.stopGuild(id);
  }

  monitorFor(guildId, slot) {
    return this.monitors.get(String(guildId))?.get(Number(slot)) ?? null;
  }

  /** Refresh every server of a guild (used by /pop) and return the snapshots. */
  async refreshGuild(guildId, slot = null) {
    await this.syncGuild(guildId);
    const monitors = slot ? [this.monitorFor(guildId, slot)].filter(Boolean) : this.list(guildId);
    return Promise.all(monitors.map((monitor) => monitor.refresh().catch(() => monitor.snapshot)));
  }

  snapshot(guildId, slot) {
    return this.monitorFor(guildId, slot)?.snapshot ?? null;
  }

  snapshots(guildId, slot = null) {
    const monitors = slot ? [this.monitorFor(guildId, slot)].filter(Boolean) : this.list(guildId);
    return monitors.map((monitor) => monitor.snapshot);
  }

  async query(guildId, slot, command, options) {
    const monitor = this.monitorFor(guildId, slot);
    if (!monitor) throw new Error('No server is configured in slot ' + slot + '. Run /setup first.');
    if (!monitor.connected) throw new Error(monitor.server.name + ' is not connected right now.');
    return monitor.rcon.send(command, options);
  }
}
