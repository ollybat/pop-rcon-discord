import { Client, EmbedBuilder, Events, GatewayIntentBits, MessageFlags, REST, Routes } from 'discord.js';
import { config } from './config.js';
import { commands } from './commands.js';
import { RustRconClient } from './rcon.js';

const rcon = new RustRconClient(config.rcon);
const client = new Client({ intents: [GatewayIntentBits.Guilds] });
const handlers = new Map(commands.map((command) => [command.data.name, command]));

function isAllowed(member) {
  if (config.discord.commandRoleIds.length === 0) return true;
  if (!member || !member.roles) return false;
  return member.roles.cache.some((role) => config.discord.commandRoleIds.includes(role.id));
}

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

// Server chat has no identifier, so it lands here rather than in a command reply.
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

  const rest = new REST().setToken(config.discord.token);
  const body = commands.map((command) => command.data.toJSON());
  const appId = config.discord.appId ?? ready.application.id;
  const scope = config.discord.guildId ? 'guild ' + config.discord.guildId : 'globally';

  try {
    await rest.put(
      config.discord.guildId
        ? Routes.applicationGuildCommands(appId, config.discord.guildId)
        : Routes.applicationCommands(appId),
      { body },
    );
    console.log('[discord] registered ' + body.length + ' commands ' + scope);
  } catch (error) {
    console.error('[discord] command registration failed: ' + error.message);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  const handler = handlers.get(interaction.commandName);
  if (!handler) return;

  if (!isAllowed(interaction.member)) {
    await interaction.reply({
      content: 'You do not have permission to use this command.',
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  try {
    await handler.execute({ interaction, rcon, client });
  } catch (error) {
    console.error('[discord] /' + interaction.commandName + ' failed: ' + error.message);
    try {
      await interaction.editReply({ content: 'Command failed: ' + error.message });
    } catch {
      // interaction already gone - nothing else to do
    }
  }
});

async function shutdown(signal) {
  console.log('[bot] ' + signal + ' received, shutting down');
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
