import { ChannelType, Client, GatewayIntentBits, MessageFlags, Partials } from 'discord.js';
import { config, presenceSlot } from './config.js';
import { createLogger } from './logger.js';
import { GuildStore, configuredServers, peakFor, recordPeak } from './store.js';
import { LogRouter } from './logs.js';
import { ChannelRelay } from './relay.js';
import { PresenceManager, aggregateInfos } from './presence.js';
import { ServerManager } from './servers.js';
import { commandByName, defaultSlot, describeOptions, dispatch, readOptions, slashCommandData } from './commands.js';
import { errorEmbed, hintEmbed, outageEmbed, welcomeEmbed } from './embeds.js';
import { handlePopComponent } from './pop.js';
import { handlePingComponent } from './ping.js';
import { history, slotKey } from './history.js';
import { stats } from './stats.js';
import { handleSetupComponent, handleSetupModal } from './setup/index.js';
import { parsePrefixCommand } from './prefix.js';
import { createDmRelay } from './dms.js';
import { createHealthServer } from './web.js';
import { createBoardManager } from './board.js';
import { createServerWatch, outageText } from './watch.js';
import { guildOwnerOf, welcomeOwner } from './onboarding.js';
import { BRAND, COLORS } from './theme.js';

const logger = createLogger({ level: config.log.level, timestamps: config.log.timestamps });

const intents = [GatewayIntentBits.Guilds];
if (config.discord.prefixCommandsEnabled || config.dm.enabled) {
  // Prefix commands and direct messages both need the message intents.
  intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent);
}

const client = new Client({ intents, partials: [Partials.Channel] });

const store = new GuildStore({ dir: config.data.dir, logger });
const logs = new LogRouter({ client, store, logger });

const relay = new ChannelRelay({ client, channelId: config.log.chatChannelId, logger });

const dms = createDmRelay({
  client,
  store,
  logs,
  logger,
  options: {
    enabled: config.dm.enabled,
    botOwnerIds: config.discord.botOwnerIds,
    forwardIds: config.dm.forwardIds,
    forwardStrangers: config.dm.forwardStrangers,
    autoReplyCooldownMs: config.dm.replyCooldownSeconds * 1000,
    prefix: config.discord.prefix,
    stats,
  },
});

const servers = new ServerManager({
  store,
  logger,
  pollIntervalSeconds: config.poll.intervalSeconds,
  envServer: config.rcon.fromEnv,
  onChat: (guildId, event) => relay.chat(event),
  onSnapshot: (guildId, snapshot) => {
    // Every snapshot is also an outage check, so a server that dies quietly is still noticed.
    watch.observe(guildId, snapshot).catch(() => null);
    return recordSnapshot(guildId, snapshot);
  },
  onChanges: (guildId, changes) => reportChanges(guildId, changes),
  onStatus: (guildId, status) => reportStatus(guildId, status),
  onError: (guildId, error) =>
    logs.error(guildId, {
      source: 'RCON ' + (error.server ? error.server.name : 'client'),
      message: error.message,
      context: error.source,
    }),
});

// The live population board: one message per server, kept up to date, plus any /pop answer
// somebody marked live. Sharing the poll interval keeps it cheap and rate-limit safe.
const board = createBoardManager({
  client,
  store,
  servers,
  logger,
  intervalSeconds: config.board.intervalSeconds,
  forceSeconds: config.board.forceSeconds,
  liveMinutes: config.board.liveMinutes,
});

// Outages that last, and the recovery afterwards. Decided from snapshots, announced once each.
const watch = createServerWatch({
  downAfterSeconds: config.alerts.downAfterMinutes * 60,
  logger,
  notify: (event) => reportOutage(event),
});

const startedAt = Date.now();

