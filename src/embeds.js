import { EmbedBuilder } from 'discord.js';
import { fleetVerdict, recentRestart, serverVerdict } from './health.js';
import { outageText } from './watch.js';
import { bar, clock, duration, maskPassword, percent, plural, relative, scrubSecrets, shortTime, sparkline, trendArrow, truncate } from './format.js';
import { history, slotKey } from './history.js';
import { BRAND, BRAND_LOGO, COLORS, EMOJI, LOG_KINDS, STATUS, TIERS, footerText, tierById } from './theme.js';
import { MAX_SERVERS, bestFor, describeConfig, peakFor } from './store.js';

export function baseEmbed({ color = COLORS.brand, logo = true } = {}) {
  const embed = new EmbedBuilder().setColor(color).setFooter({ text: footerText() });
  if (logo && BRAND_LOGO) embed.setThumbnail(BRAND_LOGO);
  return embed;
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

export function panelEmbed({ guild, config, snapshots = [] }) {
  const status = describeConfig(config);
  const servers = config?.servers ?? [];

  const embed = baseEmbed()
    .setTitle('🎧 ' + BRAND.name + ' setup')
    .setDescription(
      'Configure the staff roles, the log channels and up to ' +
        MAX_SERVERS +
        ' Rust servers.\nUse the buttons below, then hit **Done** when everything is filled in.\n\n' +
        '**🔒 Nothing here is public.** This panel, every answer and every test result are visible to ' +
        'you alone, RCON passwords are shown masked, and no password is ever written to a log channel ' +
        'or to the status line in my own activity.',
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

  const live = new Map((Array.isArray(snapshots) ? snapshots : []).filter(Boolean).map((snapshot) => [snapshot.slot, snapshot]));

  embed.addFields({
    name: EMOJI.servers + ' Servers (' + status.servers + '/' + MAX_SERVERS + ')',
    value: servers
      .map((server, index) => {
        if (!server) return '**Slot ' + (index + 1) + '** — ' + EMOJI.missing + ' not configured';
        const snapshot = live.get(index + 1);
        const state = snapshot ? (snapshot.connected ? (snapshot.info ? ' ' + STATUS.online.emoji + ' ' + snapshot.info.players + '/' + snapshot.info.max : ' ' + STATUS.resting.emoji + ' connecting') : ' ' + STATUS.offline.emoji + ' offline') : '';
        return '**Slot ' + (index + 1) + '** — ' + server.name + ' (' + server.host + ':' + server.port + ')' + state;
      })
      .join('\n'),
    inline: false,
  });

  const toDo = [];
  if (status.servers === 0) toDo.push('add a server (**Servers**)');
  if (!config?.roles?.owner) toDo.push('set the Owner Role (**Roles**)');
  if (LOG_KINDS.filter((kind) => config?.logs?.[kind.id]).length === 0) toDo.push('pick at least one channel (**Logs**)');

  embed.addFields({
    name: '🎯 Next step',
    value: toDo.length > 0 ? 'Still to do: ' + toDo.join(' · ') : 'Nothing left to fill in. Press **Test channels** to prove the logs work, then **Done**.',
    inline: false,
  });

  embed.addFields({
    name: status.ready ? EMOJI.ok + ' Ready' : '⚠️ Not finished',
    value: status.ready
      ? 'Roles, logs and at least one server are set — the status line, `!pop` and `/ping` are live.'
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
  return baseEmbed()
    .setTitle(EMOJI.roles + ' Staff roles')
    .setDescription(
      TIERS.map((tier) => {
        const line = roleValue(config, tier);
        return line + '\n-# ' + tier.description;
      }).join('\n') + '\n\n-# Pick a role below to change it.',
    );
}

export function logsEmbed({ config }) {
  return baseEmbed()
    .setTitle(EMOJI.logs + ' Log channels')
    .setDescription(
      LOG_KINDS.map((kind) => channelValue(config, kind) + '\n-# ' + kind.description).join('\n') +
        '\n\n-# Pick a channel below to change it.',
    );
}

export function serversEmbed({ config, snapshots = [] }) {
  const entries = (config?.servers ?? []).map((server, index) => {
    const snapshot = snapshots.find((entry) => entry.slot === index + 1) ?? null;
    return '**Slot ' + (index + 1) + '**\n' + serverLine(server, snapshot);
  });

  return baseEmbed()
    .setTitle(EMOJI.servers + ' Servers')
    .setDescription(
      entries.join('\n\n') +
        '\n\n-# Pick a slot below to add or edit it. The RCON password is stored on the bot host and never shown in Discord.',
    );
}

export function hintEmbed(title, description, color = COLORS.brand) {
  return baseEmbed({ color }).setTitle(title).setDescription(description);
}

/**
 * One embed field per chunk of the roster, so a full 200-player server still fits.
 * The first field says how many are online; the last one says how many were left out.
 */
export function playerLines(players = [], perField = 20, maxFields = 4, newcomers = null) {
  const list = Array.isArray(players) ? players : [];

  if (list.length === 0) {
    return [{ name: '👥 Players', value: 'Nobody is online right now.', inline: false }];
  }

  // Longest session first: that is who is actually playing, not who logged in a second ago.
  const roster = [...list].sort((a, b) => (Number(b?.seconds) || 0) - (Number(a?.seconds) || 0));
  const fresh = newcomers instanceof Set ? newcomers : null;

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
        const star = fresh && fresh.has(String(player?.id ?? '')) ? '✨ ' : '';
        const pingBadge = pingBadgeFor(player?.ping);
        return '• ' + star + '**' + who + '**' + time + (pingBadge ? ' · ' + pingBadge : '');
      })
      .join('\n');

    const last = index === chunks.length - 1;
    return {
      name: index === 0 ? '👥 Players — ' + list.length + ' online' : '👥 Players (' + (index + 1) + ')',
      value: last && remaining > 0 ? truncate(value, 950) + '\n*…and ' + plural(remaining, 'more player') + '*' : truncate(value, 1024),
      inline: false,
    };
  });
}

