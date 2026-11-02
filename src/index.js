import { Client, Events, GatewayIntentBits } from 'discord.js';
import { config } from './config.js';
import { createLogger } from './logger.js';
import { PresenceManager } from './presence.js';
import { RustRconClient } from './rcon.js';
import { ChannelRelay } from './relay.js';

const logger = createLogger({ level: config.log.level, timestamps: config.log.timestamps });
const rcon = new RustRconClient({ ...config.rcon, logger });
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const relay = new ChannelRelay({ client, channelId: config.discord.consoleChannelId, logger });
const presence = new PresenceManager({ client, rcon, options: config.presence, logger });

/** Relay calls are fire-and-forget: never let one take the bot down. */
const fire = (result) => {
  Promise.resolve(result).catch((error) => logger.warn('[relay] ' + error.message));
};

rcon.on('connected', () => fire(relay.rconConnected(rcon.target)));
rcon.on('disconnected', (info) => fire(relay.rconDisconnected(info)));
rcon.on('chat', (payload) => fire(relay.chat(payload)));
rcon.on('error', (error) => logger.warn('[rcon] ' + error.message));

client.once(Events.ClientReady, async (ready) => {
  const relayNote = relay.enabled ? 'relaying to ' + relay.channelId : 'relay disabled';
  logger.info('[discord] logged in as ' + ready.user.tag + ' - ' + relayNote);
  await presence.start();
});

async function shutdown(signal) {
  logger.info('[bot] ' + signal + ' received, shutting down');
  presence.stop();
  await rcon.close().catch(() => {});
  await client.destroy();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

async function main() {
  logger.info('[bot] starting - RCON target ' + rcon.target);

  rcon.connect().catch((error) => {
    logger.warn('[rcon] initial connection failed: ' + error.message + ' - retrying in the background');
  });

  await client.login(config.discord.token);
}

main().catch((error) => {
  logger.error('[bot] fatal: ' + error.message);
  process.exit(1);
});
