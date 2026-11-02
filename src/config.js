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

function list(name) {
  return (process.env[name] ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  discord: {
    token: required('DISCORD_TOKEN'),
    appId: process.env.DISCORD_APP_ID?.trim() || null,
    guildId: process.env.DISCORD_GUILD_ID?.trim() || null,
    commandRoleIds: list('COMMAND_ROLE_IDS'),
    consoleChannelId: process.env.CONSOLE_CHANNEL_ID?.trim() || null,
  },
  rcon: {
    host: required('RCON_HOST'),
    port: optionalNumber('RCON_PORT', 28016),
    password: required('RCON_PASSWORD'),
    timeoutMs: optionalNumber('RCON_TIMEOUT_MS', 15000),
    maxReconnectDelayMs: optionalNumber('RCON_MAX_RECONNECT_DELAY_MS', 30000),
  },
};
