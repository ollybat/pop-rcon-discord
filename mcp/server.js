#!/usr/bin/env node
/**
 * Spinback MCP server.
 *
 * Speaks the Model Context Protocol over stdio so any MCP client - Claude Desktop, Claude Code,
 * Codex, Cursor - can ask about the Rust servers this bot watches, without Discord in the middle.
 *
 *   node mcp/server.js                 # stdio, for a client config
 *   node mcp/server.js --allow-rcon    # also expose a raw RCON command tool
 *
 * Server credentials come from the same place the bot keeps them:
 *   - "$DATA_DIR/guilds/<guildId>.json" written by /setup
 *   - the RCON_* environment variables
 *
 * Only stdout carries protocol traffic; every log line goes to stderr.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { RustRconClient } from '../src/rcon.js';

export const SERVER_NAME = 'spinback';
export const SERVER_VERSION = '0.8.0';
export const PROTOCOL_VERSION = '2024-11-05';

const DEFAULT_PORT = 28016;

/** Log lines for MCP clients: stderr only, never stdout. */
export function stderrLogger(stream = process.stderr) {
  const write = (level, args) => {
    try {
      stream.write('[spinback-mcp] ' + level + ' ' + args.map((value) => (value?.stack ?? String(value))).join(' ') + '\n');
    } catch {
      // A closed stderr must never take the process down.
    }
  };
  return {
    info: (...args) => write('info', args),
    warn: (...args) => write('warn', args),
    error: (...args) => write('error', args),
    debug: () => {},
  };
}


/** Rust's serverinfo reply, flattened and safe to read. */
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
    map: data.Map ? String(data.Map) : null,
    entities: toNumber(data.EntityCount),
    framerate: toNumber(data.Framerate),
  };
}

