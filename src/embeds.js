import { EmbedBuilder } from 'discord.js';
import { bar, clock, duration, maskPassword, plural, truncate } from './format.js';
import { BRAND, COLORS, EMOJI, LOG_KINDS, STATUS, TIERS, footerText, tierById } from './theme.js';
import { HISTORY_DAYS, MAX_SERVERS, bestFor, configuredServers, describeConfig, peakFor, topDays } from './store.js';

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

export function popServerEmbed(snapshot, { showPlayers = true, peak = null } = {}) {
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

  if (peak) embed.addFields({ name: 'Peak today', value: peak, inline: false });

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

/** "📈 Peak today: 63/100 at 18:42 UTC", or null when nothing is recorded yet. */
export function peakLine(config, slot, max = null) {
  const peak = peakFor(config, slot);
  if (!peak || !peak.peak) return null;

  const at = peak.at ? ' at ' + clock(peak.at) : '';
  const total = max ? '/' + max : '';
  return '**' + peak.peak + total + '**' + at;
}

/** The one-page answer to "why do I need +rcon.web 1?", with the exact start line. */
export function guideEmbed({ config }) {
  const server = config?.servers?.[0] ?? null;
  const port = server?.port ?? 28016;

  const lines = [
    '**1. Turn on RCON on the Rust server**',
    'Add this to the start line (server.cfg or your host panel) and restart the server:',
    '```',
    '+rcon.web 1 +rcon.ip 0.0.0.0 +rcon.port ' + port + ' +rcon.password "pick-a-long-password"',
    '```',
    '+rcon.web 1 is the important one - Rust only opens the websocket console when it is set.',
    'The port has to be reachable over TCP from wherever this bot runs.',
    '',
    '**2. Fill in the server**',
    '🖥️ Servers → pick a slot → **Add** → name, IP or host, RCON port, RCON password.',
    'The password has to match +rcon.password exactly. Press **Test** to check it right away.',
    '',
    '**3. Pick your staff roles**',
    '🎭 Roles → pick each role, or press 🪄 **Guess roles** and I will match the roles you',
    'already have (Owner, Admin, Mod...) by name.',
    '',
    '**4. Log channels (optional but nice)**',
    '📋 Logs → pick a channel per event, or press 📁 **Make channels** and I will build a',
    'category with all four for you.',
    '',
    'Then press ✅ **Done** for a checklist and try **/pop**.',
  ];

  return baseEmbed({ color: COLORS.brandSoft, footer: 'Rust PC/Steam dedicated servers only - Console Edition has no RCON' })
    .setTitle('📖 How to get ' + BRAND.name + ' working')
    .setDescription(truncate(lines.join('\n'), 3900));
}

function statusRow(snapshot) {
  const state = snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline';
  const info = snapshot.info;

  const detail = info
    ? info.players + '/' + info.max + ' online • ' + duration(info.uptime) + ' uptime'
    : snapshot.error
      ? truncate(snapshot.error, 90)
      : 'no answer yet';

  return STATUS[state].emoji + ' **' + (snapshot.name || 'Server ' + snapshot.slot) + '** — ' + detail;
}

/** Health of every configured server, for /status. */
export function statusEmbed({ snapshots, config, guild }) {
  if (!snapshots || snapshots.length === 0) {
    return baseEmbed({ color: COLORS.warning })
      .setTitle('⚠️ Nothing to watch yet')
      .setDescription('Run **/setup** and add a Rust server, then I have something to report.');
  }

  const online = snapshots.filter((snapshot) => snapshot.connected);
  const players = snapshots.reduce((sum, snapshot) => sum + (snapshot.info?.players ?? 0), 0);
  const max = snapshots.reduce((sum, snapshot) => sum + (snapshot.info?.max ?? 0), 0);

  const embed = baseEmbed({ footer: guild ? guild.name : null })
    .setTitle('📡 ' + BRAND.name + ' status')
    .setDescription(
      '**' +
        online.length +
        '/' +
        snapshots.length +
        '** servers reachable • **' +
        players +
        (max ? '/' + max : '') +
        '** players online\n' +
        (max ? bar(players, max, 16) : ''),
    );

  for (const snapshot of snapshots) {
    const peak = peakLine(config, snapshot.slot, snapshot.info?.max ?? null);
    embed.addFields({
      name: 'Server ' + snapshot.slot,
      value: truncate(statusRow(snapshot) + (peak ? '\n' + peak : ''), 300),
      inline: false,
    });
  }

  embed.setTimestamp(new Date());
  return embed;
}

/** Every command, grouped by who can use it. Prefix form first, slash as the alternative. */
export function helpEmbed({ prefix = '!', prefixEnabled = true, config = null }) {
  const quote = '`';
  const form = (name) => quote + (prefixEnabled ? prefix + name : '/' + name) + quote;
  const both = (name) => (prefixEnabled ? form(name) + ' or ' + quote + '/' + name + quote : form(name));

  const rows = [
    '**Everyone**',
    both('pop') + ' — who is online right now, with buttons to switch server, refresh and hide the list',
    both('status') + ' — is every server reachable, plus the peak of the day',
    both('board') + ' — the record book: the busiest days this server has seen',
    both('help') + ' — this message',
    '',
    '**🔨 Moderator and up**',
    both('players') + ' — the full player list with ping and session time',
    '',
    '**🔧 Admin and up**',
    both('say') + ' — broadcast to in-game chat',
    both('kick') + ' — kick a player',
    both('save') + ' — ask the server to save the world',
    '',
    '**⚔️ Head Admin and up**',
    both('ban') + ' — ban a player',
    '',
    '**🛡️ Co-Owner and up**',
    both('console') + ' — one raw RCON command',
    '',
    '**👑 Server owner**',
    quote + '/setup' + quote + ' — roles, log channels and up to three servers',
  ];

  const embed = baseEmbed({
    footer: describeConfig(config).ready ? 'Staff roles come from /setup' : 'Run /setup to finish setting me up',
  })
    .setTitle('🎧 ' + BRAND.name + ' commands')
    .setDescription(truncate(rows.join('\n'), 3900))
    .addFields({
      name: 'Did you know?',
      value:
        '• ' + BRAND.name + ' can watch up to three servers at once and adds their populations together.\n' +
        '• The activity line refreshes every poll with players, queue and uptime.\n' +
        '• ' + form('pop') + ' has buttons: switch server, refresh, hide the player list.',
      inline: false,
    });

  if (prefixEnabled) {
    embed.addFields({
      name: 'Prefer slash commands?',
      value: 'Every command above also exists as \`/pop\`, \`/status\`, \`/players\`, \`/say\`, \`/kick\`, \`/ban\` and \`/console\`.',
      inline: false,
    });
  }

  return embed;
}

/** The clan record book: best day, today and the busiest days per server. */
export function boardEmbed({ config, snapshots = [] }) {
  const servers = configuredServers(config);
  if (servers.length === 0) {
    return baseEmbed({ color: COLORS.warning })
      .setTitle('📈 No records yet')
      .setDescription('Run **/setup** and add a Rust server - from then on I keep the busiest moment of every day.');
  }

  const maxBySlot = new Map(snapshots.map((snapshot) => [snapshot.slot, snapshot.info?.max ?? null]));

  const embed = baseEmbed({ footer: 'One peak per UTC day · the last ' + HISTORY_DAYS + ' days' })
    .setTitle('📈 ' + BRAND.name + ' record book')
    .setDescription('The busiest moment of the day, measured on every poll.');

  for (const server of servers) {
    const max = maxBySlot.get(server.slot) ?? null;
    const total = max ? '/' + max : '';
    const best = bestFor(config, server.slot);
    const today = peakFor(config, server.slot);
    const top = topDays(config, server.slot, 5);

    const lines = [];
    lines.push(best && best.peak ? '👑 Best day: **' + best.peak + total + '**' + (best.day ? ' on ' + best.day : '') : '👑 Best day: nothing recorded yet');
    lines.push(today && today.peak ? '📅 Today: **' + today.peak + total + '**' + (today.at ? ' at ' + clock(today.at) : '') : '📅 Today: nobody has been on yet');
    if (top.length > 1) lines.push('🏆 Busiest: ' + top.map((day) => day.day.slice(5) + ' → **' + day.peak + '**').join(' · '));

    embed.addFields({
      name: String(server.slot) + '. ' + (server.name || server.host),
      value: truncate(lines.join('\n'), 1000),
      inline: false,
    });
  }

  return embed;
}

/** Posted in a new server when setup has not been done yet. */
export function welcomeEmbed({ prefix = '!', prefixEnabled = true }) {
  return baseEmbed({ color: COLORS.brandSoft, footer: 'One command is all I need to start' })
    .setTitle('🎧 Thanks for adding ' + BRAND.name + '!')
    .setDescription(
      'I watch your Rust servers over WebRCON and show the live population in my own status line, ' +
        'plus who is online, join/leave logs and role-gated staff commands.\n\n' +
        '**Next step:** the server owner runs **/setup**. It takes about a minute:\n' +
        '1. 🖥️ add a server (IP, RCON port, RCON password)\n' +
        '2. 🎭 pick staff roles — or press 🪄 **Guess roles**\n' +
        '3. 📋 pick log channels — or press 📁 **Make channels**\n\n' +
        'Then ' +
        (prefixEnabled ? '`' + prefix + 'pop`' : '`/pop`') +
        ' shows who is playing, and staff commands follow the roles you saved.',
    )
    .setTimestamp(new Date());
}