/** Everything the public health endpoint is allowed to say: never a secret, never a password. */
function healthStatus() {
  const roster = [];
  for (const guildId of store.listGuildIds()) {
    for (const snapshot of servers.snapshots(guildId)) {
      const key = slotKey(guildId, snapshot.slot);
      const values = history.series(key).map((sample) => sample.players);
      roster.push({
        slot: snapshot.slot,
        name: snapshot.name,
        connected: Boolean(snapshot.connected),
        players: snapshot.info?.players ?? null,
        max: snapshot.info?.max ?? null,
        queued: snapshot.info?.queued ?? null,
        latencyMs: snapshot.latencyMs ?? null,
        trend: history.delta(key),
        average: history.average(key),
        shape: values.length >= 2 ? values.slice(-12).join(',') : null,
      });
    }
  }

  return {
    bot: client.user?.tag ?? null,
    uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    gatewayPingMs: Number.isFinite(client.ws?.ping) ? client.ws.ping : null,
    guilds: client.guilds.cache.size,
    servers: roster,
    stats: (() => {
      const snapshot = stats.snapshot();
      delete snapshot.recentErrors;
      return snapshot;
    })(),
  };
}

const health = createHealthServer({
  logger,
  port: config.web.enabled ? config.web.port : null,
  host: config.web.host,
  status: healthStatus,
});

const presence = new PresenceManager({
  client,
  logger,
  options: {
    enabled: config.presence.enabled,
    intervalSeconds: config.poll.intervalSeconds,
    restingOnReconnect: config.presence.restingOnReconnect,
    // While the server is online the line cycles: population, then queue/uptime, then the day's peak.
    rotateFrames: config.presence.rotate
      ? [config.presence.formats.online, '⏳ {queued} queued · 🕒 {uptime}', '🥇 {peak} peak today · 🕒 {uptime}']
      : null,
    formats: {
      online: config.presence.formats.online,
      offline: config.presence.formats.offline,
      resting: config.presence.formats.resting,
    },
  },
  provider: presenceProvider,
});

function reportChanges(guildId, changes) {
  const base = {
    server: changes.server,
    online: changes.online,
    max: changes.max,
    joinedCount: changes.joinedCount,
    leftCount: changes.leftCount,
  };

  if (changes.massChange) {
    logs.joinLeave(guildId, { ...base, type: 'join', player: { name: '', id: '' }, massChange: true });
    return;
  }

  for (const player of changes.joined) logs.joinLeave(guildId, { ...base, type: 'join', player });
  for (const player of changes.left) logs.joinLeave(guildId, { ...base, type: 'leave', player, sessionSeconds: player.sessionSeconds });
}

/** Milestone announcements, so a record or a full server is noticed without anyone asking. */
const milestones = { peakAt: new Map(), full: new Map(), queue: new Map(), restartAt: new Map() };

/**
 * Tells the guild about an outage or a recovery: the status log channel first, and the owner by
 * direct message when that is switched on and their DMs are open. The address is never part of
 * it - the message points at /setup instead.
 */
async function reportOutage({ action, guildId, snapshot, seconds }) {
  const guildConfig = store.get(guildId);
  if (guildConfig?.alerts?.enabled === false || guildConfig?.alerts?.outage === false) return;

  const down = action === 'down';
  const name = snapshot?.name || 'Server ' + (snapshot?.slot ?? '?');
  const embed = outageEmbed({
    down,
    name,
    seconds,
    error: snapshot?.error ?? null,
    alertMinutes: config.alerts.downAfterMinutes,
  });

  if (guildConfig?.logs?.status) logs.status(guildId, { title: embed.title, description: embed.description, color: down ? COLORS.danger : COLORS.success });
  else logger.info('[alerts] ' + (down ? 'outage' : 'recovery') + ' for ' + name + ' (no status channel set)');

  if (!config.alerts.dmOwner) return;

  const guild = client.guilds.cache.get(guildId) ?? null;
  const owner = guild ? await guildOwnerOf(guild, { logger }).catch(() => null) : null;
  if (!owner) return;

  const sent = await owner
    .send({ embeds: [embed] })
    .then(() => true)
    .catch(() => false);

  if (!sent) logger.debug('[alerts] could not DM the owner of ' + guildId + ' about ' + name);
}

