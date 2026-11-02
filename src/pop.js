import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { peakLine, popServerEmbed, popSetupHintEmbed, popSummaryEmbed } from './embeds.js';

export const POP_ID = 'sb:pop';

/** "sb:pop:<action>:<slot|all>:<players 0|1>" */
export function parsePopId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts[0] !== 'sb' || parts[1] !== 'pop') return null;

  const slotRaw = parts[3] ?? 'all';
  const slot = slotRaw === 'all' ? null : Number(slotRaw);

  return {
    action: parts[2] ?? 'view',
    slot: Number.isInteger(slot) && slot >= 1 ? slot : null,
    players: parts[4] === undefined ? true : parts[4] !== '0',
  };
}

function popId(action, slot, players) {
  return POP_ID + ':' + action + ':' + (slot ?? 'all') + ':' + (players ? '1' : '0');
}

function button(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

/** The switch + refresh buttons under a /pop answer. */
export function popRows({ snapshots = [], focus = null, showPlayers = true }) {
  const rows = [];
  const switches = [];
  const configured = snapshots.filter((snapshot) => snapshot);

  if (configured.length > 1) {
    switches.push(
      button(popId('view', null, showPlayers), focus === null ? 'All servers' : 'All', '🌍', focus === null ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(focus === null),
    );
  }

  for (const snapshot of configured.slice(0, 3)) {
    switches.push(
      button(
        popId('view', snapshot.slot, showPlayers),
        'Server ' + snapshot.slot,
        snapshot.connected ? '🟢' : '🔴',
        focus === snapshot.slot ? ButtonStyle.Primary : ButtonStyle.Secondary,
      ).setDisabled(focus === snapshot.slot),
    );
  }

  if (switches.length > 0) rows.push(new ActionRowBuilder().addComponents(switches.slice(0, 5)));

  rows.push(
    new ActionRowBuilder().addComponents(
      button(popId('refresh', focus, showPlayers), 'Refresh', '🔄', ButtonStyle.Success),
      button(popId('toggle', focus, !showPlayers), showPlayers ? 'Hide players' : 'Show players', '👥', ButtonStyle.Secondary),
    ),
  );

  return rows;
}

/** Everything a /pop message needs, for any selection. */
export function popPayload({ snapshots = [], config = null, showPlayers = true, focus = null }) {
  if (snapshots.length === 0) return { embeds: [popSetupHintEmbed()], components: [] };

  const visible = focus ? snapshots.filter((snapshot) => snapshot.slot === focus) : snapshots;
  const shown = visible.length > 0 ? visible : snapshots;
  const embeds = [];

  if (!focus && shown.length > 1) {
    const online = shown.filter((snapshot) => snapshot.connected && snapshot.info);
    embeds.push(
      popSummaryEmbed({
        totalPlayers: online.reduce((sum, snapshot) => sum + snapshot.info.players, 0),
        totalMax: online.reduce((sum, snapshot) => sum + snapshot.info.max, 0),
        onlineServers: online.length,
        totalServers: shown.length,
      }),
    );
  }

  for (const snapshot of shown) {
    embeds.push(
      popServerEmbed(snapshot, {
        showPlayers,
        peak: peakLine(config, snapshot.slot, snapshot.info ? snapshot.info.max : null),
      }),
    );
  }

  // The buttons always cover every server, so a focused view can still switch back to All.
  return { embeds: embeds.slice(0, 10), components: popRows({ snapshots, focus, showPlayers }) };
}

/** Refresh, switch server and show/hide players on an existing /pop (or !pop) answer. */
export async function handlePopComponent(interaction, ctx) {
  const parsed = parsePopId(interaction.customId);
  if (!parsed) return false;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Use this inside a Discord server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const config = ctx.store.get(guild.id);

  if (parsed.action === 'refresh') {
    await interaction.deferUpdate();
    const snapshots = await ctx.servers.refreshGuild(guild.id);
    await interaction.editReply(popPayload({ snapshots, config, showPlayers: parsed.players, focus: parsed.slot }));
    return true;
  }

  await interaction.update(
    popPayload({
      snapshots: ctx.servers.snapshots(guild.id),
      config,
      showPlayers: parsed.players,
      focus: parsed.slot,
    }),
  );
  return true;
}

/** Small helper the commands use for the "no servers yet" case. */
export function popPlaceholder() {
  return { embeds: [popSetupHintEmbed()], components: [] };
}
