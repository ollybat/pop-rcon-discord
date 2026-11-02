import { Client, EmbedBuilder, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { PresenceManager } from './presence.js';
import { RustRconClient } from './rcon.js';

const rcon = new RustRconClient(config.rcon);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const presence = new PresenceManager({
  client,
  rcon,
  options: config.presence,
});

async function relay(content) {
  if (!config.discord.consoleChannelId) return;
  try {
    const channel = await client.channels.fetch(config.discord.consoleChannelId);
    if (channel && channel.isTextBased()) await channel.send(content);
  } catch (error) {
    console.warn('[discord] could not relay to ' + config.discord.consoleChannelId + ': ' + error.message);
  }
}

rcon.on('connected', () => {
  relay({ embeds: [new EmbedBuilder().setColor(0x3ba55d).setDescription('RCON connected to ' + rcon.target)] });
});

rcon.on('disconnected', ({ code, reason }) => {
  const suffix = reason ? ': ' + reason : '';
  relay({
    embeds: [new EmbedBuilder().setColor(0xed4245).setDescription('RCON disconnected (code ' + code + suffix + ')')],
  });
});

// Server chat carries no identifier, so it always arrives as a broadcast.
rcon.on('chat', ({ message, raw }) => {
  const username = raw?.Username ?? 'unknown';
  const channel = raw?.Channel ?? 'global';
  relay('**[' + channel + '] ' + username + ':** ' + message);
});

rcon.on('error', (error) => {
  console.warn('[rcon] ' + error.message);
});

client.once(Events.ClientReady, async (ready) => {
  console.log('[discord] logged in as ' + ready.user.tag);
  await presence.start();
});

async function shutdown(signal) {
  console.log('[bot] ' + signal + ' received, shutting down');
  presence.stop();
  await rcon.close().catch(() => {});
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  rcon.connect().catch((error) => {
    console.warn('[rcon] initial connection failed: ' + error.message + ' — retrying in the background');
  });

  await client.login(config.discord.token);
}

main().catch((error) => {
  console.error('[bot] fatal: ' + error.message);
  process.exit(1);
});
