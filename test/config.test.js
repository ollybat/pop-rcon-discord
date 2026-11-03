import assert from 'node:assert/strict';
import { test } from 'node:test';

const REQUIRED = { DISCORD_TOKEN: 'token' };

const MANAGED = [
  'DISCORD_TOKEN',
  'DISCORD_GUILD_ID',
  'PREFIX',
  'PREFIX_COMMANDS_ENABLED',
  'BOT_OWNER_IDS',
  'DATA_DIR',
  'POLL_INTERVAL_SECONDS',
  'RCON_HOST',
  'RCON_PORT',
  'RCON_PASSWORD',
  'RCON_NAME',
  'RCON_TIMEOUT_MS',
  'RCON_MAX_RECONNECT_DELAY_MS',
  'RCON_CHAT_CHANNEL_ID',
  'PRESENCE_ENABLED',
  'PRESENCE_INTERVAL_SECONDS',
  'PRESENCE_GUILD_ID',
  'PRESENCE_SERVER_SLOT',
  'PRESENCE_RESTING_ON_RECONNECT',
  'PRESENCE_ONLINE_FORMAT',
  'PRESENCE_OFFLINE_FORMAT',
  'PRESENCE_RESTING_FORMAT',
  'PRESENCE_PROBLEM_FORMAT',
  'PRESENCE_PROBLEM',
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
    return module;
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test('config reads the required values and applies the Spinback defaults', async () => {
  const { config } = await loadConfig({}, 'defaults');

  assert.equal(config.discord.token, 'token');
  assert.equal(config.discord.guildId, null);
  assert.equal(config.discord.prefix, '!');
  assert.equal(config.discord.prefixCommandsEnabled, true);
  assert.deepEqual(config.discord.botOwnerIds, []);
  assert.equal(config.data.dir, './data');
  assert.equal(config.poll.intervalSeconds, 20);
  assert.equal(config.rcon.fromEnv, null);
  assert.equal(config.rcon.timeoutMs, 15000);
  assert.equal(config.rcon.maxReconnectDelayMs, 30000);
  assert.equal(config.presence.enabled, true);
  assert.equal(config.presence.serverSlot, '1');
  assert.equal(config.presence.restingOnReconnect, false);
  assert.equal(config.presence.formats.online, '🟢 RCON ┆👥 {players}/{max}┆⏳Q: {queued}');
  assert.equal(config.presence.formats.offline, '🛑 RCON ┆ OFFLINE');
  assert.equal(config.presence.formats.resting, '⏳ RCON ┆ RESTING');
  assert.equal(config.presence.formats.problem, '⚠️ RCON ┆ PROBLEM');
  assert.equal(config.presence.problem, true, 'the PROBLEM state is on until /setup says otherwise');
  assert.equal(config.log.level, 'info');
  assert.equal(config.log.timestamps, true);
  assert.equal(config.log.chatChannelId, null);
});

test('the .env RCON block becomes the optional slot 1 server', async () => {
  const { config } = await loadConfig(
    { RCON_HOST: '127.0.0.1', RCON_PASSWORD: 'secret', RCON_PORT: '29000', RCON_NAME: 'EU 5X' },
    'env-server',
  );

  assert.deepEqual(config.rcon.fromEnv, { name: 'EU 5X', host: '127.0.0.1', port: 29000, password: 'secret' });
});

test('numbers, booleans, lists and custom formats are all parsed', async () => {
  const { config } = await loadConfig(
    {
      POLL_INTERVAL_SECONDS: '1',
      PRESENCE_RESTING_ON_RECONNECT: 'yes',
      PRESENCE_ONLINE_FORMAT: 'online {players}',
      PRESENCE_PROBLEM: 'no',
      PRESENCE_SERVER_SLOT: 'all',
      BOT_OWNER_IDS: '111, 222',
      DISCORD_GUILD_ID: '333',
      PREFIX: '?',
      RCON_CHAT_CHANNEL_ID: '444',
      LOG_LEVEL: 'DEBUG',
      LOG_TIMESTAMPS: 'off',
    },
    'parsing',
  );

  assert.equal(config.poll.intervalSeconds, 5, 'the 5 second floor protects the server');
  assert.equal(config.presence.restingOnReconnect, true);
  assert.equal(config.presence.formats.online, 'online {players}');
  assert.equal(config.presence.problem, false, 'PRESENCE_PROBLEM=no switches the ⚠️ state off for everybody');
  assert.equal(config.presence.formats.offline, '🛑 RCON ┆ OFFLINE', 'the other lines keep their defaults');
  assert.deepEqual(config.discord.botOwnerIds, ['111', '222']);
  assert.equal(config.discord.guildId, '333');
  assert.equal(config.discord.prefix, '?');
  assert.equal(config.log.chatChannelId, '444');
  assert.equal(config.log.level, 'debug');
  assert.equal(config.log.timestamps, false);
});

test('PRESENCE_INTERVAL_SECONDS still works as an alias for the poll interval', async () => {
  const { config } = await loadConfig({ PRESENCE_INTERVAL_SECONDS: '45' }, 'alias');
  assert.equal(config.poll.intervalSeconds, 45);
});

test('presenceSlot accepts 1-3, all and nonsense', async () => {
  const { presenceSlot } = await loadConfig({}, 'slot-helper');
  assert.equal(presenceSlot('2'), 2);
  assert.equal(presenceSlot('3'), 3);
  assert.equal(presenceSlot('all'), 'all');
  assert.equal(presenceSlot('9'), 1);
  assert.equal(presenceSlot('nonsense'), 1);
  assert.equal(presenceSlot(''), 1);
});

test('a missing required variable fails loudly', async () => {
  await assert.rejects(() => loadConfig({ DISCORD_TOKEN: '' }, 'missing-token'), /Missing required environment variable DISCORD_TOKEN/);
});

test('a malformed number fails loudly', async () => {
  await assert.rejects(() => loadConfig({ RCON_PORT: 'soon' }, 'bad-number'), /must be a number/);
});

test('a malformed boolean fails loudly', async () => {
  await assert.rejects(() => loadConfig({ PRESENCE_ENABLED: 'maybe' }, 'bad-boolean'), /must be true or false/);
});
