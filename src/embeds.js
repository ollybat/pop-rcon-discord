import { EmbedBuilder } from 'discord.js';
import { bar, clock, duration, maskPassword, plural, truncate } from './format.js';
import { BRAND, COLORS, EMOJI, LOG_KINDS, STATUS, TIERS, footerText, tierById } from './theme.js';
import { MAX_SERVERS, describeConfig } from './store.js';

export function baseEmbed({ color = COLORS.brand, footer = null } = {}) {
  return new EmbedBuilder().setColor(color).setFooter({ text: footerText(footer) });
}

function roleValue(config, tier) {
  const roleId = config?.roles?.[tier.id] ?? null;
  if (roleId) return tier.emoji + ' ' + tier.label + ' — <@&' + roleId + '>';
  return tier.emoji + ' ' + tier.label + ' — ' + EMOJI.missing + (tier.required ? ' **required**' : ' not set');
}

function channelValue(config, kind) {
  const channelId = config?.logs?.[kind.id] ?? null;
  if (channelId) return kind.emoji + ' ' + kind.label + ' — <#' + channelId + '>';
  return kind.emoji + ' ' + kind.label + ' — ' + EMOJI.missing + ' not set';
}

export function serverLine(server, snapshot = null) {
  if (!server) return EMOJI.missing + ' not configured';
  const state = snapshot ? (snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline') : null;
  const emoji = state ? STATUS[state].emoji + ' ' : '';
  const head = emoji + '**' + server.name + '**\n' + server.host + ':' + server.port;

  if (!snapshot) return head;
  if (!snapshot.connected) return head + '\n' + (snapshot.error ? 'last error: ' + truncate(snapshot.error, 120) : 'no connection');

  const info = snapshot.info;
  const counts = info ? info.players + '/' + info.max + ' online' : 'no serverinfo yet';
  const latency = snapshot.latencyMs === null ? '' : ' • ' + snapshot.latencyMs + 'ms';
  return head + '\n' + counts + ' • password ' + maskPassword(server.password) + latency;
}

export function panelEmbed({ guild, config }) {
  const status = describeConfig(config);
  const servers = config?.servers ?? [];

  const embed = baseEmbed({ footer: 'Only the server owner can change this' })
    .setTitle('🎧 ' + BRAND.name + ' setup')
    .setDescription(
      'Configure the staff roles, the log channels and up to ' +
        MAX_SERVERS +
        ' Rust servers.\nUse the buttons below, then hit **Done** when everything is filled in.',
    );

  embed.addFields({
    name: EMOJI.roles + ' Staff roles (' + TIERS.filter((tier) => config?.roles?.[tier.id]).length + '/' + TIERS.length + ')',
    value: TIERS.map((tier) => roleValue(config, tier)).join('\n'),
    inline: false,
  });

  embed.addFields({
    name: EMOJI.logs + ' Log channels (' + LOG_KINDS.filter((kind) => config?.logs?.[kind.id]).length + '/' + LOG_KINDS.length + ')',
    value: LOG_KINDS.map((kind) => channelValue(config, kind)).join('\n'),
    inline: false,
  });

  embed.addFields({
    name: EMOJI.servers + ' Servers (' + status.servers + '/' + MAX_SERVERS + ')',
    value: servers
      .map((server, index) => '**Slot ' + (index + 1) + '** — ' + (server ? server.name + ' (' + server.host + ':' + server.port + ')' : EMOJI.missing + ' not configured'))
      .join('\n'),
    inline: false,
  });

  embed.addFields({
    name: status.ready ? EMOJI.ok + ' Ready' : '⚠️ Not finished',
    value: status.ready
      ? 'Roles, logs and at least one server are set. Staff commands now follow these roles.'
      : 'Still needed: ' +
        [config?.roles?.owner ? null : 'an ' + TIER_LABEL('owner'), status.servers > 0 ? null : 'at least one server']
          .filter(Boolean)
          .join(', '),
    inline: false,
  });

  if (guild) embed.setTimestamp(new Date());
  return embed;
}

function TIER_LABEL(id) {
  const tier = tierById(id);
  return tier ? tier.emoji + ' ' + tier.label : id;
}

export function rolesEmbed({ config }) {
  return baseEmbed({ footer: 'Pick a role below to change it' })
    .setTitle(EMOJI.roles + ' Staff roles')
    .setDescription(
      TIERS.map((tier) => {
        const line = roleValue(config, tier);
        return line + '\n-# ' + tier.description;
      }).join('\n'),
    );
}

export function logsEmbed({ config }) {
  return baseEmbed({ footer: 'Pick a channel below to change it' })
    .setTitle(EMOJI.logs + ' Log channels')
    .setDescription(LOG_KINDS.map((kind) => channelValue(config, kind) + '\n-# ' + kind.description).join('\n'));
}

export function serversEmbed({ config, snapshots = [] }) {
  const entries = (config?.servers ?? []).map((server, index) => {
    const snapshot = snapshots.find((entry) => entry.slot === index + 1) ?? null;
    return '**Slot ' + (index + 1) + '**\n' + serverLine(server, snapshot);
  });

  return baseEmbed({ footer: 'Pick a slot below to add or edit it' })
    .setTitle(EMOJI.servers + ' Servers')
    .setDescription(entries.join('\n\n') + '\n-# The RCON password is stored on the bot host and never shown in Discord.');
}

export function hintEmbed(title, description, color = COLORS.brand) {
  return baseEmbed({ color }).setTitle(title).setDescription(description);
}

export function playerLines(players, perField = 15, maxFields = 6) {
  if (!players || players.length === 0) return [{ name: 'Players', value: '_Nobody is online right now._', inline: false }];

  const fields = [];
  for (let i = 0; i < players.length && fields.length < maxFields; i += perField) {
    const slice = players.slice(i, i + perField);
    const lines = slice.map((player) => {
      const ping = player.ping === null ? '' : ' • ' + player.ping + 'ms';
      const time = player.seconds === null ? '' : ' • ' + duration(player.seconds);
      return '• **' + player.name + '**' + ping + time;
    });

    const more = players.length - (i + slice.length);
    if (more > 0 && fields.length === maxFields - 1) lines.push('_…and ' + plural(more, 'more player') + '_');

    fields.push({
      name: i === 0 ? 'Players (' + players.length + ')' : 'Players ' + (i + 1) + '–' + (i + slice.length),
      value: truncate(lines.join('\n'), 1000),
      inline: false,
    });
  }

  return fields;
}

export function popServerEmbed(snapshot, { showPlayers = true } = {}) {
  const state = snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline';
  const status = STATUS[state];
  const info = snapshot.info;

  const title = info
    ? status.emoji + ' ' + snapshot.name + ' — ' + info.players + '/' + info.max + ' online'
    : status.emoji + ' ' + snapshot.name + ' — ' + status.label;

  const embed = baseEmbed({
    color: status.color,
    footer: 'RCON ' + (snapshot.latencyMs === null ? '—' : snapshot.latencyMs + 'ms') + ' • updated ' + clock(snapshot.at),
  }).setTitle(truncate(title, 250));

  if (!snapshot.connected) {
    embed.setDescription(
      snapshot.error
        ? 'The bot cannot reach this server right now.\n' + truncate(snapshot.error, 200)
        : 'The bot cannot reach this server right now.',
    );
    return embed;
  }

  if (!info) {
    embed.setDescription('Connected, but the server has not answered \`serverinfo\` yet.');
    return embed;
  }

  embed.addFields(
    { name: 'Population', value: bar(info.players, info.max) + ' **' + info.players + '/' + info.max + '**', inline: false },
    { name: EMOJI.queue + ' Queue', value: info.queued + ' queued • ' + info.joining + ' joining', inline: true },
    { name: EMOJI.uptime + ' Uptime', value: duration(info.uptime), inline: true },
  );

  if (showPlayers) embed.addFields(...playerLines(snapshot.players));
  return embed;
}

export function popSummaryEmbed({ totalPlayers, totalMax, onlineServers, totalServers }) {
  return baseEmbed({ footer: 'Across every server you configured' })
    .setTitle('📊 ' + BRAND.name + ' population')
    .setDescription(
      '**' +
        totalPlayers +
        '/' +
        totalMax +
        '** players online across ' +
        onlineServers +
        ' of ' +
        totalServers +
        ' servers.\n' +
        bar(totalPlayers, totalMax, 18),
    );
}

export function popSetupHintEmbed() {
  return baseEmbed({ color: COLORS.warning })
    .setTitle('⚠️ No servers configured yet')
    .setDescription('An owner needs to run **/setup** and fill in at least one Rust server before I can report population.');
}

export function joinLeaveEmbed({ type, player, server, online, max, sessionSeconds, massChange, joinedCount, leftCount }) {
  const joined = type === 'join';

  if (massChange) {
    return baseEmbed({ color: COLORS.warning, footer: server.name })
      .setTitle('🔄 Big roster change on ' + server.name)
      .setDescription(
        joinedCount +
          ' joined and ' +
          leftCount +
          ' left between two polls (a restart, or a very busy minute). Individual lines were skipped to avoid spam.',
      );
  }

  const embed = baseEmbed({
    color: joined ? COLORS.success : COLORS.warning,
    footer: server.name + ' • ' + (max === null ? '' : online + '/' + max + ' online'),
  }).setTitle((joined ? '➕ ' : '➖ ') + player.name);

  embed.addFields({
    name: joined ? 'Joined' : 'Left',
    value: joined
      ? 'A new player connected to **' + server.name + '**.'
      : 'Session length: ' + duration(sessionSeconds ?? player.seconds),
    inline: false,
  });

  if (player.id && !player.id.startsWith('name:')) embed.addFields({ name: 'Steam ID', value: '\`' + player.id + '\`', inline: false });
  return embed;
}

export function commandLogEmbed({ user, tier, command, options = [], ok = true, ms = null, error = null, guild, channel }) {
  const tierInfo = tier ? tierById(tier) : null;
  const actor = (tierInfo ? tierInfo.emoji + ' ' : '👤 ') + '<@' + user.id + '>';

  const embed = baseEmbed({
    color: ok ? COLORS.brand : COLORS.danger,
    footer: guild ? guild.name : null,
  })
    .setTitle((ok ? '⌨️ /' : '⛔ /') + command)
    .setDescription(actor + (channel ? ' in <#' + channel.id + '>' : ''));

  embed.addFields(
    { name: 'Who', value: '<@' + user.id + '> (' + user.username + ')', inline: true },
    { name: 'Access', value: tierInfo ? tierInfo.emoji + ' ' + tierInfo.label : 'Server owner', inline: true },
    { name: 'Took', value: ms === null ? '—' : ms + 'ms', inline: true },
  );

  if (options.length > 0) {
    embed.addFields({ name: 'Options', value: truncate(options.map((option) => '**' + option.name + ':** ' + option.value).join('\n'), 500), inline: false });
  }

  if (error) embed.addFields({ name: 'Error', value: truncate(error, 500), inline: false });
  return embed;
}

export function errorLogEmbed({ source, message, context = null, stack = null }) {
  const embed = baseEmbed({ color: COLORS.danger, footer: source })
    .setTitle('🚨 Error')
    .setDescription(truncate(message ?? 'Unknown error', 1000))
    .setTimestamp(new Date());

  if (context) embed.addFields({ name: 'Where', value: truncate(context, 500), inline: false });
  if (stack) embed.addFields({ name: 'Trace', value: truncate(stack, 900), inline: false });
  return embed;
}

export function statusLogEmbed({ title, description, color = COLORS.brand }) {
  return baseEmbed({ color }).setTitle(title).setDescription(truncate(description, 1500)).setTimestamp(new Date());
}

/** Used by the command invokers when a command throws. */
export function errorEmbed(error) {
  const message = error && error.message ? error.message : String(error);
  return baseEmbed({ color: COLORS.danger })
    .setTitle('💥 That did not work')
    .setDescription(truncate(message, 400))
    .setFooter({ text: 'The full error was written to the error log channel' });
}
