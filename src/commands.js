import { EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { codeBlock, humanDuration, quoteArgument } from './util.js';

function playerLabel(entry) {
  const name = entry.DisplayName ?? entry.Name ?? 'unknown';
  const steamId = entry.SteamID ?? entry.SteamId ?? '—';
  return name + ' (' + steamId + ')';
}

function playerField(entry) {
  return {
    name: playerLabel(entry).slice(0, 256),
    value: 'ping ' + (entry.Ping ?? '—') + 'ms · online ' + humanDuration(entry.ConnectedSeconds),
    inline: false,
  };
}

export const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('console')
      .setDescription('Run a raw command on the Rust server console')
      .addStringOption((option) =>
        option
          .setName('command')
          .setDescription('e.g. server.info, env.time 12, weather clear')
          .setRequired(true),
      ),
    async execute({ interaction, rcon }) {
      const command = interaction.options.getString('command', true);
      const result = await rcon.send(command);
      await interaction.editReply(codeBlock(result.message || '(command sent, no output)'));
    },
  },
  {
    data: new SlashCommandBuilder().setName('players').setDescription('List the players currently on the server'),
    async execute({ interaction, rcon }) {
      const { data, message } = await rcon.sendJson('playerlist');

      if (!Array.isArray(data)) {
        await interaction.editReply(codeBlock(message || '(no playerlist output)'));
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle('Players online: ' + data.length)
        .setColor(0xce422b)
        .setTimestamp(new Date());

      if (data.length === 0) {
        embed.setDescription('Nobody is connected right now.');
      } else {
        embed.addFields(data.slice(0, 25).map(playerField));
      }

      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('say')
      .setDescription('Broadcast a message in the in-game chat')
      .addStringOption((option) => option.setName('message').setDescription('Text to broadcast').setRequired(true)),
    async execute({ interaction, rcon }) {
      const message = interaction.options.getString('message', true);
      await rcon.send('say ' + quoteArgument(message));
      await interaction.editReply('Broadcast: ' + message);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('kick')
      .setDescription('Kick a player from the server')
      .addStringOption((option) =>
        option.setName('player').setDescription('Steam ID or in-game name').setRequired(true),
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason shown to the player')),
    async execute({ interaction, rcon }) {
      const player = interaction.options.getString('player', true);
      const reason = interaction.options.getString('reason') ?? 'Kicked by an admin';
      const result = await rcon.send('kick ' + quoteArgument(player) + ' ' + quoteArgument(reason));
      const extra = result.message ? '\n' + codeBlock(result.message) : '';
      await interaction.editReply('Kick sent for ' + player + '.' + extra);
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName('ban')
      .setDescription('Ban a player from the server')
      .addStringOption((option) =>
        option.setName('player').setDescription('Steam ID or in-game name').setRequired(true),
      )
      .addStringOption((option) => option.setName('reason').setDescription('Reason recorded with the ban')),
    async execute({ interaction, rcon }) {
      const player = interaction.options.getString('player', true);
      const reason = interaction.options.getString('reason') ?? 'Banned by an admin';
      const result = await rcon.send('ban ' + quoteArgument(player) + ' ' + quoteArgument(reason));
      const extra = result.message ? '\n' + codeBlock(result.message) : '';
      await interaction.editReply('Ban sent for ' + player + '.' + extra);
    },
  },
  {
    data: new SlashCommandBuilder().setName('serverinfo').setDescription('Show a summary of the server'),
    async execute({ interaction, rcon }) {
      const { data, message } = await rcon.sendJson('serverinfo');

      if (!data || typeof data !== 'object') {
        await interaction.editReply(codeBlock(message || '(no serverinfo output)'));
        return;
      }

      const embed = new EmbedBuilder()
        .setTitle(String(data.Server ?? data.Hostname ?? 'Rust server'))
        .setColor(0x5865f2)
        .addFields(
          { name: 'Players', value: String(data.Players ?? '—') + ' / ' + String(data.MaxPlayers ?? '—'), inline: true },
          { name: 'Queued', value: String(data.Queued ?? 0), inline: true },
          { name: 'Joining', value: String(data.Joining ?? 0), inline: true },
          { name: 'Map', value: String(data.Map ?? '—'), inline: true },
          { name: 'Entities', value: String(data.EntityCount ?? data.Entities ?? '—'), inline: true },
          { name: 'Framerate', value: String(data.Framerate ?? '—'), inline: true },
          { name: 'Uptime', value: humanDuration(data.Uptime), inline: true },
          { name: 'Game time', value: String(data.GameTime ?? '—'), inline: true },
        )
        .setTimestamp(new Date());

      await interaction.editReply({ embeds: [embed] });
    },
  },
  {
    data: new SlashCommandBuilder().setName('status').setDescription('Show the bot connection status'),
    async execute({ interaction, rcon }) {
      await interaction.editReply(
        rcon.connected
          ? 'Connected to ' + rcon.target + '.'
          : 'Not connected to ' + rcon.target + ' — the bot keeps retrying in the background.',
      );
    },
  },
];

export const commandNames = commands.map((command) => command.data.name);