function alertGuild(guildId, payload) {
  const guildConfig = store.get(guildId);
  if (!guildConfig || guildConfig.alerts?.enabled === false || guildConfig.alerts?.milestones === false) return null;
  // Milestones go where the server status goes: no status channel, nothing to interrupt.
  if (!guildConfig.logs?.status) return null;
  return logs.status(guildId, payload);
}

function announcePeak(guildId, snapshot, before) {
  const info = snapshot.info;
  if (!info || info.players < 5) return;

  const oldPeak = before && before.peak ? before.peak : 0;
  // The first reading of the day is not news, and neither is a spike every few minutes.
  if (oldPeak < 5 || info.players <= oldPeak) return;

  const key = guildId + ':' + snapshot.slot;
  const at = Date.now();
  if (at - (milestones.peakAt.get(key) ?? 0) < 10 * 60 * 1000) return;
  milestones.peakAt.set(key, at);

  alertGuild(guildId, {
    title: '🥇 New record for today — ' + info.players + ' players on ' + snapshot.name,
    description:
      'That beats the best of ' +
      oldPeak +
      '. `/ping` has the shape of the day, `/pop` the live count.',
    color: COLORS.success,
  });
}

/** A restart is worth one line: it explains why everybody fell off the server list. */
function announceRestart(guildId, snapshot) {
  const restart = snapshot?.restart;
  if (!restart?.at) return;

  const key = guildId + ':' + snapshot.slot;
  if (milestones.restartAt.get(key) === restart.at) return;
  milestones.restartAt.set(key, restart.at);

  alertGuild(guildId, {
    title: '🔄 ' + snapshot.name + ' restarted' + (restart.wiped ? ' — and the save looks fresh' : ''),
    description:
      'It had been up ' +
      outageText(restart.wasUpSeconds) +
      (restart.wiped
        ? '. The entity count dropped from a full map to ' + (restart.entityCount ?? 'a fraction of it') + ', which is what a wipe looks like from the outside.'
        : '. Everything it reported afterwards is on /pop.'),
    color: restart.wiped ? COLORS.warning : COLORS.brand,
  });
}

function announceCrowd(guildId, snapshot) {
  const info = snapshot.info;
  if (!info) return;

  const fullKey = guildId + ':' + snapshot.slot + ':full';
  const queueKey = guildId + ':' + snapshot.slot + ':queue';
  const full = info.max > 0 && info.players >= info.max;
  const queued = Number(info.queued) > 0;

  if (full && !milestones.full.has(fullKey)) {
    milestones.full.set(fullKey, true);
    alertGuild(guildId, {
      title: '🔥 ' + snapshot.name + ' is full — ' + info.players + '/' + info.max,
      description: 'Every slot is taken, so new arrivals will queue. `/pop` shows the count live.',
      color: COLORS.warning,
    });
  }
  if (!full) milestones.full.delete(fullKey);

  if (queued && !milestones.queue.has(queueKey)) {
    milestones.queue.set(queueKey, true);
    alertGuild(guildId, {
      title: '⏳ The queue is moving — ' + info.queued + ' waiting for ' + snapshot.name,
      description: 'A slot opened up. `/pop` is live if you want to watch it.',
      color: COLORS.brand,
    });
  }
  if (!queued) milestones.queue.delete(queueKey);
}