/** A latency dot: green under 80 ms, yellow under 150 ms, red above. */
function pingBadgeFor(ping) {
  const value = Number(ping);
  if (!Number.isFinite(value)) return '';
  const dot = value < 80 ? '🟢' : value < 150 ? '🟡' : '🔴';
  return dot + ' ' + Math.round(value) + ' ms';
}
/**
 * One server, in full: how full it is, which way it is moving, what it is running and who is on
 * it. `guildId` turns on the recent-history half (trend, shape, average, newcomers).
 */
/**
 * Adds the small "this message is alive" line to an embed. Kept apart from the layout so both
 * the summary and a single server embed can carry it without repeating the wording.
 */
export function withNote(embed, note) {
  if (!note) return embed;
  const current = embed.data?.description ?? null;
  return embed.setDescription(truncate(current ? current + '\n\n' + note : note, 4096));
}

function popServerEmbedBase(snapshot, { showPlayers = true, peak = null, guildId = null, compact = false } = {}) {
  const state = snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline';
  const status = STATUS[state];
  const info = snapshot.info;

  const title = info
    ? status.emoji + ' ' + snapshot.name + ' — ' + info.players + '/' + info.max + ' online'
    : status.emoji + ' ' + snapshot.name + ' — ' + status.label;

  const embed = baseEmbed({ color: status.color }).setTitle(truncate(title, 250));

  if (!snapshot.connected) {
    embed.setDescription(
      (snapshot.error
        ? 'The bot cannot reach this server right now.\n' + truncate(scrubSecrets(snapshot.error), 200)
        : 'The bot cannot reach this server right now.') + '\n-# It retries by itself every few seconds — /ping has the detail.',
    );
    return embed;
  }

  if (!info) {
    embed.setDescription('Connected, but the server has not answered \`serverinfo\` yet.\n-# The next reading is seconds away.');
    return embed;
  }

  const key = guildId ? slotKey(guildId, snapshot.slot) : null;
  const series = key ? history.series(key) : [];
  const values = series.map((sample) => sample.players);
  const delta = key ? history.delta(key) : null;
  const average = key ? history.average(key) : null;
  const busiest = key ? history.windowPeak(key) : null;
  const roster = key ? history.roster(key) : [];
  const newcomers = new Set(roster.filter((entry) => entry.isNew).map((entry) => entry.id));

  const latency = snapshot.latencyMs === null || snapshot.latencyMs === undefined ? '—' : snapshot.latencyMs + ' ms';
  const trend = delta === null ? '' : ' ' + trendArrow(delta);

  embed.addFields({
    name: '👥 Population',
    value: bar(info.players, info.max, 20) + ' **' + info.players + '/' + info.max + '** (' + percent(info.players, info.max) + ')' + trend,
    inline: false,
  });

  embed.addFields(
    { name: '⏳ Queue', value: info.queued + ' queued • ' + info.joining + ' joining', inline: true },
    { name: EMOJI.uptime + ' Uptime', value: duration(info.uptime), inline: true },
    { name: EMOJI.ping + ' RCON', value: latency + '\n-# read ' + relative(snapshot.at), inline: true },
  );

  const details = [];
  if (info.map) details.push({ name: EMOJI.map + ' Map', value: truncate(String(info.map), 90), inline: true });
  if (info.framerate !== null && info.framerate !== undefined) details.push({ name: EMOJI.framerate + ' FPS', value: String(info.framerate), inline: true });
  if (info.entityCount !== null && info.entityCount !== undefined) details.push({ name: '🧱 Entities', value: String(info.entityCount), inline: true });
  if (Number.isFinite(Number(info.memory))) details.push({ name: '💾 Memory', value: Math.round(Number(info.memory)) + ' MB', inline: true });
  if (!compact && details.length > 0) embed.addFields(...details);

  if (!compact && series.length >= 3) {
    const parts = [sparkline(values, { width: 24, min: 0 })];
    const notes = [];
    if (average !== null) notes.push('averaging ' + average);
    notes.push('last ' + series.length + ' readings');
    if (busiest) notes.push('busiest ' + busiest.players + ' at ' + shortTime(busiest.at));
    parts.push('**' + (values[values.length - 1] ?? 0) + ' now** · ' + notes.join(' · '));
    embed.addFields({ name: '📈 Trend', value: parts.join('\n'), inline: false });
  }

  // A restart is the one event that explains a vanished population, so it goes on the answer
  // itself, and it stops being mentioned once it is old news.
  const restart = recentRestart(snapshot);
  if (restart && !compact) {
    embed.addFields({
      name: '🔄 Restarted',
      value:
        '<t:' + Math.floor(restart.at.getTime() / 1000) + ':R>' +
        ' — it had been up ' + duration(restart.wasUpSeconds) +
        (restart.wiped ? '\n-# The save holds a fraction of the entities it did before, so this looks like a fresh map.' : ''),
      inline: false,
    });
  }

  const verdict = serverVerdict(snapshot);
  if (verdict.problems.length > 0 && !compact) {
    embed.setDescription(
      truncate(
        (embed.data.description ? embed.data.description + '\n\n' : '') +
          '🟠 Working hard — ' + verdict.problems.join(' · ') + '\n-# ' + verdict.hint,
        4096,
      ),
    );
  }

  if (peak && !compact) embed.addFields({ name: 'Peak today', value: peak, inline: false });
  if (showPlayers) embed.addFields(...playerLines(snapshot.players, 20, 4, newcomers));
  return embed;
}
/**
 * The multi-server answer: one headline number, one line per server (counts, bar, direction) and
 * the busiest moment of the day when the guild config knows it.
 */
