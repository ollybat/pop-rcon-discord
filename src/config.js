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

function optionalString(name, fallback) {
  return process.env[name]?.trim() || fallback;
}

const DEFAULT_PRESENCE = {
  online: '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}',
  offline: '🔴 RCON┆OFFLINE',
  resting: '🟡 RCON┆RESTING',
};

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    consoleChannelId: process.env.CONSOLE_CHANNEL_ID?.trim() || null,
  },
  rcon: {
    host: required('RCON_HOST'),
    port: optionalNumber('RCON_PORT', 28016),
    password: required('RCON_PASSWORD'),
    timeoutMs: optionalNumber('RCON_TIMEOUT_MS', 15000),
    maxReconnectDelayMs: optionalNumber('RCON_MAX_RECONNECT_DELAY_MS', 30000),
  },
  presence: {
    enabled: optionalBoolean('PRESENCE_ENABLED', true),
    intervalSeconds: Math.max(5, optionalNumber('PRESENCE_INTERVAL_SECONDS', 15)),
    restingOnReconnect: optionalBoolean('PRESENCE_RESTING_ON_RECONNECT', false),
    formats: {
      online: optionalString('PRESENCE_ONLINE_FORMAT', DEFAULT_PRESENCE.online),
      offline: optionalString('PRESENCE_OFFLINE_FORMAT', DEFAULT_PRESENCE.offline),
      resting: optionalString('PRESENCE_RESTING_FORMAT', DEFAULT_PRESENCE.resting),
    },
  },
};
