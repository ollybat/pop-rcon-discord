import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { peakLine, popServerEmbed, popSetupHintEmbed, popSummaryEmbed } from './embeds.js';
import { history, slotKey } from './history.js';
import { sparkline } from './format.js';
import { peakFor } from './store.js';

export const POP_ID = 'sb:pop';

/** "sb:pop:<action>:<slot|all>:<players 0|1>:<details 0|1>" */
export function parsePopId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts[0] !== 'sb' || parts[1] !== 'pop') return null;

  const slotRaw = parts[3] ?? 'all';
  const slot = slotRaw === 'all' ? null : Number(slotRaw);

  return {
    action: parts[2] ?? 'view',
    slot: Number.isInteger(slot) && slot >= 1 ? slot : null,
    players: parts[4] === undefined ? true : parts[4] !== '0',
    details: parts[5] === undefined ? true : parts[5] !== '0',
  };
}

function popId(action, slot, players, details = true) {
  return POP_ID + ':' + action + ':' + (slot ?? 'all') + ':' + (players ? '1' : '0') + ':' + (details ? '1' : '0');
}

function button(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

/** The switch, refresh, players and details buttons under a /pop answer. */
export function popRows({ snapshots = [], focus = null, showPlayers = true, details = true, allowLive = true }) {
  const rows = [];
  const switches = [];
  const configured = snapshots.filter((snapshot) => snapshot);

  if (configured.length > 1) {
    switches.push(
      button(popId('view', null, showPlayers, details), focus === null ? 'All servers' : 'All', '🌍', focus === null ? ButtonStyle.Primary : ButtonStyle.Secondary).setDisabled(
        focus === null,
      ),
    );
  }

  for (const snapshot of configured.slice(0, 3)) {
    switches.push(
      button(
        popId('view', snapshot.slot, showPlayers, details),
        'Server ' + snapshot.slot,
        snapshot.connected ? '🟢' : '🔴',
        focus === snapshot.slot ? ButtonStyle.Primary : ButtonStyle.Secondary,
      ).setDisabled(focus === snapshot.slot),
    );
  }

  if (switches.length > 0) rows.push(new ActionRowBuilder().addComponents(switches.slice(0, 5)));

  rows.push(
    new ActionRowBuilder().addComponents(
      button(popId('refresh', focus, showPlayers, details), 'Refresh', '🔄', ButtonStyle.Success),
      button(popId('toggle', focus, !showPlayers, details), showPlayers ? 'Hide players' : 'Show players', '👥', ButtonStyle.Secondary),
      button(popId('details', focus, showPlayers, !details), details ? 'Less' : 'More', details ? '🔼' : '🔽', ButtonStyle.Secondary),
      ...(allowLive ? [button(popId('live', focus, showPlayers, details), 'Keep live', '🔴', ButtonStyle.Secondary)] : []),
    ),
  );

  return rows;
}

/** Everything a /pop message needs, for any selection. */
export function popPayload({
  snapshots = [],
  config = null,
  showPlayers = true,
  details = true,
  focus = null,
  pollSeconds = null,
  guildId = null,
  note = null,
  allowLive = true,
}) {
  if (snapshots.length === 0) return { embeds: [popSetupHintEmbed()], components: [] };

  const visible = focus ? snapshots.filter((snapshot) => snapshot.slot === focus) : snapshots;
  const shown = visible.length > 0 ? visible : snapshots;
  const embeds = [];

  /** The last few readings of one slot, for the direction arrow and the little bar chart. */
  function recent(slot) {
    if (!guildId) return { delta: null, spark: null };
    const key = slotKey(guildId, slot);
    const values = history.series(key).map((sample) => sample.players);
    return {
      delta: history.delta(key),
      spark: values.length >= 3 ? sparkline(values, { min: 0 }) : null,
    };
  }

  if (!focus && shown.length > 1) {
    const online = shown.filter((snapshot) => snapshot.connected && snapshot.info);

    // The busiest of today's peaks, so the summary says something the poll cannot.
    let busiest = null;
    for (const snapshot of shown) {
      const peak = peakFor(config, snapshot.slot);
      if (peak && peak.peak && (!busiest || peak.peak > busiest.peak)) {
        busiest = { name: snapshot.name, peak: peak.peak, at: peak.at };
      }
    }

    embeds.push(
      popSummaryEmbed({
        compact: !details,
        totalPlayers: online.reduce((sum, snapshot) => sum + snapshot.info.players, 0),
        totalMax: online.reduce((sum, snapshot) => sum + snapshot.info.max, 0),
        note,
        onlineServers: online.length,
        totalServers: shown.length,
        pollSeconds,
        busiest,
        servers: shown.map((snapshot) => {
          const { delta, spark } = recent(snapshot.slot);
          return {
            slot: snapshot.slot,
            name: snapshot.name,
            connected: Boolean(snapshot.connected),
            restarting: Boolean(snapshot.info?.restarting),
            players: snapshot.info?.players ?? 0,
            max: snapshot.info?.max ?? 0,
            queued: snapshot.info?.queued ?? 0,
            delta,
            spark,
          };
        }),
      }),
    );
  }

  for (const snapshot of shown) {
    embeds.push(
      popServerEmbed(snapshot, {
        showPlayers,
        compact: !details,
        guildId,
        note: embeds.length === 0 ? note : null,
        peak: peakLine(config, snapshot.slot, snapshot.info ? snapshot.info.max : null),
      }),
    );
  }

  // The buttons always cover every server, so a focused view can still switch back to All.
  return { embeds: embeds.slice(0, 10), components: popRows({ snapshots, focus, showPlayers, details, allowLive }) };
}

/** Refresh, switch server, show/hide players and compact/expand on an existing answer. */
export async function handlePopComponent(interaction, ctx) {
  const parsed = parsePopId(interaction.customId);
  if (!parsed) return false;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Use this inside a Discord server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const config = ctx.store.get(guild.id);

  /**
   * If this answer is already live, it must remember what the last button asked for, or the next
   * refresh would undo the reader's choice a few seconds later.
   */
  function keepLiveInSync() {
    const entry = ctx.board?.liveEntry?.({ channelId: interaction.channelId, messageId: interaction.message?.id });
    if (!entry) return null;
    entry.focus = parsed.slot;
    entry.showPlayers = parsed.players;
    entry.details = parsed.details;
    return entry;
  }

  if (parsed.action === 'live') {
    if (!ctx.board) {
      await interaction.reply({ content: 'Live updates are not available on this bot right now.', flags: MessageFlags.Ephemeral });
      return true;
    }

    const message = interaction.message;
    const running = ctx.board.liveEntry({ channelId: interaction.channelId, messageId: message.id });
    const snapshots = ctx.servers.snapshots(guild.id);

    // Press once to keep this answer live, press again to leave it where it is.
    if (running) {
      ctx.board.stopLive({ channelId: interaction.channelId, messageId: message.id });
      await interaction.update({
        ...popPayload({ snapshots, config, showPlayers: parsed.players, details: parsed.details, focus: parsed.slot, guildId: guild.id, pollSeconds: ctx.pollSeconds ?? null }),
        content: '⏸ Live updates stopped. Press 🔴 Keep live to start them again.',
      });
      return true;
    }

    await interaction.deferUpdate();
    const until = await ctx.board.startLive({
      guildId: guild.id,
      channelId: interaction.channelId,
      messageId: message.id,
      focus: parsed.slot,
      showPlayers: parsed.players,
      details: parsed.details,
    });

    if (!until) {
      await interaction.followUp({ content: 'I could not start live updates on that message — I need permission to edit it.', flags: MessageFlags.Ephemeral }).catch(() => null);
      return true;
    }

    await interaction.editReply({ content: null }).catch(() => null);
    return true;
  }

  if (parsed.action === 'refresh') {
    await interaction.deferUpdate();
    keepLiveInSync();
    const snapshots = await ctx.servers.refreshGuild(guild.id);
    await interaction.editReply(
      popPayload({
        snapshots,
        config,
        showPlayers: parsed.players,
        details: parsed.details,
        focus: parsed.slot,
        guildId: guild.id,
        pollSeconds: ctx.pollSeconds ?? null,
      }),
    );
    return true;
  }

  keepLiveInSync();

  await interaction.update(
    popPayload({
      snapshots: ctx.servers.snapshots(guild.id),
      config,
      showPlayers: parsed.players,
      details: parsed.details,
      focus: parsed.slot,
      guildId: guild.id,
      pollSeconds: ctx.pollSeconds ?? null,
    }),
  );
  return true;
}

/** Small helper the commands use for the "no servers yet" case. */
export function popPlaceholder() {
  return { embeds: [popSetupHintEmbed()], components: [] };
}