export function popSummaryEmbedBase({
  totalPlayers,
  totalMax,
  onlineServers,
  totalServers,
  pollSeconds = null,
  servers = [],
  busiest = null,
} = {}) {
  const embed = baseEmbed()
    .setTitle(EMOJI.players + ' ' + BRAND.name + ' network')
    .setDescription(
      '**' +
        totalPlayers +
        '/' +
        totalMax +
        '** players online across ' +
        onlineServers +
        ' of ' +
        totalServers +
        ' servers (' +
        percent(totalPlayers, totalMax) +
        ')\n' +
        bar(totalPlayers, totalMax, 22) +
        (totalServers > onlineServers
          ? '\n' + STATUS.offline.emoji + ' ' + plural(totalServers - onlineServers, 'server') + ' not answering right now'
          : '') +
        (Number.isFinite(pollSeconds) ? '\n-# refreshed every ' + pollSeconds + 's' : ''),
    );

  const lines = (Array.isArray(servers) ? servers : [])
    .filter((server) => server && server.slot)
    .slice(0, 6)
    .map((server) => {
      const state = server.connected ? (server.restarting ? 'resting' : 'online') : 'offline';
      const detail =
        server.connected && server.max
          ? server.players +
            '/' +
            server.max +
            (Number.isFinite(server.delta) ? ' ' + trendArrow(server.delta) : '') +
            (server.queued ? ' ⏳' + server.queued : '')
          : STATUS[state].label.toLowerCase();

      const spark = server.spark ? '\n' + server.spark : '';
      return { name: STATUS[state].emoji + ' ' + truncate(server.name || 'Server ' + server.slot, 200), value: detail + spark, inline: true };
    });

  if (lines.length > 0) embed.addFields(...lines);

  if (busiest && Number.isFinite(Number(busiest.peak))) {
    embed.addFields({
      name: '🥇 Busiest today',
      value: '**' + busiest.name + '** peaked at ' + busiest.peak + (busiest.at ? ' ' + relative(busiest.at) : ''),
      inline: false,
    });
  }

  return embed;
}
/** A single server's answer. */
export function popServerEmbed(snapshot, options = {}) {
  return withNote(popServerEmbedBase(snapshot, options), options.note);
}