/** Rust's playerlist reply, sorted by name. */
export function toPlayerList(data) {
  if (!Array.isArray(data)) return [];
  return data
    .map((entry) => ({
      id: String(entry?.SteamID ?? entry?.SteamId ?? entry?.OwnerSteamID ?? ''),
      name: String(entry?.DisplayName ?? entry?.Name ?? 'unknown'),
      ping: Number.isFinite(Number(entry?.Ping)) ? Number(entry.Ping) : null,
      seconds: Number.isFinite(Number(entry?.ConnectedSeconds)) ? Number(entry.ConnectedSeconds) : null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** "1h 12m", for uptime and session length. */
export function human(seconds) {
  // null / undefined / '' mean "the server did not say", which is not the same as zero.
  if (seconds === null || seconds === undefined || seconds === '') return 'unknown';
  if (!Number.isFinite(Number(seconds))) return 'unknown';
  let left = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(left / 86400);
  left -= days * 86400;
  const hours = Math.floor(left / 3600);
  left -= hours * 3600;
  const minutes = Math.floor(left / 60);
  const parts = [];
  if (days) parts.push(days + 'd');
  if (hours) parts.push(hours + 'h');
  parts.push(minutes + 'm');
  return parts.join(' ');
}

/** A small ASCII bar, the same idea as the one in Discord. */
export function bar(value, max, width = 16) {
  const total = Number(max) > 0 ? Number(max) : 0;
  const filled = total ? Math.max(0, Math.min(width, Math.round((Number(value) / total) * width))) : 0;
  return '#'.repeat(filled) + '.'.repeat(Math.max(0, width - filled));
}

/**
 * Every server this bot knows about, from the data directory and the environment.
 * Passwords never leave these objects except to open a socket.
 */
export function loadServers({ dataDir = process.env.DATA_DIR || './data', env = process.env } = {}) {
  const servers = [];
  const guildsDir = join(dataDir, 'guilds');

  if (existsSync(guildsDir)) {
    for (const file of readdirSync(guildsDir).filter((name) => name.endsWith('.json')).sort()) {
      const guildId = file.slice(0, -5);
      let config;
      try {
        config = JSON.parse(readFileSync(join(guildsDir, file), 'utf8'));
      } catch {
        continue;
      }

      (config.servers ?? []).forEach((raw, index) => {
        if (!raw || !raw.host || !raw.password) return;
        servers.push({
          key: guildId + ':' + (index + 1),
          guildId,
          slot: index + 1,
          name: String(raw.name || raw.host),
          host: String(raw.host),
          port: Number(raw.port) || DEFAULT_PORT,
          password: String(raw.password),
          source: 'guild:' + guildId,
          stats: config.stats?.[String(index + 1)] ?? null,
        });
      });
    }
  }

  if (env.RCON_HOST && env.RCON_PASSWORD) {
    servers.push({
      key: 'env:1',
      guildId: null,
      slot: 1,
      name: env.RCON_NAME || 'Server 1 (.env)',
      host: String(env.RCON_HOST),
      port: Number(env.RCON_PORT) || DEFAULT_PORT,
      password: String(env.RCON_PASSWORD),
      source: 'env',
      stats: null,
    });
  }

  return servers;
}

export function serverLabel(server) {
  const where = server.guildId ? ', slot ' + server.slot + ' of guild ' + server.guildId : ' (.env)';
  return server.name + ' - ' + server.host + ':' + server.port + where;
}

/** Find the server a tool call means: a key, a slot, or part of a name or host. */
export function pickServer(servers, wanted = null) {
  if (servers.length === 0) {
    return {
      error:
        'No Rust servers are configured yet. Add one with /setup in Discord, or set RCON_HOST, RCON_PORT and RCON_PASSWORD so this program can reach one.',
    };
  }

  if (wanted === null || wanted === undefined || String(wanted).trim() === '') {
    const note = servers.length > 1 ? ' (defaulted to the first of ' + servers.length + ' configured servers)' : '';
    return { server: servers[0], note };
  }

  const text = String(wanted).trim().toLowerCase();
  const byKey = servers.find((server) => server.key.toLowerCase() === text);
  if (byKey) return { server: byKey };

  const bySlot = servers.filter((server) => String(server.slot) === text);
  if (bySlot.length === 1) return { server: bySlot[0] };
  if (bySlot.length > 1) {
    return { error: 'Slot ' + text + ' exists on more than one server - name one explicitly: ' + servers.map((server) => server.key).join(', ') };
  }

  const byName = servers.filter((server) => server.name.toLowerCase().includes(text) || server.host.toLowerCase().includes(text));
  if (byName.length >= 1) return { server: byName[0] };

  return { error: 'No server matches "' + wanted + '". Known servers: ' + servers.map((server) => server.key + ' (' + server.name + ')').join(', ') };
}

/** One RCON socket per server, opened on first use and reused by later tool calls. */
export class RconPool {
  constructor({ timeoutMs = Number(process.env.MCP_RCON_TIMEOUT_MS) || 10000, logger = stderrLogger() } = {}) {
    this.timeoutMs = timeoutMs;
    this.logger = logger;
    this.clients = new Map();
  }

  async clientFor(server) {
    const key = server.key + '@' + server.host + ':' + server.port;
    const existing = this.clients.get(key);
    if (existing?.connected) return existing;

    const client = new RustRconClient({
      host: server.host,
      port: server.port,
      password: server.password,
      timeoutMs: this.timeoutMs,
      autoReconnect: false,
      logger: this.logger,
    });

    await client.connect();
    this.clients.set(key, client);
    return client;
  }

  async command(server, command, { json = false } = {}) {
    const client = await this.clientFor(server);
    const reply = json ? await client.sendJson(command, { timeoutMs: this.timeoutMs }) : await client.send(command, { timeoutMs: this.timeoutMs });
    if (json && reply?.data === null) reply.data = tryParse(reply.message);
    return reply;
  }

  /** Read serverinfo and playerlist together. */
  async snapshot(server) {
    const [info, players] = await Promise.all([
      this.command(server, 'serverinfo', { json: true }),
      this.command(server, 'playerlist', { json: true }),
    ]);

    return {
      info: normalizeServerInfo(info?.data),
      players: toPlayerList(players?.data),
      at: new Date().toISOString(),
    };
  }

  async close() {
    const clients = [...this.clients.values()];
    this.clients.clear();
    await Promise.allSettled(clients.map((client) => client.close()));
  }
}

const SERVER_ARG = {
  type: 'string',
  description: 'Which server: its key ("<guildId>:<slot>"), a slot number, or part of its name or host. Defaults to the first configured server.',
};

export const TOOL_DEFINITIONS = [
  {
    name: 'list_servers',
    description: 'List every Rust server this MCP server can reach, with the Discord guild and slot each one came from.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'server_status',
    description: 'Live population, queue, uptime and restart state for one Rust server, or for all of them at once.',
    inputSchema: {
      type: 'object',
      properties: { server: SERVER_ARG, all: { type: 'boolean', description: 'Check every configured server instead of one.' } },
      additionalProperties: false,
    },
  },
  {
    name: 'players',
    description: 'Who is on a Rust server right now, with ping and how long they have been connected.',
    inputSchema: { type: 'object', properties: { server: SERVER_ARG }, additionalProperties: false },
  },
  {
    name: 'pop_report',
    description: 'A ready to paste population report: totals, queue, uptime, peak of the day and the player list.',
    inputSchema: { type: 'object', properties: { server: SERVER_ARG }, additionalProperties: false },
  },
  {
    name: 'records',
    description: 'The busiest days this server has seen: best ever, today, and the top recorded days.',
    inputSchema: { type: 'object', properties: { server: SERVER_ARG, all: { type: 'boolean', description: 'Every configured server.' } }, additionalProperties: false },
  },
  {
    name: 'server_save',
    description: 'Ask the Rust server to save the world (RCON server.save). Safe and quick.',
    inputSchema: { type: 'object', properties: { server: SERVER_ARG }, additionalProperties: false },
  },
  {
    name: 'broadcast',
    description: 'Post a message to in-game chat on a Rust server (RCON say).',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'The message players will see. Keep it short.' }, server: SERVER_ARG },
      required: ['message'],
      additionalProperties: false,
    },
  },
  {
    name: 'rcon',
    description: 'Run one raw RCON command. Only available when started with --allow-rcon or MCP_ALLOW_ANY_RCON=1.',
    inputSchema: {
      type: 'object',
      properties: { command: { type: 'string', description: 'The exact RCON command line.' }, server: SERVER_ARG },
      required: ['command'],
      additionalProperties: false,
    },
  },
];

function describeInfo(server, info, extra = '') {
  const lines = ['### ' + server.name + ' (' + server.host + ':' + server.port + ')'];
  if (!info) {
    lines.push('WARNING: no answer from the server - it may be offline, or the RCON password may have changed.' + extra);
    return lines.join('\n');
  }

  lines.push('ONLINE - **' + info.players + '/' + info.max + '** players' + (info.restarting ? ' (restarting)' : ''));
  lines.push(bar(info.players, info.max));
  lines.push('queue ' + info.queued + ' - joining ' + info.joining);
  lines.push('uptime ' + human(info.uptime) + (info.map ? ' - map ' + info.map : '') + (info.entities ? ' - ' + info.entities + ' entities' : ''));
  if (extra) lines.push(extra);
  return lines.join('\n');
}

function peakLines(stats) {
  if (!stats) return '';
  const today = stats.day === new Date().toISOString().slice(0, 10) ? stats.peak : null;
  const best = stats.best?.peak;
  const parts = [];
  if (today !== null) parts.push('today ' + today);
  if (Number.isFinite(best)) parts.push('best ' + best);
  return parts.length ? parts.join(' - ') : '';
}

/** Build the tool handlers on top of one pool and one server list. */
export function createSession({ servers = loadServers(), pool = new RconPool(), options = {} } = {}) {
  const logger = options.logger ?? stderrLogger();

  const resolve = (args) => pickServer(servers, args?.server ?? null);

  const targets = (args) => {
    if (args?.all) return { servers };
    const picked = resolve(args);
    if (picked.error) return { error: picked.error };
    return { servers: [picked.server], note: picked.note ?? '' };
  };

  const handlers = {
    async list_servers() {
      if (servers.length === 0) return pickServer([], null).error;
      const lines = ['**' + servers.length + '** Rust server(s) available:', ''];
      for (const server of servers) {
        lines.push('- ' + server.key + ' - ' + serverLabel(server) + (server.stats ? ' - ' + peakLines(server.stats) : ''));
      }
      lines.push('', 'Credentials come from the data directory written by /setup, or the RCON_* environment variables.');
      return lines.join('\n');
    },

    async server_status(args) {
      const list = targets(args);
      if (list.error) return list.error;

      const blocks = [];
      for (const server of list.servers) {
        try {
          const { info } = await pool.snapshot(server);
          blocks.push(describeInfo(server, info, server.stats ? peakLines(server.stats) : ''));
        } catch (error) {
          blocks.push('### ' + server.name + '\nCould not reach it: ' + (error?.message ?? error));
        }
      }
      return blocks.join('\n\n');
    },

    async players(args) {
      const picked = resolve(args);
      if (picked.error) return picked.error;

      const { players: list } = await pool.snapshot(picked.server);
      if (list.length === 0) return 'Nobody is on **' + picked.server.name + '** right now.';

      const lines = ['**' + list.length + '** player(s) on ' + picked.server.name + ':', ''];
      for (const player of list) {
        lines.push('- ' + player.name + (player.ping === null ? '' : ' - ' + player.ping + 'ms') + (player.seconds === null ? '' : ' - ' + human(player.seconds)));
      }
      return lines.join('\n');
    },

    async pop_report(args) {
      const picked = resolve(args);
      if (picked.error) return picked.error;

      const { info, players: list } = await pool.snapshot(picked.server);
      const lines = [describeInfo(picked.server, info)];
      if (list.length) {
        lines.push('', '**Players (' + list.length + ')**');
        lines.push(list.map((player) => player.name).join(', '));
      }
      return lines.join('\n');
    },

    async records(args) {
      const list = args?.all ? servers : null;
      const picked = list ? null : resolve(args);
      if (picked?.error) return picked.error;
      const chosen = list ?? [picked.server];

      const blocks = [];
      for (const server of chosen) {
        const stats = server.stats;
        const lines = ['### ' + server.name + ' (' + server.host + ':' + server.port + ')'];
        if (!stats) {
          lines.push('No peaks recorded yet for this server.');
          blocks.push(lines.join('\n'));
          continue;
        }

        const days = Object.entries(stats.days ?? {}).map(([day, peak]) => ({ day, peak }));
        const best = stats.best ?? (days.length ? days.reduce((top, day) => (day.peak > top.peak ? day : top)) : null);
        lines.push(best ? 'Best day: **' + best.peak + '**' + (best.day ? ' on ' + best.day : '') : 'Best day: nothing recorded yet');
        lines.push(stats.day ? 'Today (' + stats.day + '): **' + stats.peak + '**' : 'Today: nobody has been on yet');
        if (days.length) {
          const top = [...days].sort((a, b) => b.peak - a.peak).slice(0, 5);
          lines.push('Busiest: ' + top.map((day) => day.day + ' -> ' + day.peak).join(' - '));
          lines.push('(' + days.length + ' day(s) recorded)');
        }
        blocks.push(lines.join('\n'));
      }
      return blocks.join('\n\n');
    },

    async server_save(args) {
      const picked = resolve(args);
      if (picked.error) return picked.error;
      const reply = await pool.command(picked.server, 'server.save');
      return 'Saved: ' + picked.server.name + ' was asked to write the world to disk.' + (reply?.message ? '\n\nServer said: ' + reply.message : '');
    },

    async broadcast(args) {
      const picked = resolve(args);
      if (picked.error) return picked.error;
      const message = String(args?.message ?? '').slice(0, 400);
      if (!message) return 'A message is required.';
      const reply = await pool.command(picked.server, 'say "' + message.replace(/"/g, "'") + '"');
      return 'Sent to ' + picked.server.name + ': ' + message + (reply?.message ? '\n\nServer said: ' + reply.message : '');
    },

    async rcon(args) {
      if (!options.allowAnyRcon) {
        return 'The raw RCON tool is off. Restart this MCP server with --allow-rcon (or MCP_ALLOW_ANY_RCON=1) if you really want arbitrary console commands, or use the narrower tools: server_status, players, server_save, broadcast.';
      }

      const picked = resolve(args);
      if (picked.error) return picked.error;
      const command = String(args?.command ?? '').trim();
      if (!command) return 'A command is required.';

      logger.warn('raw rcon: ' + command + ' on ' + picked.server.key);
      const reply = await pool.command(picked.server, command);
      return (reply?.message ? reply.message : '(no output)') + (reply?.stacktrace ? '\n\nStacktrace: ' + reply.stacktrace : '');
    },
  };

  const tools = TOOL_DEFINITIONS.map((definition) => ({ ...definition, handler: handlers[definition.name] }));

  return {
    servers,
    tools,
    listTools: () => tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
    async callTool(name, args = {}) {
      const tool = tools.find((entry) => entry.name === name);
      if (!tool) {
        return { content: [{ type: 'text', text: 'Unknown tool: ' + name }], isError: true };
      }

      try {
        const text = await tool.handler(args ?? {});
        return { content: [{ type: 'text', text: String(text) }] };
      } catch (error) {
        logger.warn(name + ' failed: ' + (error?.message ?? error));
        return { content: [{ type: 'text', text: 'Failed: ' + (error?.message ?? error) }], isError: true };
      }
    },
    close: () => pool.close(),
  };
}

function reply(id, result, error = null) {
  const message = { jsonrpc: '2.0', id: id ?? null };
  if (error) message.error = error;
  else message.result = result;
  return message;
}

/** One JSON-RPC message in, one response out (null for notifications). */
export async function handleMessage(session, message) {
  const { id, method, params } = message ?? {};
  if (typeof method !== 'string') {
    return reply(id, null, { code: -32600, message: 'Invalid Request: method is required' });
  }

  if (method.startsWith('notifications/')) return null;

  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions:
          'Spinback watches Rust dedicated servers over WebRCON. Use list_servers to see them, server_status or players for live numbers, pop_report for a summary to paste, records for the clan record book, and broadcast to talk to players in game.',
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: session.listTools() });
    case 'tools/call':
      return reply(id, await session.callTool(params?.name, params?.arguments ?? {}));
    default:
      return reply(id, null, { code: -32601, message: 'Method not found: ' + method });
  }
}