/** Keep the busiest moment of the day per server, and write to disk only on a new peak. */
async function recordSnapshot(guildId, snapshot) {
  try {
    if (!snapshot || !snapshot.connected || !snapshot.info) return;

    const before = peakFor(store.get(guildId), snapshot.slot);
    const probe = JSON.parse(JSON.stringify(store.get(guildId)));
    const isPeak = recordPeak(probe, snapshot.slot, snapshot.info.players);

    if (isPeak) {
      stats.inc('peaks');

      await store.update(guildId, (next) => {
        recordPeak(next, snapshot.slot, snapshot.info.players);
        return next;
      });

      announcePeak(guildId, snapshot, before);
    }

    announceCrowd(guildId, snapshot);
    announceRestart(guildId, snapshot);
  } catch (error) {
    logger.warn('[peaks] ' + (error && error.message ? error.message : error));
  }
}

function reportStatus(guildId, status) {
  if (status.type === 'connected') {
    logs.status(guildId, {
      title: '📡 ' + status.server.name + ' is connected',
      description: 'RCON session established and the server is answering. The address stays in /setup.',
      color: COLORS.success,
    });
    return;
  }

  logs.status(guildId, {
    title: '📴 ' + status.server.name + ' disconnected',
    description: 'The RCON session dropped' + (status.reason ? ' (' + status.reason + ')' : '') + '. Reconnecting automatically.',
    color: COLORS.warning,
  });
}

/** The guild whose servers drive the bot's activity. */
function presenceGuildId() {
  if (config.presence.guildId && client.guilds.cache.has(config.presence.guildId)) return config.presence.guildId;

  for (const id of store.listGuildIds()) {
    if (client.guilds.cache.has(id) && configuredServers(store.get(id)).length > 0) return id;
  }

  const first = client.guilds.cache.first();
  return first ? first.id : null;
}

/** Reads the latest snapshots; the per-server timers keep them fresh. */
async function presenceProvider() {
  const guildId = presenceGuildId();
  if (!guildId) return { connected: false, reconnecting: false, info: null };

  await servers.syncGuild(guildId);
  const monitors = servers.list(guildId);
  const wanted = presenceSlot(config.presence.serverSlot);
  const targets = wanted === 'all' ? monitors : monitors.filter((monitor) => monitor.slot === wanted);

  if (targets.length === 0) return { connected: false, reconnecting: false, info: null };

  const snapshots = targets.map((monitor) => monitor.snapshot);
  const connected = snapshots.some((snapshot) => snapshot.connected);
  const reconnecting = targets.some((monitor) => Boolean(monitor.rcon.reconnectTimer) || monitor.rcon.reconnectAttempts > 0);

  const peakOf = (snapshot) => {
    const stored = peakFor(store.get(guildId), snapshot.slot);
    return stored && stored.peak ? stored.peak : null;
  };

  if (wanted === 'all') {
    const info = connected ? aggregateInfos(snapshots) : null;
    if (info) info.peak = snapshots.reduce((best, snapshot) => Math.max(best, peakOf(snapshot) ?? 0), 0) || null;
    return { connected, reconnecting, info };
  }

  const snapshot = snapshots[0];
  const info = snapshot && snapshot.info ? { ...snapshot.info, peak: peakOf(snapshot) } : null;
  return { connected: Boolean(snapshot && snapshot.connected), reconnecting, info };
}

function slashInvoker(interaction) {
  return {
    source: 'slash',
    async defer() {
      if (interaction.deferred || interaction.replied) return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    },
    async reply(payload) {
      if (interaction.deferred || interaction.replied) return interaction.followUp({ ...payload, flags: MessageFlags.Ephemeral });
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
    async edit(payload) {
      if (interaction.deferred || interaction.replied) return interaction.editReply(payload);
      return interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    },
    async fail(error) {
      const embed = errorEmbed(error);
      if (interaction.deferred || interaction.replied) await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
      else await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral }).catch(() => {});
    },
  };
}

/**
 * Prefix replies are public by default. A command marked private (/setup, /ping) is answered in a
 * DM instead, because posting it in the channel would show the clan's own settings to everyone.
 */