/** The all-servers answer. */
export function popSummaryEmbed(options = {}) {
  return withNote(popSummaryEmbedBase(options), options.note);
}
export function popSetupHintEmbed() {
  return baseEmbed({ color: COLORS.warning })
    .setTitle('⚠️ No servers configured yet')
    .setDescription('An owner needs to run **/setup** and fill in at least one Rust server before I can report population.');
}

export function joinLeaveEmbed({ type, player, server, online, max, sessionSeconds, massChange, joinedCount, leftCount }) {
  const joined = type === 'join';

  if (massChange) {
    return baseEmbed({ color: COLORS.warning })
      .setAuthor({ name: server.name })
      .setTitle('🔄 Big roster change')
      .setDescription(
        joinedCount +
          ' joined and ' +
          leftCount +
          ' left between two polls (a restart, or a very busy minute). Individual lines were skipped to avoid spam.',
      );
  }

  const counts = max === null ? '' : ' — ' + online + '/' + max + ' online';
  const embed = baseEmbed({ color: joined ? COLORS.success : COLORS.warning })
    .setAuthor({ name: server.name })
    .setTitle((joined ? '➕ ' : '➖ ') + player.name)
    .setDescription((joined ? 'New player on **' + server.name + '**' : 'Left **' + server.name + '**') + counts + '.');

  embed.addFields({
    name: joined ? '👋 Joined' : '👋 Left',
    value: joined
      ? 'Session started ' + clock(new Date()) + ' UTC.'
      : 'Session length: **' + duration(sessionSeconds ?? player.seconds) + '**',
    inline: false,
  });

  if (player.id && !player.id.startsWith('name:')) embed.addFields({ name: 'Steam ID', value: '\`' + player.id + '\`', inline: false });
  return embed;
}

export function commandLogEmbed({ user, tier, command, options = [], ok = true, ms = null, error = null, guild, channel }) {
  const tierInfo = tier ? tierById(tier) : null;
  const actor = (tierInfo ? tierInfo.emoji + ' ' : '👤 ') + '<@' + user.id + '>';

  const embed = baseEmbed({ color: ok ? COLORS.brand : COLORS.danger })
    .setTitle((ok ? '⌨️ /' : '⛔ /') + command)
    .setDescription(actor + (channel ? ' in <#' + channel.id + '>' : ''));

  embed.addFields(
    { name: 'Who', value: '<@' + user.id + '> (' + user.username + ')', inline: true },
    { name: 'Access', value: tierInfo ? tierInfo.emoji + ' ' + tierInfo.label : '👑 Server owner', inline: true },
    { name: 'Took', value: ms === null ? '—' : ms + 'ms', inline: true },
  );

  if (guild) embed.addFields({ name: 'Server', value: guild.name, inline: true });

  if (options.length > 0) {
    embed.addFields({ name: 'Options', value: truncate(options.map((option) => '**' + option.name + ':** ' + option.value).join('\n'), 500), inline: false });
  }

  if (error) embed.addFields({ name: 'Error', value: truncate(error, 500), inline: false });
  return embed;
}

