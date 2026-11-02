import { Client, GatewayIntentBits } from 'discord.js';
import { createLogger } from '../src/logger.js';
import { RustRconClient } from '../src/rcon.js';
import { maskSecret, presenceLine, summarizeServerInfo } from '../src/summary.js';

// The diagnostics print their own lines, so keep the client logger quiet.
const logger = createLogger({ level: 'silent', timestamps: false });
const results = [];

function section(title) {
  console.log('\n' + title);
}

function step(name, ok, detail = '') {
  results.push({ name, ok });
  console.log('  [' + (ok ? 'ok  ' : 'FAIL') + '] ' + name + (detail ? ' - ' + detail : ''));
}

async function main() {
  let config;
  try {
    ({ config } = await import('../src/config.js'));
  } catch (error) {
    console.error('  [FAIL] configuration - ' + error.message);
    process.exit(1);
  }

  section('Configuration');
  step('discord token', Boolean(config.discord.token), 'ends with ' + maskSecret(config.discord.token));
  step(
    'rcon target',
    Boolean(config.rcon.host && config.rcon.password),
    config.rcon.host + ':' + config.rcon.port + ' password ' + maskSecret(config.rcon.password),
  );
  step('relay channel', true, config.discord.consoleChannelId || 'disabled (CONSOLE_CHANNEL_ID empty)');
  step('presence', config.presence.enabled, 'every ' + config.presence.intervalSeconds + 's');

  section('RCON');
  const rcon = new RustRconClient({ ...config.rcon, logger, autoReconnect: false });
  let connected = false;

  try {
    await rcon.connect();
    connected = true;
    step('connect', true, rcon.target);
  } catch (error) {
    step('connect', false, error.message + ' - check the port, the firewall and rcon.password');
  }

  if (connected) {
    try {
      const { data, message, type } = await rcon.sendJson('serverinfo');
      const summary = summarizeServerInfo(data);
      step('serverinfo', summary.ok, 'reply type ' + type);
      for (const line of summary.lines) console.log('         ' + line);
      console.log('         status line -> ' + presenceLine(summary.info, config.presence.formats));
      if (!summary.ok && message) console.log('         raw reply: ' + message.slice(0, 200));
    } catch (error) {
      step('serverinfo', false, error.message);
    }

    try {
      const { data } = await rcon.sendJson('playerlist');
      const players = Array.isArray(data) ? data : [];
      step('playerlist', Array.isArray(data), players.length + ' player(s) online');
    } catch (error) {
      step('playerlist', false, error.message);
    }
  }

  await rcon.close().catch(() => {});

  section('Discord');
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  try {
    await client.login(config.discord.token);
    step('login', true, client.user ? client.user.tag : 'connected');
  } catch (error) {
    step('login', false, error.message + ' - check DISCORD_TOKEN');
  }
  try {
    client.destroy();
  } catch {
    // already gone
  }

  const failed = results.filter((result) => !result.ok).length;
  section('Result');
  console.log(
    failed === 0
      ? '  All ' + results.length + ' checks passed - your .env looks good.'
      : '  ' + failed + ' of ' + results.length + ' checks failed - see docs/TROUBLESHOOTING.md',
  );
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error('doctor crashed: ' + (error && error.message ? error.message : error));
  process.exit(1);
});