function prefixInvoker(message, { private: isPrivate = false } = {}) {
  const deliver = async (payload) => {
    if (!isPrivate) return message.reply(payload).catch(() => null);

    const sent = await message.author.send(payload).catch(() => null);
    if (sent) return sent;

    return message
      .reply({
        embeds: [
          hintEmbed(
            '🔒 Answered in private',
            'I could not send you a DM, and this answer is not for the channel.\n' +
              'Allow direct messages from server members in your privacy settings, or use the slash version instead.',
          ),
        ],
      })
      .catch(() => null);
  };

  return {
    source: 'prefix',
    async defer() {
      await message.channel.sendTyping().catch(() => {});
    },
    async reply(payload) {
      return deliver(payload);
    },
    async edit(payload) {
      return deliver(payload);
    },
    async fail(error) {
      await deliver({ embeds: [errorEmbed(error)] });
    },
  };
}

/** One path for both /slash and !prefix: gate, run, then write the command log. */
async function runCommand(command, options) {
  const guild = options.guild;
  const guildConfig = options.guildConfig ?? store.get(guild.id);
  const invoker = options.interaction
    ? slashInvoker(options.interaction)
    : prefixInvoker(options.message, { private: Boolean(command.private) });
  const started = Date.now();

  const ctx = {
    invoker,
    guild,
    member: options.member ?? null,
    user: options.user ?? options.message?.author ?? null,
    args: options.args ?? [],
    guildConfig,
    store,
    servers,
    logs,
    logger,
    botOwnerIds: config.discord.botOwnerIds,
    client,
    web: config.web,
    pollSeconds: config.poll.intervalSeconds,
    slot: defaultSlot(guildConfig, config.rcon.fromEnv),
    prefix: config.discord.prefix,
    prefixEnabled: config.discord.prefixCommandsEnabled,
    stats,
    dms: { enabled: dms.enabled, forwardIds: config.dm.forwardIds.length },
    options: readOptions({ command, interaction: options.interaction ?? null, args: options.args ?? [] }),
    source: invoker.source,
  };

  const result = await dispatch(command, ctx);
  const tier = result.tier === 'botOwner' ? null : result.tier;
  stats.inc('commands');
  if (!result.ok && result.error && result.error !== 'permission denied') stats.note('/' + command.name + ': ' + result.error);

  await logs.command(guild.id, {
    user: ctx.user,
    tier,
    command: command.name,
    options: describeOptions(command, options.interaction ?? null, options.args ?? []),
    ok: result.ok,
    ms: Date.now() - started,
    error: result.error && result.error !== 'permission denied' ? result.error : null,
    guild,
    channel: options.channel ?? null,
  });

  if (!result.ok && result.error && result.error !== 'permission denied') {
    await logs.error(guild.id, { source: '/' + command.name, message: result.error, context: 'requested by ' + (ctx.user ? ctx.user.username : 'unknown') });
  }

  return result;
}