export function errorLogEmbed({ source, message, context = null, stack = null }) {
  const safe = { source: scrubSecrets(source), message: scrubSecrets(message), context: scrubSecrets(context), stack: scrubSecrets(stack) };
  ({ source, message, context, stack } = safe);
  const embed = baseEmbed({ color: COLORS.danger })
    .setTitle('🚨 Error' + (source ? ' — ' + source : ''))
    .setDescription(truncate(message ?? 'Unknown error', 1000))
    .setTimestamp(new Date());

  if (source && source !== 'unknown') embed.addFields({ name: 'Source', value: truncate(String(source), 200), inline: false });
  if (context) embed.addFields({ name: 'Where', value: truncate(context, 500), inline: false });
  if (stack) embed.addFields({ name: 'Trace', value: truncate(stack, 900), inline: false });
  return embed;
}

export function statusLogEmbed({ title, description, color = COLORS.brand }) {
  return baseEmbed({ color }).setTitle(title).setDescription(truncate(description, 1500)).setTimestamp(new Date());
}

/** Used by the command invokers when a command throws. */
export function errorEmbed(error) {
  // Scrubbed before it is rendered: an RCON url carries the password in its path.
  const message = scrubSecrets(error && error.message ? error.message : String(error));
  return baseEmbed({ color: COLORS.danger })
    .setTitle('💥 That did not work')
    .setDescription(truncate(message, 400) + '\n\n-# The full error was written to the error log channel.');
}

/** "📈 Peak today: 63/100 at 18:42 UTC", or null when nothing is recorded yet. */
export function peakLine(config, slot, max = null) {
  const peak = peakFor(config, slot);
  const best = bestFor(config, slot);
  if ((!peak || !peak.peak) && !best) return null;

  const parts = [];
  if (peak && peak.peak) {
    parts.push('**' + peak.peak + (max ? '/' + max : '') + '**' + (peak.at ? ' at ' + shortTime(peak.at) : ''));
  }
  if (best && Number.isFinite(Number(best.peak)) && (!peak || best.peak > (peak.peak ?? -1))) {
    parts.push('best ' + best.peak + (best.day ? ' on ' + best.day : ''));
  }

  return parts.join(' · ');
}

/**
 * The /ping dashboard. Everyone who may run it is a clan owner and it is answered privately, so it
 * can talk about roles, channels and counters - but never about a password or an address.
 */
/**
 * The one message that says a server stopped answering, and the one that says it is back. It
 * carries no address and no password - hardly any use to a stranger, plenty to the clan.
 */
export function outageEmbed({ down = true, name = 'Server', seconds = 0, error = null, alertMinutes = 5 } = {}) {
  if (down) {
    const lines = [
      'The bot has had no answer for ' + outageText(seconds) + ' (it alerts after ' + alertMinutes + ' minutes).',
      error ? '\nLast error: `' + truncate(scrubSecrets(String(error)), 200) + '`' : null,
      '',
      'The usual causes, in the order worth checking:',
      '• the server is restarting, or the host is doing maintenance;',
      '• the RCON port is not reachable from outside (it must be open over **TCP** and must not be the game port);',
      '• the start line lost `+rcon.web 1`, or the port or password changed.',
      '',
      'Everything about the connection lives in `/setup` → Servers, where the **Test** button tells you which of those it is.',
    ].filter((line) => line !== null);

    return baseEmbed({ color: COLORS.danger })
      .setTitle('📴 ' + name + ' has not answered for ' + outageText(seconds))
      .setDescription(truncate(lines.join('\n'), 4096));
  }

  return baseEmbed({ color: COLORS.success })
    .setTitle('📡 ' + name + ' is answering again')
    .setDescription('It was unreachable for ' + outageText(seconds) + '.\n-# `/pop` shows who is on, `/ping` the reading.');
}

/**
 * The daily digest. Every line is a stored reading or an honest admission that there is not one,
 * and the wording never turns a missing day into a zero.
 */
