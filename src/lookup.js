import { baseEmbed, playerLines } from './embeds.js';
import { COLORS, EMOJI, STATUS, tierById } from './theme.js';
import { bar, duration, percent, plural, shortTime, sparkline, trendArrow, truncate } from './format.js';
import { bestFor, configuredServers, historyFor, peakFor, topDays } from './store.js';
import { history, slotKey } from './history.js';
import { recentRestart, serverVerdict } from './health.js';

/**
 * /lookup - everything the bot knows, in one answer.
 *
 * Three answers in one command: the server dossier (the default), one player (with a name), and
 * for staff only how the bot itself is set up. The last embed is the honest one: what the bot does
 * *not* know belongs in a lookup as much as what it does, so it is written down rather than implied.
 */

/** Exact name first, then a partial match. Returns every candidate so the caller can say so. */
export function findPlayer(snapshots = [], query = null) {
  const wanted = String(query ?? '').trim().toLowerCase();
  if (!wanted) return { player: null, snapshot: null, matches: [] };

  const all = [];
  for (const snapshot of snapshots) {
    for (const player of snapshot?.players ?? []) all.push({ player, snapshot });
  }

  const exact = all.filter((entry) => String(entry.player?.name ?? '').toLowerCase() === wanted);
  if (exact.length > 0) return { ...exact[0], matches: exact };

  const partial = all.filter((entry) => String(entry.player?.name ?? '').toLowerCase().includes(wanted));
  if (partial.length > 0) return { ...partial[0], matches: partial };

  return { player: null, snapshot: null, matches: [] };
}

/** The status a snapshot deserves right now. */
function stateOf(snapshot) {
  if (!snapshot?.connected) return STATUS.offline;
  if (snapshot.info?.restarting) return STATUS.resting;
  return STATUS.online;
}

function readingLine(snapshot, at) {
  const when = snapshot?.at ? new Date(snapshot.at) : at;
  const seconds = Math.max(0, Math.round((at.getTime() - when.getTime()) / 1000));
  const parts = ['reading <t:' + Math.floor(when.getTime() / 1000) + ':R>'];
  if (seconds > 300) parts.push('that reading is ' + duration(seconds) + ' old');
  return '-# ' + parts.join(' · ');
}

/** The record book half: today, the best day, and how many days are behind it. */
function recordField(config, slot, at) {
  const today = peakFor(config, slot, at);
  const best = bestFor(config, slot);
  const recorded = historyFor(config, slot).filter((day) => Number.isFinite(Number(day?.peak)));

  if (recorded.length === 0 && !best) return { name: EMOJI.trophy + ' Record book', value: 'Nothing recorded yet - the first reading becomes day one.', inline: false };

  const lines = [];
  lines.push('Today: ' + (today && today.peak ? '**' + today.peak + '** at ' + shortTime(today.at) : 'no reading yet'));
  if (best && Number.isFinite(Number(best.peak))) lines.push('Best day so far: **' + best.peak + '** on ' + best.day);

  const busiest = topDays(config, slot, 3).filter((day) => Number(day?.peak) > 0);
  if (busiest.length > 1) lines.push('Busiest days: ' + busiest.map((day) => '**' + day.peak + '** on ' + day.day).join(' · '));

  const average = Math.round(recorded.reduce((sum, day) => sum + Number(day.peak || 0), 0) / recorded.length);
  lines.push('-# ' + plural(recorded.length, 'day') + ' recorded · averaging ' + average + ' at the busiest moment');

  return { name: EMOJI.trophy + ' Record book', value: truncate(lines.join('\n'), 1024), inline: false };
}

