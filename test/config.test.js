import assert from 'node:assert/strict';
import { test } from 'node:test';

const REQUIRED = {
  DISCORD_TOKEN: 'token',
  RCON_HOST: '127.0.0.1',
  RCON_PASSWORD: 'secret',
};

const MANAGED = [
  'DISCORD_TOKEN',
  'RCON_HOST',
  'RCON_PASSWORD',
  'CONSOLE_CHANNEL_ID',
  'RCON_PORT',
  'RCON_TIMEOUT_MS',
  'RCON_MAX_RECONNECT_DELAY_MS',
  'PRESENCE_ENABLED',
  'PRESENCE_INTERVAL_SECONDS',
  'PRESENCE_RESTING_ON_RECONNECT',
  'PRESENCE_ONLINE_FORMAT',
  'PRESENCE_OFFLINE_FORMAT',
  'PRESENCE_RESTING_FORMAT',
  'LOG_LEVEL',
  'LOG_TIMESTAMPS',
];

/** Import a pristine copy of src/config.js with a controlled environment. */
async function loadConfig(env, caseId) {
  const previous = new Map(MANAGED.map((key) => [key, process.env[key]]));

  for (const key of MANAGED) delete process.env[key];
  Object.assign(process.env, REQUIRED, env);

  try {
    const module = await import('../src/config.js?case=' + caseId);
    return module.config;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('config reads the required values and applies defaults', async () => {
  const config = await loadConfig({}, 'defaults');

  assert.equal(config.discord.token, 'token');
  assert.equal(config.discord.consoleChannelId, null);
  assert.equal(config.rcon.host, '127.0.0.1');
  assert.equal(config.rcon.port, 28016);
  assert.equal(config.rcon.timeoutMs, 15000);
  assert.equal(config.rcon.maxReconnectDelayMs, 30000);
  assert.equal(config.presence.enabled, true);
  assert.equal(config.presence.intervalSeconds, 15);
  assert.equal(config.presence.restingOnReconnect, false);
  assert.equal(config.presence.formats.online, '🟢 RCON┆👥  {players}/{max} ⏳{queued}/{joining}');
  assert.equal(config.presence.formats.offline, '🔴 RCON┆OFFLINE');
  assert.equal(config.presence.formats.resting, '🟡 RCON┆RESTING');
  assert.equal(config.log.level, 'info');
  assert.equal(config.log.timestamps, true);
});

test('config parses numbers, booleans, clamps the interval and takes custom formats', async () => {
  const config = await loadConfig(
    {
      RCON_PORT: '29000',
      PRESENCE_INTERVAL_SECONDS: '1',
      PRESENCE_RESTING_ON_RECONNECT: 'yes',
      PRESENCE_ONLINE_FORMAT: 'online {players}',
      LOG_LEVEL: 'DEBUG',
      LOG_TIMESTAMPS: 'off',
    },
    'parsing',
  );

  assert.equal(config.rcon.port, 29000);
  assert.equal(config.presence.intervalSeconds, 5, 'the 5 second floor protects the server');
  assert.equal(config.presence.restingOnReconnect, true);
  assert.equal(config.presence.formats.online, 'online {players}');
  assert.equal(config.presence.formats.offline, '🔴 RCON┆OFFLINE');
  assert.equal(config.log.level, 'debug');
  assert.equal(config.log.timestamps, false);
});

test('a missing required variable fails loudly', async () => {
  await assert.rejects(
    () => loadConfig({ DISCORD_TOKEN: '' }, 'missing-token'),
    /Missing required environment variable DISCORD_TOKEN/,
  );
});

test('a malformed number fails loudly', async () => {
  await assert.rejects(() => loadConfig({ RCON_PORT: 'soon' }, 'bad-number'), /must be a number/);
});

test('a malformed boolean fails loudly', async () => {
  await assert.rejects(() => loadConfig({ PRESENCE_ENABLED: 'maybe' }, 'bad-boolean'), /must be true or false/);
});
