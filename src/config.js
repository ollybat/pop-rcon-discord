import 'dotenv/config';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error('Missing required environment variable ' + name + '. Copy .env.example to .env and fill it in.');
  }
  return value;
}

function optionalNumber(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new Error('Environment variable ' + name + ' must be a number, got "' + raw + '"');
  }
  return value;
}

function optionalBoolean(name, fallback) {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  throw new Error('Environment variable ' + name + ' must be true or false, got "' + raw + '"');
}

function optionalString(name, fallback = null) {
  return process.env[name]?.trim() || fallback;
}

function list(name) {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

const DEFAULT_PRESENCE = {
  online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
  offline: '🔴 RCON┆OFFLINE',
  resting: '🟡 RCON┆RESTING',
};

/** The .env RCON block is an optional shortcut for slot 1 until /setup saves a server. */
function envServer() {
  const host = optionalString('RCON_HOST');
  const password = optionalString('RCON_PASSWORD');
  // Validate the port whenever it is set, so a typo is reported even before host/password exist.
  const port = optionalNumber('RCON_PORT', 28016);
  if (!host || !password) return null;
  return {
    name: optionalString('RCON_NAME', 'Server 1 (.env)'),
    host,
    port,
    password,
  };
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    // Optional: register the slash commands in this one guild so they appear instantly.
    guildId: optionalString('DISCORD_GUILD_ID'),
    prefix: optionalString('PREFIX', '!'),
    prefixCommandsEnabled: optionalBoolean('PREFIX_COMMANDS_ENABLED', true),
    botOwnerIds: list('BOT_OWNER_IDS'),
  },
  data: {
    dir: optionalString('DATA_DIR', './data'),
  },
  poll: {
    // One shared interval drives the status line, /pop and the join/leave diffing.
    intervalSeconds: Math.max(5, optionalNumber('POLL_INTERVAL_SECONDS', optionalNumber('PRESENCE_INTERVAL_SECONDS', 20))),
  },
  rcon: {
    timeoutMs: optionalNumber('RCON_TIMEOUT_MS', 15000),
    maxReconnectDelayMs: optionalNumber('RCON_MAX_RECONNECT_DELAY_MS', 30000),
    fromEnv: envServer(),
  },
  presence: {
    enabled: optionalBoolean('PRESENCE_ENABLED', true),
    guildId: optionalString('PRESENCE_GUILD_ID'),
    serverSlot: optionalString('PRESENCE_SERVER_SLOT', '1'),
    restingOnReconnect: optionalBoolean('PRESENCE_RESTING_ON_RECONNECT', false),
    formats: {
      online: optionalString('PRESENCE_ONLINE_FORMAT', DEFAULT_PRESENCE.online),
      offline: optionalString('PRESENCE_OFFLINE_FORMAT', DEFAULT_PRESENCE.offline),
      resting: optionalString('PRESENCE_RESTING_FORMAT', DEFAULT_PRESENCE.resting),
    },
    // Rotate the activity line while the server is online, so it stays worth a glance.
    rotate: optionalBoolean('PRESENCE_ROTATE', true),
  },
  errors: {
    // How long the same fault stays one message before a new one is posted.
    repeatWindowMinutes: Math.max(1, optionalNumber('ERROR_REPEAT_WINDOW_MINUTES', 15)),
    // How long the quiet has to last before the message says "quiet again".
    quietSeconds: Math.max(5, optionalNumber('ERROR_QUIET_SECONDS', 60)),
  },
  board: {
    // How often a live population board updates itself, in seconds.
    intervalSeconds: Math.max(15, optionalNumber('BOARD_INTERVAL_SECONDS', 30)),
    // How long a message someone made live from /pop keeps refreshing, in minutes.
    liveMinutes: Math.max(1, optionalNumber('BOARD_LIVE_MINUTES', 20)),
    // Refresh anyway after this long, so "updated 4 minutes ago" never goes stale.
    forceSeconds: Math.max(60, optionalNumber('BOARD_FORCE_SECONDS', 300)),
  },
  alerts: {
    // A server has to be unreachable this long before anyone is told. Short blips stay quiet.
    downAfterMinutes: Math.max(1, optionalNumber('ALERT_DOWN_AFTER_MINUTES', 5)),
    // Also send the guild owner a direct message when a server goes down and comes back.
    dmOwner: optionalBoolean('ALERT_DM_OWNER', true),
  },
  digest: {
    // The UTC hour the daily digest goes out, unless a guild picked its own in /setup.
    hour: Math.min(23, Math.max(0, optionalNumber('DIGEST_HOUR', 20))),
    // How many days the week-over-week comparison covers.
    window: Math.max(3, optionalNumber('DIGEST_WINDOW_DAYS', 7)),
  },
  dm: {
    // Answer direct messages and pass them to the clan owners.
    enabled: optionalBoolean('DM_ENABLED', true),
    // Extra user ids to notify, on top of each Discord server owner and BOT_OWNER_IDS.
    forwardIds: list('DM_FORWARD_IDS'),
    forwardStrangers: optionalBoolean('DM_FORWARD_STRANGERS', false),
    replyCooldownSeconds: Math.max(30, optionalNumber('DM_REPLY_COOLDOWN_SECONDS', 300)),
  },
  web: {
    // The free hosts give the app a port (SERVER_PORT) and proxy it publicly; a health
    // endpoint there means the URL answers instead of showing "app unreachable".
    enabled: optionalBoolean('WEB_ENABLED', true),
    port: optionalNumber('WEB_PORT', optionalNumber('SERVER_PORT', 0)),
    host: optionalString('WEB_HOST', '0.0.0.0'),
    // The address you would paste into a browser, for /ping to call back. Optional.
    publicUrl: optionalString('PUBLIC_URL'),
    timeoutMs: optionalNumber('WEB_PROBE_TIMEOUT_MS', 4000),
  },
  log: {
    level: optionalString('LOG_LEVEL', 'info').toLowerCase(),
    timestamps: optionalBoolean('LOG_TIMESTAMPS', true),
    // Optional: mirror in-game Rust chat into this channel.
    chatChannelId: optionalString('RCON_CHAT_CHANNEL_ID'),
  },
};

export function presenceSlot(value = config.presence.serverSlot) {
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'all' || text === 'aggregate') return 'all';
  const slot = Number(text);
  return Number.isInteger(slot) && slot >= 1 && slot <= 3 ? slot : 1;
}
