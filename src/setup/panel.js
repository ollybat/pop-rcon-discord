import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { guideEmbed, hintEmbed, logsEmbed, panelEmbed, rolesEmbed, serversEmbed } from '../embeds.js';
import { BRAND, COLORS, LOG_KINDS, STATUS, TIERS, tierById } from '../theme.js';
import { maskPassword } from '../format.js';
import { MAX_SERVERS, describeConfig } from '../store.js';

export const SETUP_ID = 'sb:setup';

export function parseCustomId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts[0] !== 'sb' || parts[1] !== 'setup') return null;
  return { action: parts[2] ?? 'main', args: parts.slice(3) };
}

function button(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

export function mainPanel(config, { snapshots = [], guild = null } = {}) {
  const status = describeConfig(config);

  const top = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':view:roles', 'Roles', '🎭', ButtonStyle.Primary),
    button(SETUP_ID + ':view:logs', 'Logs', '📋', ButtonStyle.Primary),
    button(SETUP_ID + ':view:servers', 'Servers', '🖥️', ButtonStyle.Primary),
    button(SETUP_ID + ':refresh', 'Refresh', '🔄', ButtonStyle.Secondary),
    button(SETUP_ID + ':done', 'Done', '✅', ButtonStyle.Success),
  );

  const bottom = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':quick', status.ready ? 'Finish up' : 'Quick setup', '⚡', ButtonStyle.Success),
    button(SETUP_ID + ':matchroles', 'Guess roles', '🪄', ButtonStyle.Secondary),
    button(SETUP_ID + ':createlogs', 'Make channels', '📁', ButtonStyle.Secondary),
    button(SETUP_ID + ':guide', 'Guide', '📖', ButtonStyle.Secondary),
    button(SETUP_ID + ':reset', 'Reset', '🧹', ButtonStyle.Danger),
  );

  const tests = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':testlogs', 'Test channels', '🧪', ButtonStyle.Secondary),
    button(SETUP_ID + ':testping', 'Health check', '🏓', ButtonStyle.Secondary),
  );

  return { embeds: [panelEmbed({ guild, config, snapshots })], components: [top, bottom, tests] };
}

export function rolesView(config) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':role')
    .setPlaceholder('Pick a role to change')
    .addOptions(
      TIERS.map((tier) => ({
        label: tier.label,
        value: tier.id,
        emoji: tier.emoji,
        description: (config.roles?.[tier.id] ? 'Set' : 'Not set') + (tier.required ? ' • required' : ''),
      })),
    );

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':matchroles', 'Guess roles', '🪄', ButtonStyle.Success),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [rolesEmbed({ config })], components: [new ActionRowBuilder().addComponents(select), row] };
}

export function rolePickView(config, tierId) {
  const tier = tierById(tierId);
  if (!tier) return rolesView(config);

  const select = new RoleSelectMenuBuilder().setCustomId(SETUP_ID + ':roleset:' + tier.id).setPlaceholder('Pick the ' + tier.label);
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':roleclear:' + tier.id, 'Clear', '🧹', ButtonStyle.Danger).setDisabled(tier.required),
    button(SETUP_ID + ':view:roles', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return {
    embeds: [
      hintEmbed(
        tier.emoji + ' ' + tier.label,
        tier.description +
          '\n\nCurrently: ' +
          (config.roles?.[tier.id] ? '<@&' + config.roles[tier.id] + '>' : 'not set') +
          (tier.required ? '\nThis one is required, so it can be changed but not cleared.' : ''),
      ),
    ],
    components: [new ActionRowBuilder().addComponents(select), row],
  };
}