client.on('interactionCreate', async (interaction) => {
  // Slash commands are guild-only: in a DM, say where to use them instead of failing quietly.
  if (!interaction.guildId && interaction.isChatInputCommand?.()) {
    await interaction
      .reply({
        embeds: [
          hintEmbed(
            '🏠 Use this inside a server',
            '**/' + interaction.commandName + '** works in a Discord server, not in a direct message.\n' +
              'Open the ' + BRAND.name + ' server, or just write here and I will pass your message to the owners.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      })
      .catch(() => {});
    return;
  }

  const ctx = {
    store,
    servers,
    logs,
    logger,
    client,
    botOwnerIds: config.discord.botOwnerIds,
    brand: BRAND.name,
    web: config.web,
    pollSeconds: config.poll.intervalSeconds,
    prefix: config.discord.prefix,
    prefixEnabled: config.discord.prefixCommandsEnabled,
    dms: { enabled: dms.enabled },
    board,
    watch,
    stats,
  };

  try {
    if ((interaction.customId ?? '').startsWith('sb:pop:')) {
      if (await handlePopComponent(interaction, ctx)) return;
    }

    if ((interaction.customId ?? '').startsWith('sb:ping:')) {
      if (await handlePingComponent(interaction, ctx)) return;
    }

    if ((interaction.customId ?? '').startsWith('sb:setup:')) {
      if (interaction.isModalSubmit()) {
        if (await handleSetupModal(interaction, ctx)) return;
      } else if (await handleSetupComponent(interaction, ctx)) {
        return;
      }
    }

    if (interaction.isChatInputCommand()) {
      if (!interaction.guild) {
        await interaction.reply({ content: 'Use this inside a Discord server.', flags: MessageFlags.Ephemeral });
        return;
      }

      const command = commandByName(interaction.commandName);
      if (!command) {
        await interaction.reply({ content: 'That command is out of date — try again in a moment.', flags: MessageFlags.Ephemeral });
        return;
      }

      if (!store.has(interaction.guild.id)) await store.load(interaction.guild.id);
      await runCommand(command, {
        source: 'slash',
        interaction,
        guild: interaction.guild,
        member: interaction.member,
        user: interaction.user,
        channel: interaction.channel,
        guildConfig: store.get(interaction.guild.id),
      });
    }
  } catch (error) {
    logger.error('[interaction] ' + (error && error.stack ? error.stack : error));
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: '⚠️ Something went wrong. The error was logged.', flags: MessageFlags.Ephemeral });
      }
    } catch {
      // Interaction is gone; nothing else to do.
    }
  }
});

client.on('messageCreate', async (message) => {
  try {
    if (!message.author || message.author.bot) return;

    // Direct messages: answer the sender and pass the message to the clan owners.
    if (!message.guild) {
      await dms.handle(message);
      return;
    }

    if (!config.discord.prefixCommandsEnabled) return;

    const parsed = parsePrefixCommand(message.content, config.discord.prefix);
    if (!parsed) return;

    const command = commandByName(parsed.name);
    if (!command) return;

    // /setup only exists as a slash command: say so instead of staying silent.
    if (command.slashOnly) {
      await message
        .reply({
          embeds: [
            hintEmbed(
              'Use the slash version',
              '**/setup** is a slash command — start typing `/setup` and pick it from the menu.\n' +
                'Everybody else just needs `' + config.discord.prefix + 'pop`.',
            ),
          ],
        })
        .catch(() => {});
      return;
    }

    if (!store.has(message.guild.id)) await store.load(message.guild.id);
    await runCommand(command, {
      source: 'prefix',
      message,
      guild: message.guild,
      member: message.member,
      user: message.author,
      channel: message.channel,
      args: parsed.args,
      guildConfig: store.get(message.guild.id),
    });
  } catch (error) {
    logger.error('[message] ' + (error && error.stack ? error.stack : error));
  }
});

/** Guilds whose owner already got the setup guide in this run. */
const welcomed = new Set();

client.on('guildCreate', async (guild) => {
  // First thing: the owner gets the guide in their DMs, because that is the whole point of being
  // invited. A closed DM is answered in the server instead, never silently dropped.
  const onboarding = await welcomeOwner({
    client,
    guild,
    logger,
    seen: welcomed,
    prefix: config.discord.prefix,
    prefixEnabled: config.discord.prefixCommandsEnabled,
    dmEnabled: config.dm.enabled,
  }).catch((error) => ({ delivered: false, reason: error && error.message ? error.message : String(error) }));

  logger.info(
    '[onboarding] ' + guild.name + ': ' + (onboarding.delivered ? 'guide sent to the owner' : 'no DM sent (' + onboarding.reason + ')'),
  );

  try {
    await store.load(guild.id);
    await servers.syncGuild(guild.id);
    logger.info('[bot] joined ' + guild.name);
  } catch (error) {
    logger.warn('[bot] could not prepare guild ' + guild.id + ': ' + error.message);
  }

  await welcome(guild);
});

