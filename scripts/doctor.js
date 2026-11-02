import { Client, GatewayIntentBits } from 'discord.js';
import { createLogger } from '../src/logger.js';
import { RustRconClient } from '../src/rcon.js';
import { GuildStore, configuredServers, describeConfig } from '../src/store.js';
import { effectiveServers } from '../src/servers.js';
import { formatPresence, normalizeServerInfo } from '../src/presence.js';
import { duration, maskPassword } from '../src/format.js';

// The diagnostics print their own lines, so keep the client logs quiet.
const logger = createLogger({ level: 'silent', timestamps: false });
const results = [];

function section(title) {
  console.log('\n' + title);
}

function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log('  [' + (ok ? 'ok  ' : 'FAIL') + '] ' + name + (detail ? ' - ' + detail : ''));
}

function note(text) {
  console.log('        ' + text);
}

async function checkConfig(config) {
  section('Configuration');
  step('discord token', Boolean(config.discord.token), 'ends with ' + maskPassword(config.discord.token));
  step('prefix commands', true, config.discord.prefixCommandsEnabled ? 'enabled with "' + config.discord.prefix + '"' : 'disabled');
  step('bot owners', true, config.discord.botOwnerIds.length === 0 ? 'none configured (the server owner still has access)' : config.discord.botOwnerIds.join(', '));
  step('poll interval', config.poll.intervalSeconds >= 5, config.poll.intervalSeconds + 's');
  step('data directory', true, config.data.dir);
  step(
    'presence formats',
    Boolean(config.presence.formats.online && config.presence.formats.offline && config.presence.formats.resting),
    'slot ' + config.presence.serverSlot,
  );
  note('online  -> ' + formatPresence(config.presence.formats.online, { players: 12, max: 200, queued: 0, joining: 0 }));
  note('offline -> ' + formatPresence(config.presence.formats.offline));
  note('resting -> ' + formatPresence(config.presence.formats.resting));

  if (config.rcon.fromEnv) {
    step('env RCON shortcut', true, config.rcon.fromEnv.host + ':' + config.rcon.fromEnv.port + ' password ' + maskPassword(config.rcon.fromEnv.password));
  } else {
    step('env RCON shortcut', true, 'not set - /setup is the only server source');
  }
}

async function checkStore(config) {
  section('Saved /setup data');
  const store = new GuildStore({ dir: config.data.dir, logger });
  const guildIds = store.listGuildIds();

  if (guildIds.length === 0) {
    step('guilds on disk', true, 'none yet - run /setup once and run doctor again');
    return { store, guildIds: [] };
  }

  for (const guildId of guildIds) {
    const saved = await store.load(guildId);
    const status = describeConfig(saved);
    step(
      'guild ' + guildId,
      status.ready,
      status.roles + ' roles, ' + status.logs + ' logs, ' + status.servers + ' servers' + (status.ready ? '' : ' - not finished yet'),
    );
    for (const server of configuredServers(saved)) {
      note('slot ' + server.slot + ': ' + server.name + ' ' + server.host + ':' + server.port + ' password ' + maskPassword(server.password));
    }
  }

  return { store, guildIds };
}

async function checkRcon(config, store, guildIds) {
  section('RCON');

  const targets = [];
  for (const guildId of guildIds) {
    for (const server of effectiveServers(store.get(guildId), config.rcon.fromEnv)) targets.push({ guildId, server });
  }
  if (targets.length === 0 && config.rcon.fromEnv) targets.push({ guildId: null, server: { slot: 1, ...config.rcon.fromEnv } });

  if (targets.length === 0) {
    step('servers to test', true, 'none configured yet');
    return;
  }

  for (const { guildId, server } of targets) {
    const client = new RustRconClient({
      host: server.host,
      port: server.port,
      password: server.password,
      timeoutMs: 10000,
      autoReconnect: false,
      logger,
    });

    try {
      await client.connect();
      const info = normalizeServerInfo((await client.sendJson('serverinfo')).data);
      const players = (await client.sendJson('playerlist')).data;
      const count = Array.isArray(players) ? players.length : 0;

      step(
        (guildId ? 'guild ' + guildId + ' ' : '') + server.name,
        Boolean(info),
        info
          ? info.players + '/' + info.max + ' online, ' + count + ' in playerlist, uptime ' + duration(info.uptime) + ' (' + server.host + ':' + server.port + ')'
          : 'connected, but serverinfo was not JSON - is this a Rust PC server with +rcon.web 1?',
      );
    } catch (error) {
      step((guildId ? 'guild ' + guildId + ' ' : '') + server.name, false, error.message + ' (' + server.host + ':' + server.port + ')');
      note('Check: +rcon.web 1, +rcon.port ' + server.port + ', +rcon.password matching, and the port open over TCP.');
    } finally {
      await client.close().catch(() => {});
    }
  }
}

async function checkDiscord(config, store) {
  section('Discord');

  const intents = [GatewayIntentBits.Guilds];
  if (config.discord.prefixCommandsEnabled) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);

  const client = new Client({ intents });

  try {
    await client.login(config.discord.token);
    step('login', true, client.user.tag);

    const commands = await client.application.commands.fetch().catch(() => null);
    step('global slash commands', Boolean(commands && commands.size > 0), commands ? commands.size + ' registered' : 'none registered yet (they appear after the first start)');

    for (const guild of client.guilds.cache.values()) {
      const saved = store.get(guild.id);
      const status = describeConfig(saved);
      step('guild ' + guild.name, true, status.ready ? 'setup complete (' + status.servers + ' servers)' : 'setup not finished - run /setup');

      for (const [kind, channelId] of Object.entries(saved.logs ?? {})) {
        if (!channelId) continue;
        const channel = await guild.channels.fetch(channelId).catch(() => null);
        step('log channel ' + kind, Boolean(channel), channel ? '#' + channel.name : 'channel ' + channelId + ' is missing - pick a new one with /setup');
      }
    }
  } catch (error) {
    step('login', false, error.message);
  } finally {
    await client.destroy().catch(() => {});
  }
}

async function main() {
  let config;
  try {
    ({ config } = await import('../src/config.js'));
  } catch (error) {
    console.error('  [FAIL] configuration - ' + error.message);
    process.exit(1);
  }

  await checkConfig(config);
  const { store, guildIds } = await checkStore(config);
  await checkRcon(config, store, guildIds);
  await checkDiscord(config, store);

  const failed = results.filter((result) => !result.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  if (failed.length > 0) {
    console.log('Problems: ' + failed.map((result) => result.name).join(', '));
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('doctor crashed: ' + (error && error.stack ? error.stack : error));
  process.exit(1);
});