export function digestEmbed({ digest = null, config = null, at = new Date() } = {}) {
  const day = digest?.yesterday ?? null;
  const embed = baseEmbed({ color: COLORS.brand });

  if (!digest || !digest.anyRecorded) {
    return embed
      .setTitle('📊 Nothing to report yet')
      .setDescription(
        'The bot writes one line per server per day - the busiest moment it saw - and it has not seen a full day yet.' +
          '\n-# This message keeps its place; once there is a day behind it, it will have numbers in it.',
      );
  }

  const title = digest.servers.length === 1 ? '📊 Yesterday on ' + digest.servers[0].name : '📊 Yesterday on every server';
  embed.setTitle(truncate(title, 250));

  const dayLabel = day ? '<t:' + Math.floor(new Date(day + 'T12:00:00.000Z').getTime() / 1000) + ':D>' : 'yesterday';
  const lines = [];
  if (digest.servers.length === 1) lines.push('The busiest moment the bot saw on ' + dayLabel + '.');
  else lines.push('The busiest moment of ' + dayLabel + ', per server.');
  embed.setDescription(lines.join('\n'));

  for (const server of digest.servers) {
    const parts = [];

    if (server.yesterday === null) {
      parts.push('**No reading** — the bot was not watching this server that day.');
    } else {
      const change =
        server.change === null
          ? 'no reading the day before'
          : server.change > 0
            ? '▲ +' + server.change + ' on the day before'
            : server.change < 0
              ? '▼ ' + server.change + ' on the day before'
              : 'the same as the day before';
      parts.push('**' + server.yesterday + '** players at the busiest moment — ' + change + '.');
    }

    if (server.week.average !== null) {
      const trend =
        server.trend === null
          ? ''
          : server.trend > 0
            ? ' · ▲ +' + server.trend + ' on the week before'
            : server.trend < 0
              ? ' · ▼ ' + server.trend + ' on the week before'
              : ' · level with the week before';
      parts.push('-# Averaging **' + server.week.average + '** over ' + server.week.days + ' recorded day(s)' + trend + '.');
    } else {
      parts.push('-# Not enough days recorded for an average yet (' + server.recordedDays + ' so far).');
    }

    if (server.allTime) {
      parts.push(
        '-# Best day so far: **' +
          server.allTime.peak +
          '** on <t:' +
          Math.floor(new Date(server.allTime.day + 'T12:00:00.000Z').getTime() / 1000) +
          ':D>' +
          (server.allTime.at ? ' around <t:' + Math.floor(new Date(server.allTime.at).getTime() / 1000) + ':t>' : '') +
          '.',
      );
    }

    embed.addFields({ name: server.slot + '. ' + server.name, value: truncate(parts.join('\n'), 1024), inline: false });
  }

  if (digest.combined !== null) {
    embed.addFields({ name: '🌍 Every server together', value: digest.combined + ' players across the servers that had a reading.', inline: false });
  }

  const notes = ['one line per server per day, from the readings the bot actually took'];
  if (config) notes.push('a day it did not watch is reported as missing, never as a zero');
  embed.addFields({ name: '🧾 How this is counted', value: notes.join(' · '), inline: false });

  return embed;
}