/** Everything about one server: the live reading, the shape, the record book and who is on. */
function serverEmbed({ snapshot, config, guildId, at }) {
  const status = stateOf(snapshot);
  const info = snapshot?.info ?? null;
  const key = guildId ? slotKey(guildId, snapshot.slot) : null;
  const series = key ? history.series(key) : [];
  const values = series.map((sample) => sample.players);
  const delta = key ? history.delta(key) : null;
  const average = key ? history.average(key) : null;
  const busiest = key ? history.windowPeak(key) : null;
  const roster = key ? history.roster(key) : [];
  const newcomers = new Set(roster.filter((entry) => entry.isNew).map((entry) => entry.id));
  const verdict = serverVerdict(snapshot);
  const restart = recentRestart(snapshot);

  const title = info
    ? EMOJI.lookup + ' ' + snapshot.name + ' - ' + info.players + '/' + info.max + ' online'
    : EMOJI.lookup + ' ' + snapshot?.name + ' - ' + status.label;
  const embed = baseEmbed({ color: status.color }).setTitle(truncate(title, 250));

  const notes = [];
  if (verdict.problems.length > 0) notes.push('🟠 ' + verdict.problems.join(' · '));
  if (restart) notes.push('🔄 restarted <t:' + Math.floor(restart.at.getTime() / 1000) + ':R>' + (restart.wiped ? ' - and it looks like a fresh map' : ''));
  notes.push(readingLine(snapshot, at));
  notes.push('-# The RCON address and password never leave the bot host.');
  embed.setDescription(notes.join('\n'));

  if (!info) return embed;

  embed.addFields({
    name: EMOJI.players + ' Population',
    value: bar(info.players, info.max, 22) + ' **' + info.players + '/' + info.max + '** (' + percent(info.players, info.max) + ')' + (delta === null ? '' : ' ' + trendArrow(delta)),
    inline: false,
  });

  const facts = [];
  if (info.queued > 0 || info.joining > 0) facts.push(EMOJI.queue + ' ' + info.queued + ' queued · ' + info.joining + ' joining');
  facts.push(EMOJI.uptime + ' up ' + duration(info.uptime));
  facts.push(EMOJI.ping + ' ' + (snapshot.latencyMs === null || snapshot.latencyMs === undefined ? '—' : snapshot.latencyMs + ' ms'));
  facts.push('🖥️ slot ' + snapshot.slot);
  embed.addFields({ name: 'Right now', value: facts.join(' · '), inline: false });

  const running = [];
  if (info.map) running.push(EMOJI.map + ' ' + truncate(String(info.map), 60));
  if (info.framerate !== null && info.framerate !== undefined) running.push(EMOJI.framerate + ' ' + info.framerate + ' fps');
  if (info.entityCount !== null && info.entityCount !== undefined) running.push('🧱 ' + info.entityCount + ' entities');
  if (Number.isFinite(Number(info.memory))) {
    const mb = Math.round(Number(info.memory));
    running.push('💾 ' + (mb >= 1024 ? (mb / 1024).toFixed(1) + ' GB' : mb + ' MB'));
  }
  if (running.length > 0) embed.addFields({ name: 'The server', value: running.join('\n'), inline: false });

  if (series.length >= 3) {
    const shape = [];
    if (average !== null) shape.push('averaging ' + average);
    if (busiest) shape.push('busiest ' + busiest.players + (busiest.at ? ' at ' + shortTime(busiest.at) : ''));
    embed.addFields({
      name: EMOJI.trend + ' Trend',
      value: sparkline(values, { width: 26, min: 0 }) + '\n**' + info.players + ' now** · ' + shape.join(' · ') + ' · ' + series.length + ' readings',
      inline: false,
    });
  }

  embed.addFields(recordField(config, snapshot.slot, at));

  const rosterFields = playerLines(snapshot.players ?? [], 18, 2, newcomers);
  if (rosterFields.length > 0) {
    rosterFields[0] = { ...rosterFields[0], name: EMOJI.players + ' On right now — ' + (snapshot.players ?? []).length };
    embed.addFields(...rosterFields);
  }

  return embed;
}

/** What the bot does not know, written down rather than implied. */
function honestyEmbed(config) {
  const servers = configuredServers(config);
  const days = servers.reduce((most, server) => {
    const recorded = historyFor(config, server.slot).filter((day) => Number.isFinite(Number(day?.peak))).length;
    return Math.max(most, recorded);
  }, 0);

  return baseEmbed({ color: COLORS.brand })
    .setTitle(EMOJI.receipt + ' What this bot knows')
    .setDescription(
      [
        '**Live, from the server:** players, queue, map, FPS, entities, memory and who is on - read straight from the Rust console.',
        '**Remembered, one line per day:** the busiest moment of each day, for ' + plural(servers.length, 'server') + ' - currently ' + plural(days, 'day') + ' of readings.',
        '**Short-term:** 3 days of fine-grained samples behind the trend line. Enough for a shape, not a history.',
      ].join('\n\n'),
    )
    .addFields({
      name: 'What it deliberately does not do',
      value: [
        '• No playtime and no last-seen: it only knows who is on right now.',
        '• No in-game actions at all - no kick, ban, save, say or console.',
        '• No server address in Discord, and no RCON password anywhere but the bot host.',
      ].join('\n'),
      inline: false,
    });
}

/** Staff only: how the bot itself is set up for this server. */
function setupEmbed({ config, snapshots, pollSeconds, staffTier = null }) {
  const tier = staffTier ? tierById(staffTier) : null;
  const servers = configuredServers(config);
  const channels = [
    ['📌 Live board', config.board?.enabled ? config.board.channelId : null],
    ['📊 Daily digest', config.digest?.enabled ? config.digest.channelId : null],
    ['📡 Server status', config.logs?.status],
    ['🚨 Errors', config.logs?.errors],
    ['⌨️ Commands', config.logs?.commands],
    ['🚪 Join & leave', config.logs?.joinLeave],
    ['💬 In-game chat', config.logs?.chat],
  ];
  const roles = Object.entries(config.roles ?? {}).filter(([, value]) => Boolean(value));
  const alerts = config.alerts ?? {};

  return baseEmbed({ color: COLORS.brand })
    .setTitle('🎛️ How this bot is set up here')
    .setDescription('-# ' + (tier ? tier.emoji + ' ' + tier.label + ' sees this part. ' : '') + 'Changed with /setup.' + (config.updatedAt ? ' Last changed <t:' + Math.floor(new Date(config.updatedAt).getTime() / 1000) + ':R>.' : ''))
    .addFields(
      {
        name: 'Servers watched',
        value: servers.length ? servers.map((server) => '**Slot ' + server.slot + '** · ' + server.name).join('\n') : 'None yet - /setup adds up to three.',
        inline: true,
      },
      {
        name: 'Staff roles',
        value: roles.length ? roles.map(([id, roleId]) => (tierById(id)?.emoji ?? '•') + ' <@&' + roleId + '>').join('\n') : 'None yet.',
        inline: true,
      },
      {
        name: 'Channels',
        value: channels.map(([label, id]) => label + ': ' + (id ? '<#' + id + '>' : 'not set')).join('\n'),
        inline: false,
      },
      {
        name: 'Watching for',
        value: [
          (alerts.enabled === false ? '🔕 Alerts off' : '🔔 Alerts on') + (alerts.milestones === false ? ' · milestones off' : ' · milestones on') + (alerts.outage === false ? ' · outages off' : ' · outages on'),
          'Polling every ' + (pollSeconds ?? '-') + 's · ' + plural((snapshots ?? []).length, 'server') + ' in this answer',
        ].join('\n'),
        inline: false,
      },
    );
}