/** Say hello in a new server and wear the brand name. */
async function welcome(guild) {
  try {
    const me = await guild.members.fetchMe();
    if (me.manageable && me.nickname !== BRAND.name) await me.setNickname(BRAND.name, 'Spinback pop bot');
  } catch (error) {
    logger.debug('[bot] could not set the nickname: ' + error.message);
  }

  if (store.get(guild.id)?.servers?.some(Boolean)) return;

  try {
    const channel =
      guild.systemChannel ??
      guild.channels.cache.find(
        (candidate) =>
          candidate.type === ChannelType.GuildText &&
          candidate.permissionsFor?.(guild.members.me)?.has(['ViewChannel', 'SendMessages']),
      );

    if (!channel) return;
    await channel.send({
      embeds: [
        welcomeEmbed({
          prefix: config.discord.prefix,
          prefixEnabled: config.discord.prefixCommandsEnabled,
        }),
      ],
    });
  } catch (error) {
    logger.debug('[bot] could not post the welcome message: ' + error.message);
  }
}

async function registerCommands() {
  const body = slashCommandData();

  try {
    if (config.discord.guildId) {
      const guild = await client.guilds.fetch(config.discord.guildId);
      await guild.commands.set(body);
      // Also empty the global scope: a stale global copy of the same command is what makes
      // Discord show two entries with the same name in the picker.
      await client.application.commands.set([]);
      logger.info('[commands] registered ' + body.length + ' command(s) in guild ' + config.discord.guildId);
      return;
    }

    await client.application.commands.set(body);

    // No guild pin: clear the guild scope everywhere so no stale duplicate is left behind.
    for (const guild of client.guilds.cache.values()) {
      await guild.commands.set([]).catch(() => null);
    }

    logger.info('[commands] registered ' + body.length + ' global command(s)');
  } catch (error) {
    logger.error('[commands] registration failed: ' + error.message);
  }
}

let started = false;

async function start() {
  await client.login(config.discord.token);
  return client;
}

function onReady() {
  if (started) return;
  started = true;
  main().catch((error) => logger.error('[bot] startup failed: ' + (error && error.stack ? error.stack : error)));
}

async function main() {
  logger.info(BRAND.tagline + ' is online as ' + client.user.tag);

  if (dms.enabled) {
    logger.info('[dm] direct messages on: answer the sender, pass it to the owners, reply with ' + config.discord.prefix + 'reply');
  }

  await health.start().catch((error) => logger.warn('[web] could not listen on port ' + config.web.port + ': ' + error.message));

  const ids = new Set([...client.guilds.cache.keys(), ...store.listGuildIds()]);
  for (const id of ids) {
    await store.load(id).catch(() => null);
    if (client.guilds.cache.has(id)) await servers.syncGuild(id).catch((error) => logger.warn('[servers] ' + error.message));
  }

  const guildId = presenceGuildId();
  if (guildId) await servers.refreshGuild(guildId).catch(() => null);

  await presence.start();
  await registerCommands();

  // Post or refresh the boards once at startup, then let the ticker keep them current.
  await board.tick().catch((error) => logger.warn('[board] ' + (error && error.message ? error.message : error)));
  board.start();
}

client.once('ready', onReady);
client.once('clientReady', onReady);

client.on('error', (error) => logger.error('[discord] ' + (error && error.message ? error.message : error)));
client.on('warn', (message) => logger.debug('[discord] ' + message));

async function shutdown(signal) {
  logger.info('[bot] ' + signal + ' received, shutting down');
  presence.stop();
  board.stop();
  await health.stop().catch(() => {});
  await servers.stopAll().catch(() => {});
  await client.destroy().catch(() => {});
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => logger.error('[bot] unhandled rejection: ' + (reason && reason.stack ? reason.stack : reason)));

start().catch((error) => {
  logger.error('[bot] could not log in: ' + (error && error.message ? error.message : error));
  process.exit(1);
});

export { client, store, servers, logs, presence, relay, board, watch, start, main };