export function logsView(config) {
  const rows = LOG_KINDS.map((kind) =>
    new ActionRowBuilder().addComponents(
      new ChannelSelectMenuBuilder()
        .setCustomId(SETUP_ID + ':logset:' + kind.id)
        .setPlaceholder(kind.emoji + ' ' + kind.label + ' channel')
        .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
        .setMinValues(0)
        .setMaxValues(1),
    ),
  );

  rows.push(
    new ActionRowBuilder().addComponents(
      button(SETUP_ID + ':testlogs', 'Send test', '🧪', ButtonStyle.Secondary),
      button(SETUP_ID + ':createlogs', 'Make channels', '📁', ButtonStyle.Success),
      button(SETUP_ID + ':logclear', 'Clear all', '🧹', ButtonStyle.Danger),
      button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [logsEmbed({ config })], components: rows.slice(0, 5) };
}

export function serversView(config, { snapshots = [] } = {}) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':slots')
    .setPlaceholder('Pick a slot to add or edit a server')
    .addOptions(
      SLOTS.map((slot) => {
        const server = config.servers?.[slot - 1] ?? null;
        return {
          label: 'Slot ' + slot,
          value: String(slot),
          emoji: server ? '🎮' : '➕',
          description: server ? server.name + ' • ' + server.host + ':' + server.port : 'Empty — pick this to add a server',
        };
      }),
    );

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':guide', 'Guide', '📖', ButtonStyle.Success),
    button(SETUP_ID + ':refresh', 'Test all', '📡', ButtonStyle.Secondary),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [serversEmbed({ config, snapshots })], components: [new ActionRowBuilder().addComponents(select), row] };
}

export function slotView(config, slot, snapshot = null) {
  const server = config.servers?.[slot - 1] ?? null;
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':slotedit:' + slot, server ? 'Edit' : 'Add', server ? '✏️' : '➕', ButtonStyle.Primary),
    button(SETUP_ID + ':slottest:' + slot, 'Test', '📡', ButtonStyle.Secondary),
    button(SETUP_ID + ':slotclear:' + slot, 'Remove', '🗑️', ButtonStyle.Danger).setDisabled(!server),
    button(SETUP_ID + ':view:servers', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  const state = snapshot ? (snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline') : null;
  const lines = [
    server ? '**' + server.name + '**' : 'Nothing configured in slot ' + slot + ' yet.',
    server
      ? 'Address: \`' + server.host + ':' + server.port + '\` • password \`' + maskPassword(server.password) + '\`'
      : 'Press **Add** to fill in the name, address, RCON port and password.',
    state ? STATUS[state].emoji + ' ' + STATUS[state].label + (snapshot.latencyMs === null ? '' : ' • ' + snapshot.latencyMs + 'ms') : '',
    server ? 'Press **Test** to check it right now.' : '',
  ].filter(Boolean);

  return { embeds: [hintEmbed('🖥️ Server slot ' + slot, lines.join('\n\n'))], components: [row] };
}

function unusedMask(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length || 1);
  return text.slice(0, 2) + '*'.repeat(Math.max(3, text.length - 4)) + text.slice(-2);
}

export function serverModal(slot, server = null) {
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Server name')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(60)
    .setPlaceholder(BRAND.serverDefault);

  const host = new TextInputBuilder()
    .setCustomId('host')
    .setLabel('Server IP or host')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120)
    .setPlaceholder('123.45.67.89');

  const port = new TextInputBuilder()
    .setCustomId('port')
    .setLabel('RCON port')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5)
    .setValue(String(server?.port ?? 28016));

  const password = new TextInputBuilder()
    .setCustomId('password')
    .setLabel(server ? 'RCON password (blank keeps it)' : 'RCON password')
    .setStyle(TextInputStyle.Short)
    .setRequired(!server)
    .setMaxLength(200);

  if (server) {
    name.setValue(server.name);
    host.setValue(server.host);
  }

  return new ModalBuilder()
    .setCustomId(SETUP_ID + ':modalslot:' + slot)
    .setTitle('Server slot ' + slot)
    .addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(host),
      new ActionRowBuilder().addComponents(port),
      new ActionRowBuilder().addComponents(password),
    );
}

export function guideView(config) {
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':view:servers', 'Servers', '🖥️', ButtonStyle.Primary),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [guideEmbed({ config })], components: [row] };
}

export function resetView(config) {
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':resetconfirm', 'Yes, wipe it', '🗑️', ButtonStyle.Danger),
    button(SETUP_ID + ':main', 'Cancel', '⬅️', ButtonStyle.Secondary),
  );

  return {
    embeds: [
      hintEmbed(
        '🧹 Reset everything?',
        'This clears the roles, the log channels, the servers **and** every saved password for this Discord server.\n' +
          'It cannot be undone. Add the servers again afterwards.',
        COLORS.danger,
      ),
    ],
    components: [row],
  };
}

export const SLOTS = Array.from({ length: MAX_SERVERS }, (_, index) => index + 1);