/** One player, by name. */
function playerEmbed({ snapshots, query, at }) {
  const found = findPlayer(snapshots, query);

  if (!found.player) {
    const onNow = snapshots.flatMap((snapshot) => (snapshot?.players ?? []).map((player) => ({ player, snapshot })));
    const list = onNow.slice(0, 18).map((entry) => '• **' + (entry.player.name ?? 'unknown') + '** on ' + entry.snapshot.name).join('\n');

    return baseEmbed({ color: COLORS.warning })
      .setTitle(EMOJI.search + ' No one called "' + truncate(String(query), 40) + '" is on right now')
      .setDescription(
        (list ? 'On right now:\n' + list : 'Nobody is on any server right now.') +
          '\n\n-# The bot only knows who is on right now - there is no playtime or last-seen history to search.',
      );
  }

  const { player, snapshot, matches } = found;
  const roster = snapshot.players ?? [];
  const position = roster.filter((entry) => (Number(entry.seconds) || 0) > (Number(player.seconds) || 0)).length + 1;
  const ping = Number(player.ping);
  const dot = !Number.isFinite(ping) ? '➖' : ping < 80 ? '🟢' : ping < 150 ? '🟡' : '🔴';

  const embed = baseEmbed({ color: COLORS.brand })
    .setTitle(EMOJI.search + ' ' + (player.name ?? 'unknown'))
    .setDescription(
      'On **' + snapshot.name + '** right now' +
        (player.seconds === null || player.seconds === undefined ? '' : ', for ' + duration(player.seconds)) +
        '.\n-# Live from the Rust console <t:' + Math.floor(at.getTime() / 1000) + ':R>.',
    )
    .addFields(
      { name: 'On now', value: '**' + roster.length + '** of ' + (snapshot.info?.max ?? '?') + ' players', inline: true },
      { name: 'Session', value: player.seconds === null || player.seconds === undefined ? '—' : duration(player.seconds), inline: true },
      { name: 'Connection', value: dot + ' ' + (Number.isFinite(ping) ? ping + ' ms' : 'not reported'), inline: true },
      { name: 'Longest on', value: '#' + position + ' of ' + roster.length + ' right now', inline: true },
    );

  if (matches.length > 1) {
    embed.addFields({
      name: 'Also matched',
      value: matches.slice(1, 6).map((entry) => '• **' + entry.player.name + '** on ' + entry.snapshot.name).join('\n'),
      inline: false,
    });
  }

  embed.addFields({ name: EMOJI.receipt + ' Honest limit', value: 'The bot knows who is on right now and nothing else about a player: no playtime, no last-seen, nothing stored.', inline: false });
  return embed;
}

/**
 * The whole answer. A `query` looks one player up; otherwise every configured server gets its own
 * dossier, and staff also get the setup summary.
 */
export function lookupPayload({ snapshots = [], config = null, guild = null, focus = null, query = null, staffTier = null, pollSeconds = null, at = new Date() } = {}) {
  const guildId = guild?.id ?? config?.guildId ?? null;
  if (query) return { embeds: [playerEmbed({ snapshots, query, at })], components: [] };

  const wanted = focus ? snapshots.filter((snapshot) => snapshot.slot === focus) : snapshots;
  const shown = (wanted.length > 0 ? wanted : snapshots).slice(0, 3);

  if (shown.length === 0) {
    return {
      embeds: [
        baseEmbed({ color: COLORS.warning })
          .setTitle(EMOJI.lookup + ' Nothing to look up yet')
          .setDescription('No Rust server is configured. Run **/setup** and add one - then this command tells its whole story.'),
      ],
      components: [],
    };
  }

  const embeds = shown.map((snapshot) => serverEmbed({ snapshot, config, guildId, at }));
  embeds.push(honestyEmbed(config));
  if (staffTier) embeds.push(setupEmbed({ config, snapshots, pollSeconds, staffTier }));

  return { embeds: embeds.slice(0, 10), components: [] };
}
