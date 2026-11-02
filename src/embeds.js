import { EmbedBuilder } from 'discord.js';
import { bar, clock, duration, maskPassword, plural, truncate } from './format.js';
import { BRAND, COLORS, EMOJI, LOG_KINDS, STATUS, TIERS, footerText, tierById } from './theme.js';
import { MAX_SERVERS, describeConfig, peakFor } from './store.js';

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

/**
 * One embed field per chunk of the roster, so a full 200-player server still fits.
 * The first field says how many are online; the last one says how many were left out.
 */
export function playerLines(players = [], perField = 20, maxFields = 4) {
  const roster = Array.isArray(players) ? players : [];

  if (roster.length === 0) {
    return [{ name: '👥 Players', value: 'Nobody is online right now.', inline: false }];
  }

  const chunks = [];
  for (let index = 0; index < roster.length && chunks.length < maxFields; index += perField) {
    chunks.push(roster.slice(index, index + perField));
  }

  const shown = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const remaining = roster.length - shown;

  return chunks.map((chunk, index) => {
    const value = chunk
      .map((player) => {
        const who = player?.name || player?.id || 'unknown';
        const time = player?.seconds === null || player?.seconds === undefined ? '' : ' — ' + duration(player.seconds);
        return '• **' + who + '**' + time;
      })
      .join('\n');

    const last = index === chunks.length - 1;
    return {
      name: index === 0 ? '👥 Players — ' + roster.length + ' online' : '👥 Players (' + (index + 1) + ')',
      value: last && remaining > 0 ? truncate(value, 950) + '\n*…and ' + plural(remaining, 'more player') + '*' : truncate(value, 1024),
      inline: false,
    };
  });
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
/**
 * The /ping report: the bot's own health first, then the RCON round-trip per server, then
 * whatever the public URL answered. Everyone who may run it is a clan owner, so no secrets.
 */
export function pingEmbed({ gatewayMs = null, uptimeSeconds = null, snapshots = [], health = null, localUrl = null, version = BRAND.version } = {}) {
  const embed = baseEmbed({ color: COLORS.brandSoft, footer: 'Owner and Co-Owner only' })
    .setTitle('🏓 Pong')
    .setDescription(
      '**Discord gateway** ' +
        (Number.isFinite(gatewayMs) ? gatewayMs + ' ms' : '—') +
        '\n**Bot uptime** ' +
        duration(uptimeSeconds) +
        '\n**Build** ' +
        BRAND.name +
        ' ' +
        version +
        ' on node ' +
        String(process?.version ?? '').replace(/^v/, ''),
    )
    .setTimestamp(new Date());

  const roster = Array.isArray(snapshots) ? snapshots : [];
  const serverLines = roster.length
    ? roster.map((snapshot) => {
        const name = snapshot.name || 'Server ' + snapshot.slot;
        if (!snapshot.connected) {
          return STATUS.offline.emoji + ' **' + name + '** — offline' + (snapshot.error ? ' (' + truncate(snapshot.error, 60) + ')' : '');
        }
        const pingText = snapshot.latencyMs === null || snapshot.latencyMs === undefined ? '—' : snapshot.latencyMs + ' ms';
        const info = snapshot.info;
        const players = info ? ' • ' + info.players + '/' + info.max + (info.queued ? ' ⏳' + info.queued : '') : ' • serverinfo did not answer';
        return STATUS.online.emoji + ' **' + name + '** — ' + pingText + players;
      })
    : ['No Rust servers yet — run **/setup** and add one.'];

  embed.addFields({ name: '📶 RCON', value: truncate(serverLines.join('\n'), 1024), inline: false });

  if (health) {
    const line = health.ok
      ? '✅ **' + (health.status ?? 200) + ' OK** in ' + (health.ms ?? 0) + ' ms'
      : '⚠️ ' + truncate(health.error ?? 'no answer', 120) + (health.ms === null ? '' : ' after ' + health.ms + ' ms');
    embed.addFields({ name: '🌐 Public URL', value: line + '\n' + truncate(health.url ?? '—', 200), inline: false });
  } else if (localUrl) {
    embed.addFields({
      name: '🌐 Health endpoint',
      value: 'Listening on `' + localUrl + '` — set **PUBLIC_URL** to the address your host proxies and I will call it back here.',
      inline: false,
    });
  }

  return embed;
}

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
    'Then press ✅ **Done** for a checklist and try **!pop**.',
  ];

  return baseEmbed({ color: COLORS.brandSoft, footer: 'Rust PC/Steam dedicated servers only - Console Edition has no RCON' })
    .setTitle('📖 How to get ' + BRAND.name + ' working')
    .setDescription(truncate(lines.join('\n'), 3900));
}

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