export function pingEmbed({
  gatewayMs = null,
  uptimeSeconds = null,
  snapshots = [],
  health = null,
  localUrl = null,
  version = BRAND.version,
  pollSeconds = null,
  memoryMb = null,
  stats = null,
  config = null,
  dms = null,
  prefix = '!',
  prefixEnabled = true,
  now = new Date(),
} = {}) {
  const parts = [];
  if (Number.isFinite(gatewayMs)) parts.push('**' + gatewayMs + ' ms** to Discord');
  parts.push('up **' + duration(uptimeSeconds) + '**');
  parts.push(BRAND.name + ' **' + version + '**');

  const roster = Array.isArray(snapshots) ? snapshots : [];
  const verdicts = roster.map((snapshot) => serverVerdict(snapshot, { now }));
  const fleet = fleetVerdict(verdicts);

  const embed = baseEmbed({ color: COLORS.brandSoft })
    .setTitle('🏓 Pong')
    .setDescription(
      parts.join(' • ') +
        '\n' +
        fleet.emoji +
        ' ' +
        fleet.label +
        '\n-# checked ' +
        relative(now),
    );
  const serverLines = roster.length
    ? roster.map((snapshot, index) => {
        const verdict = verdicts[index] ?? serverVerdict(snapshot, { now });
        const name = snapshot.name || 'Server ' + snapshot.slot;
        if (!snapshot.connected) {
          return (
            verdict.emoji +
            ' **' +
            name +
            '** — offline' +
            (snapshot.error ? ' (' + truncate(scrubSecrets(snapshot.error), 60) + ')' : '') +
            '\n-# last try ' + relative(snapshot.at)
          );
        }

        const pingText = snapshot.latencyMs === null || snapshot.latencyMs === undefined ? '—' : snapshot.latencyMs + ' ms';
        const info = snapshot.info;
        const counts = info
          ? ' • ' + info.players + '/' + info.max + (info.queued ? ' ⏳' + info.queued : '') + ' • up ' + duration(info.uptime)
          : ' • serverinfo did not answer';
        const resting = info?.restarting ? ' ' + STATUS.resting.emoji + ' restarting' : '';
        const strain = verdict.problems.length > 0 ? '\n-# 🟠 ' + verdict.problems.join(' · ') : '';
        return (
          verdict.emoji +
          ' **' +
          name +
          '** — ' +
          pingText +
          counts +
          resting +
          strain +
          '\n-# read ' +
          relative(snapshot.at)
        );
      })
    : ['No Rust servers yet — run **/setup** and add one.'];

  embed.addFields({ name: '📶 RCON', value: truncate(serverLines.join('\n'), 1024), inline: false });

  const runtime = [];
  if (Number.isFinite(pollSeconds)) runtime.push('polls every ' + pollSeconds + 's');
  if (Number.isFinite(memoryMb)) runtime.push(Math.round(memoryMb) + ' MB RAM');
  runtime.push('node ' + String(process?.version ?? '').replace(/^v/, ''));
  if (stats) {
    runtime.push(stats.polls + ' polls');
    runtime.push(stats.commands + ' commands');
    if (stats.dmForwarded || stats.dmAnswered) runtime.push(stats.dmForwarded + ' DMs passed on');
    if (stats.peaks) runtime.push(stats.peaks + ' new peaks');
    runtime.push(stats.errors ? '⚠️ ' + stats.errors + ' error(s)' : '✅ no errors');
  }
  if (runtime.length) embed.addFields({ name: '🧩 Runtime', value: runtime.join(' • '), inline: false });

  if (stats && stats.lastError) {
    embed.addFields({ name: '🩹 Last problem', value: truncate(scrubSecrets(stats.lastError), 400) + (stats.lastErrorAt ? '\n-# ' + relative(stats.lastErrorAt) : ''), inline: false });
  }

  if (config) {
    const status = describeConfig(config);
    const roles = TIERS.filter((tier) => config.roles?.[tier.id]).length;
    const channels = LOG_KINDS.filter((kind) => config.logs?.[kind.id]).length;
    embed.addFields({
      name: '⚙️ Configuration',
      value: [
        plural(status.servers, 'server') + ' configured' + (status.ready ? ' ' + EMOJI.ok + ' ready' : ' ⚠️ incomplete'),
        roles + '/' + TIERS.length + ' staff roles • ' + channels + '/' + LOG_KINDS.length + ' log channels',
        'prefix commands ' + (prefixEnabled ? 'on (\`' + prefix + 'pop\`)' : 'off'),
        'direct messages ' + (dms?.enabled ? 'on' : 'off'),
      ].join('\n'),
      inline: false,
    });
  }

  if (health) {
    const reported = versionFrom(health.body);
    const stale = reported && reported !== version ? ' ⚠️ serving **' + reported + '** — redeploy to match' : '';
    const line = health.ok
      ? '✅ **' + (health.status ?? 200) + ' OK** in ' + (health.ms ?? 0) + ' ms' + stale
      : '⚠️ ' + truncate(health.error ?? 'no answer', 120) + (health.ms === null ? '' : ' after ' + health.ms + ' ms');
    embed.addFields({ name: '🌐 Public URL', value: line + '\n' + truncate(health.url ?? '—', 200), inline: false });
  } else if (localUrl) {
    embed.addFields({
      name: '🌐 Health endpoint',
      value: 'Listening on \`' + localUrl + '\` — set **PUBLIC_URL** to the address your host proxies and I will call it back here.',
      inline: false,
    });
  }

  return embed;
}

/** The version a /health body reports, when it parses as JSON. */
export function versionFrom(body) {
  if (!body) return null;
  try {
    const parsed = JSON.parse(String(body));
    return parsed && typeof parsed.version === 'string' ? parsed.version : null;
  } catch {
    return null;
  }
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

  return baseEmbed({ color: COLORS.brandSoft })
    .setTitle('📖 How to get ' + BRAND.name + ' working')
    .setDescription(
      truncate(lines.join('\n'), 3600) +
        '\n\n-# Rust PC/Steam dedicated servers only — Console Edition has no RCON.',
    );
}