/** The stdio loop. Everything here talks to the client over stdin and stdout. */
export async function main({ argv = process.argv, env = process.env, stdin = process.stdin, stdout = process.stdout, stderr = process.stderr } = {}) {
  const logger = stderrLogger(stderr);
  const options = { allowAnyRcon: argv.includes('--allow-rcon') || env.MCP_ALLOW_ANY_RCON === '1', logger };
  const servers = loadServers({ env });
  const session = createSession({ servers, pool: new RconPool({ logger }), options });

  logger.info(SERVER_VERSION + ' started, watching ' + servers.length + ' server(s)' + (options.allowAnyRcon ? ' (raw rcon enabled)' : ''));

  const send = (message) => {
    if (!message) return;
    stdout.write(JSON.stringify(message) + '\n');
  };

  const handleLine = async (line) => {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      send(reply(null, null, { code: -32700, message: 'Parse error' }));
      return;
    }

    if (Array.isArray(parsed)) {
      for (const entry of parsed) send(await handleMessage(session, entry));
      return;
    }

    send(await handleMessage(session, parsed));
  };

  let buffer = '';
  let queue = Promise.resolve();

  const done = new Promise((resolve) => {
    stdin.setEncoding('utf8');
    stdin.on('data', (chunk) => {
      buffer += chunk;
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line) queue = queue.then(() => handleLine(line)).catch((error) => logger.error('handler failed: ' + error.message));
        index = buffer.indexOf('\n');
      }
    });

    const finish = () => {
      queue.then(() => session.close()).then(resolve, resolve);
    };

    stdin.on('end', finish);
    stdin.on('close', finish);
  });

  await done;
  logger.info('stdin closed, shutting down');
  return { servers: servers.length };
}

const isMain = (() => {
  try {
    return Boolean(process.argv[1]) && import.meta.url === new URL('file://' + process.argv[1]).href;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().then(
    () => process.exit(0),
    (error) => {
      process.stderr.write('[spinback-mcp] fatal ' + (error?.stack ?? error) + '\n');
      process.exit(1);
    },
  );
}