/** The automatic answer to anybody who DMs the bot. */
export function dmAutoReplyEmbed({ user = null, guilds = [], prefix = '!', forwarded = false, help = false, owner = false } = {}) {
  const who = user?.username ? '**' + user.username + '**' : 'there';

  const lines = [
    'Hi ' + who + ' - this is **' + BRAND.name + ' pop bot**. I watch the ' + BRAND.clan +
      ' Rust servers over WebRCON and report the live population, but I am a bot: I cannot answer questions myself.',
    '',
    owner
      ? '🧑‍✈️ **You are one of my owners**, so there is nobody for me to pass this to — I noted it in the staff channel, when one is set up. `/setup` configures me, `/ping` checks me, and this DM is the place to talk to me.'
      : forwarded
        ? '🙋 **Your message is on its way to the clan owners.** If it needs an answer, one of them will reply to you here.'
        : '🔒 I pass messages on for members of the servers I am in. If you play on the ' + BRAND.name +
          ' Rust servers, send it again from the Discord server so the owners can see who you are.',
    '',
    '**Out in the Discord server**',
    '• \`' + prefix + 'pop\` - who is on the Rust servers right now',
    '• \`/ping\` - the clan owners can check the bot and every server',
    '• \`/setup\` - the server owner configures servers, roles and logs',
  ];

  if (help) lines.push('', '-# Sounds like a question for staff - I have marked it as a help request.');

  return baseEmbed({ color: forwarded ? COLORS.brandSoft : COLORS.muted })
    .setTitle('👋 ' + BRAND.name + ' support')
    .setDescription(lines.join('\n'));
}

/** One DM, passed to the owners. */
export function dmForwardEmbed({ user = null, guilds = [], text = '', help = false, at = null, prefix = '!' } = {}) {
  const embed = baseEmbed({ color: help ? COLORS.warning : COLORS.brandSoft })
    .setTitle((help ? '🙋 Help request from ' : '✉️ New DM from ') + (user?.username ?? 'someone'))
    .setDescription(truncate(text || '*(no text)*', 2000));

  embed.addFields(
    { name: '👤 User', value: truncate(user?.username ?? 'unknown', 90), inline: true },
    { name: '🆔 User ID', value: '\`' + (user?.id ?? 'unknown') + '\`', inline: true },
    { name: '🕒 Received', value: (at ? clock(at) : clock(new Date())) + ' UTC', inline: true },
  );

  embed.addFields({
    name: '🏠 Shared servers',
    value: guilds.length > 0 ? truncate(guilds.map((guild) => guild.name).join(', '), 300) : 'Not in any server I am in.',
    inline: false,
  });

  embed.addFields({
    name: '↩️ Answer them',
    value: 'Write \`' + prefix + 'reply ' + (user?.id ?? '<user id>') + ' your answer\` here and I will DM it to them.',
    inline: false,
  });

  return embed;
}

/** An owner answer, delivered to the member who asked. */
export function dmRelayEmbed({ from = null, text = '' } = {}) {
  return baseEmbed({ color: COLORS.success })
    .setTitle('💬 Answer from ' + BRAND.name + ' staff')
    .setDescription(truncate(text || '*(empty)*', 2000))
    .addFields({ name: 'From', value: truncate(from?.username ?? 'the owners', 90), inline: true });
}

/** The small guide an owner sees while relaying, or when a relay cannot happen. */
export function dmRelayUsageEmbed(prefix = '!', notice = null) {
  const embed = baseEmbed({ color: notice ? COLORS.warning : COLORS.brandSoft })
    .setTitle('↩️ Relay an answer')
    .setDescription(
      'Write \`' + prefix + 'reply <user id> <your answer>\` here and I will DM it to that member.\n' +
        'Only the Spinback owners can do this, and only to somebody who has written to me in the last 24 hours.',
    );

  if (notice) embed.addFields({ name: 'Heads up', value: truncate(notice, 300), inline: false });
  return embed;
}

export function welcomeEmbed({ prefix = '!', prefixEnabled = true }) {
  return baseEmbed({ color: COLORS.brandSoft })
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
