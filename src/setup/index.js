import { ChannelType, MessageFlags, PermissionFlagsBits } from 'discord.js';
import { BRAND, CATEGORY_PRESET, COLORS, LOG_CHANNEL_PRESETS, LOG_KINDS, LOG_KIND_IDS, logKindById, tierById } from '../theme.js';
import { MAX_SERVERS, describeConfig, emptyGuildConfig, normalizeServerInput } from '../store.js';
import { canRunSetup, matchRolesByName } from '../permissions.js';
import { digestEmbed, hintEmbed, statusLogEmbed } from '../embeds.js';
import { digestFor } from '../digest.js';
import { sendGuideTo } from '../onboarding.js';
import { boardView, guideView, logsView, mainPanel, parseCustomId, resetView, rolePickView, rolesView, serverModal, serversView, slotView } from './panel.js';

function denied(interaction, gate) {
  return interaction.reply({ content: '⛔ ' + (gate.reason ?? 'Only the Discord server owner can use this.'), flags: MessageFlags.Ephemeral });
}

async function announce(ctx, guild, title, description, color = COLORS.brand) {
  await ctx.logs.status(guild.id, { title, description, color });
}

function tierLabel(tierId) {
  const tier = tierById(tierId);
  return tier ? tier.emoji + ' ' + tier.label : tierId;
}

function canManageChannels(guild) {
  return Boolean(guild?.members?.me?.permissions?.has?.(PermissionFlagsBits.ManageChannels));
}

/** Builds the four log channels (and a category) for every kind that has none yet. */
async function createLogChannels(guild, config, logger) {
  if (!canManageChannels(guild)) {
    return { created: {}, error: 'I need the **Manage Channels** permission to create log channels.' };
  }

  const created = {};
  let category = guild.channels.cache.find((channel) => channel.type === ChannelType.GuildCategory && /spinback/i.test(channel.name)) ?? null;

  if (!category) {
    try {
      category = await guild.channels.create({ name: CATEGORY_PRESET.name, type: ChannelType.GuildCategory, reason: BRAND.name + ' quick setup' });
    } catch (error) {
      logger.warn('[setup] could not create the category: ' + error.message);
      return { created: {}, error: 'Discord refused the category: ' + error.message };
    }
  }

  for (const kind of LOG_KINDS) {
    if (config.logs?.[kind.id]) continue;
    const preset = LOG_CHANNEL_PRESETS[kind.id];

    try {
      const channel = await guild.channels.create({
        name: preset.name,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: preset.topic,
        reason: BRAND.name + ' quick setup',
      });
      created[kind.id] = channel.id;
    } catch (error) {
      logger.warn('[setup] could not create ' + kind.id + ': ' + error.message);
    }
  }

  return { created, categoryId: category.id };
}

/** Re-checks the owner gate on every button, select and modal. */
async function gate(interaction, ctx) {
  const check = canRunSetup({ member: interaction.member, user: interaction.user, guild: interaction.guild, botOwnerIds: ctx.botOwnerIds });
  if (!check.allowed) await denied(interaction, check);
  return check.allowed;
}

/** Buttons, selects and modals all land here. */
/**
 * Prove the log channels really work: one small branded embed per configured channel, and a
 * report of what could and could not be written. Nothing secret is ever part of the test.
 */
async function testLogChannels(guild, config) {
  const sent = [];
  const failed = [];

  for (const kind of LOG_KINDS) {
    const channelId = config?.logs?.[kind.id] ?? null;
    if (!channelId) continue;

    const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
    if (!channel) {
      failed.push(kind.emoji + ' ' + kind.label + ' (gone)');
      continue;
    }

    const embed = statusLogEmbed({
      title: '🧪 Test message — ' + kind.emoji + ' ' + kind.label,
      description: 'This channel is wired up correctly. Everything the bot posts here looks like this.',
      color: COLORS.success,
    });

    const ok = await channel.send({ embeds: [embed] }).then(() => true).catch(() => false);
    if (ok) sent.push(kind.emoji + ' <#' + channelId + '>');
    else failed.push(kind.emoji + ' <#' + channelId + '>');
  }

  return { sent, failed };
}

export async function handleSetupComponent(interaction, ctx) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;
  if (!(await gate(interaction, ctx))) return true;

  const guild = interaction.guild;
  const config = ctx.store.get(guild.id);
  const snapshots = ctx.servers.snapshots(guild.id);
  const { action, args } = parsed;

  switch (action) {
    case 'main':
      await interaction.update(mainPanel(config, { snapshots, guild }));
      return true;

    case 'view': {
      const view = args[0];
      if (view === 'roles') await interaction.update(rolesView(config));
      else if (view === 'logs') await interaction.update(logsView(config));
      else if (view === 'servers') await interaction.update(serversView(config, { snapshots }));
      else if (view === 'board') await interaction.update(boardView(config, { snapshots, guild }));
      else if (view === 'guide') await interaction.update(guideView(config));
      else await interaction.update(mainPanel(config, { snapshots, guild }));
      return true;
    }

    case 'guide':
      await interaction.update(guideView(config));
      return true;

    case 'testlogs': {
      await interaction.deferUpdate();
      const result = await testLogChannels(guild, config);
      const lines = [];
      if (result.sent.length > 0) lines.push('✅ Delivered to: ' + result.sent.join(', '));
      if (result.failed.length > 0) lines.push('⚠️ Could not write to: ' + result.failed.join(', ') + ' — check that I may send messages there.');
      if (result.sent.length === 0 && result.failed.length === 0) lines.push('No log channel is set yet. Pick one above, or press **Make channels**.');
      await interaction.followUp({
        embeds: [hintEmbed('🧪 Test messages', lines.join('\n'), result.failed.length > 0 ? COLORS.warning : COLORS.success)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    case 'guidedm': {
      await interaction.deferUpdate();
      const sent = await sendGuideTo({
        user: interaction.user,
        guild,
        logger: ctx.logger,
        prefix: ctx.prefix ?? '!',
        prefixEnabled: ctx.prefixEnabled !== false,
        dmEnabled: ctx.dms?.enabled !== false,
      });

      await interaction.followUp({
        embeds: [
          hintEmbed(
            '📬 The setup guide',
            sent
              ? 'Sent to your direct messages — it covers the three steps, the start line your Rust server needs, and what to check when something refuses to connect.'
              : 'I could not DM you. Allow **direct messages from server members** in your privacy settings, then press the button again.',
            sent ? COLORS.success : COLORS.warning,
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    case 'testping': {
      await interaction.deferUpdate();
      const fresh = await ctx.servers.refreshGuild(guild.id).catch(() => []);
      await interaction.update(mainPanel(config, { snapshots: fresh, guild }));
      return true;
    }

    case 'refresh': {
      await ctx.servers.syncGuild(guild.id);
      const fresh = await ctx.servers.refreshGuild(guild.id);
      await interaction.update(mainPanel(ctx.store.get(guild.id), { snapshots: fresh, guild }));
      return true;
    }

    case 'role':
      await interaction.update(rolePickView(config, interaction.values[0]));
      return true;

    case 'roleset': {
      const tier = tierById(args[0]);
      const roleId = interaction.values[0];
      if (!tier) {
        await interaction.update(rolesView(config));
        return true;
      }

      const updated = await ctx.store.update(guild.id, (next) => {
        next.roles[tier.id] = roleId;
        return next;
      });
      await announce(ctx, guild, '🎭 ' + tier.label + ' set', '<@&' + roleId + '> is now the ' + tier.emoji + ' ' + tier.label + '.');
      await interaction.update(rolePickView(updated, tier.id));
      return true;
    }

    case 'roleclear': {
      const tier = tierById(args[0]);
      if (!tier || tier.required) {
        await interaction.update(rolePickView(config, args[0]));
        return true;
      }

      const updated = await ctx.store.update(guild.id, (next) => {
        next.roles[tier.id] = null;
        return next;
      });
      await interaction.update(rolePickView(updated, tier.id));
      return true;
    }

    case 'matchroles': {
      await interaction.deferUpdate();
      const match = matchRolesByName(guild.roles.cache, config.roles);
      const updated = await ctx.store.update(guild.id, (next) => {
        next.roles = match.roles;
        return next;
      });

      const found = match.matched.map(tierLabel);
      const missing = match.unmatched.map(tierLabel);
      const report = [
        found.length ? '**Matched:** ' + found.join(', ') : 'I could not match any role by name.',
        missing.length ? '**Still unset:** ' + missing.join(', ') + ' — pick those by hand.' : 'Every tier is set. 🎉',
      ].join('\n');

      await interaction.editReply(rolesView(updated));
      await interaction.followUp({ embeds: [hintEmbed('🪄 Guessed roles from your server', report)], flags: MessageFlags.Ephemeral });
      await announce(ctx, guild, '🪄 Roles guessed', found.length ? 'Matched ' + found.join(', ') + ' by name.' : 'No roles matched by name.');
      return true;
    }

    case 'createlogs': {
      await interaction.deferUpdate();
      const result = await createLogChannels(guild, config, ctx.logger);

      if (result.error) {
        await interaction.editReply(logsView(config));
        await interaction.followUp({ embeds: [hintEmbed('📁 Could not create the channels', result.error, COLORS.warning)], flags: MessageFlags.Ephemeral });
        return true;
      }

      const updated = await ctx.store.update(guild.id, (next) => {
        for (const [kindId, channelId] of Object.entries(result.created)) next.logs[kindId] = channelId;
        return next;
      });

      const made = Object.keys(result.created).map((kindId) => logKindById(kindId).emoji + ' <#' + result.created[kindId] + '>');
      await interaction.editReply(logsView(updated));
      await interaction.followUp({
        embeds: [
          hintEmbed(
            '📁 Channels ready',
            made.length ? 'Created and selected:\n' + made.join('\n') : 'Nothing to create — every log channel was already set.',
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
      await announce(ctx, guild, '📁 Log channels created', made.length ? made.join(' • ') : 'All log channels were already configured.');
      return true;
    }

    case 'quick': {
      await interaction.deferUpdate();

      const match = matchRolesByName(guild.roles.cache, config.roles);
      const channels = await createLogChannels(guild, config, ctx.logger);
      const updated = await ctx.store.update(guild.id, (next) => {
        next.roles = match.roles;
        for (const [kindId, channelId] of Object.entries(channels.created ?? {})) next.logs[kindId] = channelId;
        return next;
      });

      const status = describeConfig(updated);
      const report = [
        match.matched.length ? '🎭 **Roles matched:** ' + match.matched.map(tierLabel).join(', ') : '🎭 No role matched by name — pick them in 🎭 Roles.',
        match.unmatched.length ? '🎭 **Still to pick:** ' + match.unmatched.map(tierLabel).join(', ') : '🎭 Every staff tier is set.',
        channels.error
          ? '📋 ' + channels.error
          : Object.keys(channels.created ?? {}).length
            ? '📋 **Channels created:** ' + Object.keys(channels.created).map((kindId) => logKindById(kindId).label).join(', ')
            : '📋 Every log channel was already set.',
        status.servers > 0
          ? '🖥️ Now press ✅ **Done**.'
          : '🖥️ **Last step:** 🖥️ Servers → pick slot 1 → **Add** → your IP, RCON port and RCON password, then **Test**.',
      ].join('\n\n');

      await interaction.editReply(mainPanel(updated, { snapshots: ctx.servers.snapshots(guild.id), guild }));
      await interaction.followUp({ embeds: [hintEmbed('⚡ Quick setup', report, status.servers > 0 ? COLORS.success : COLORS.brand)], flags: MessageFlags.Ephemeral });
      await announce(ctx, guild, '⚡ Quick setup used', 'Roles and log channels were filled in automatically where possible.');
      return true;
    }

    case 'boardset': {
      const channelId = interaction.values?.[0] ?? null;

      const updated = await ctx.store.update(guild.id, (next) => {
        next.board.channelId = channelId;
        if (!channelId) {
          next.board.enabled = false;
          next.board.messageId = null;
        }
        return next;
      });

      // A channel change is also the fix for "the board stopped", so clear the block.
      ctx.board?.unblock(guild.id);
      if (channelId) await ctx.board?.syncGuild(guild.id, { force: true }).catch(() => null);
      await interaction.update(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'boardtoggle': {
      await interaction.deferUpdate();
      const turningOn = !config.board?.enabled;

      const updated = await ctx.store.update(guild.id, (next) => {
        next.board.enabled = turningOn && Boolean(next.board.channelId);
        return next;
      });

      ctx.board?.unblock(guild.id);
      const result = updated.board.enabled ? await ctx.board?.syncGuild(guild.id, { force: true }).catch(() => null) : null;

      await interaction.editReply(boardView(updated, { snapshots, guild }));

      if (updated.board.enabled && result && !result.ok) {
        await interaction.followUp({
          embeds: [hintEmbed('⚠️ Could not post there', 'I need **View Channel** and **Send Messages** in <#' + updated.board.channelId + '>. Fix the permissions and press 🔴 Keep it live again.', COLORS.warning)],
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    case 'boardpost': {
      await interaction.deferUpdate();
      ctx.board?.unblock(guild.id);
      const result = await ctx.board?.syncGuild(guild.id, { force: true }).catch(() => null);

      const body = !result
        ? 'Live boards are not available on this bot right now.'
        : result.ok
          ? result.reason === 'posted'
            ? 'Posted the board in <#' + config.board.channelId + '>. It updates itself from here.'
            : 'The board in <#' + config.board.channelId + '> is up to date.'
          : 'I could not write to <#' + config.board.channelId + '> (' + result.reason + '). Check **View Channel** and **Send Messages** for me there.';

      await interaction.followUp({
        embeds: [hintEmbed('📌 Live board', body, result && result.ok ? COLORS.success : COLORS.warning)],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    case 'digestset': {
      const channelId = interaction.values?.[0] ?? null;
      const updated = await ctx.store.update(guild.id, (next) => {
        next.digest.channelId = channelId;
        if (!channelId) {
          next.digest.enabled = false;
          next.digest.lastSent = null;
        }
        return next;
      });

      await interaction.update(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'digesttoggle': {
      await interaction.deferUpdate();
      const turningOn = !config.digest?.enabled;

      const updated = await ctx.store.update(guild.id, (next) => {
        next.digest.enabled = turningOn && Boolean(next.digest.channelId);
        // Starting it now should not immediately post yesterday's digest to a quiet channel.
        if (next.digest.enabled) next.digest.lastSent = next.digest.lastSent ?? null;
        return next;
      });

      await interaction.editReply(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'digesthour': {
      const updated = await ctx.store.update(guild.id, (next) => {
        const current = Number.isInteger(next.digest.hour) ? next.digest.hour : 20;
        next.digest.hour = (current + 1) % 24;
        return next;
      });

      await interaction.update(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'digestpreview': {
      await interaction.deferUpdate();
      const preview = digestFor({ config, window: ctx.digestWindow ?? 7 });
      await interaction.followUp({
        embeds: [digestEmbed({ digest: preview, config })],
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    case 'alertstoggle': {
      const updated = await ctx.store.update(guild.id, (next) => {
        next.alerts.milestones = next.alerts?.milestones === false;
        return next;
      });

      await interaction.update(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'outagetoggle': {
      const updated = await ctx.store.update(guild.id, (next) => {
        next.alerts.outage = next.alerts?.outage === false;
        return next;
      });

      // A change of mind is also the moment to forget an outage in progress, so the next one is
      // reported freshly rather than staying silent because the bot already spoke once.
      ctx.watch?.forget(guild.id);
      await interaction.update(boardView(updated, { snapshots, guild }));
      return true;
    }

    case 'logset': {
      const kind = logKindById(args[0]);
      if (!kind) {
        await interaction.update(logsView(config));
        return true;
      }

      const channelId = interaction.values?.[0] ?? null;
      const updated = await ctx.store.update(guild.id, (next) => {
        next.logs[kind.id] = channelId;
        return next;
      });
      await interaction.update(logsView(updated));
      if (channelId) await announce(ctx, guild, kind.emoji + ' ' + kind.label + ' log set', 'Log channel set to <#' + channelId + '>.');
      return true;
    }

    case 'logclear': {
      const updated = await ctx.store.update(guild.id, (next) => {
        for (const kindId of LOG_KIND_IDS) next.logs[kindId] = null;
        return next;
      });
      await interaction.update(logsView(updated));
      return true;
    }

    case 'slots': {
      const slot = Number(interaction.values[0]);
      await interaction.update(slotView(config, slot, ctx.servers.snapshot(guild.id, slot)));
      return true;
    }

    case 'slotedit': {
      const slot = Number(args[0]);
      if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SERVERS) {
        await interaction.update(serversView(config, { snapshots }));
        return true;
      }
      await interaction.showModal(serverModal(slot, config.servers?.[slot - 1] ?? null));
      return true;
    }

    case 'slotclear': {
      const slot = Number(args[0]);
      const server = config.servers?.[slot - 1] ?? null;
      if (!server) {
        await interaction.update(slotView(config, slot));
        return true;
      }

      const updated = await ctx.store.update(guild.id, (next) => {
        next.servers[slot - 1] = null;
        return next;
      });
      await ctx.servers.syncGuild(guild.id);
      await announce(ctx, guild, '🗑️ Server removed', '**' + server.name + '** was removed from slot ' + slot + '.', COLORS.warning);
      await interaction.update(slotView(updated, slot));
      return true;
    }

    case 'slottest': {
      const slot = Number(args[0]);
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const server = config.servers?.[slot - 1] ?? null;

      if (!server) {
        await interaction.editReply({ embeds: [hintEmbed('⚠️ Empty slot', 'Add a server to slot ' + slot + ' first.', COLORS.warning)] });
        return true;
      }

      const monitor = ctx.servers.monitorFor(guild.id, slot);
      const snapshot = monitor ? await monitor.refresh() : null;

      if (snapshot && snapshot.connected) {
        const peak = snapshot.info?.players ?? 0;
        await interaction.editReply({
          embeds: [
            hintEmbed(
              '✅ ' + server.name + ' answered',
              'Players: **' + (snapshot.info ? snapshot.info.players + '/' + snapshot.info.max : peak) + '**' +
                '\nQueue: ' + (snapshot.info?.queued ?? 0) + ' • Joining: ' + (snapshot.info?.joining ?? 0) +
                '\nLatency: ' + (snapshot.latencyMs ?? '—') + 'ms' +
                '\nHostname: ' + (snapshot.info?.hostname ?? 'unknown'),
              COLORS.success,
            ),
          ],
        });
      } else {
        await interaction.editReply({
          embeds: [
            hintEmbed(
              '⛔ No answer from ' + server.name,
              (snapshot?.error ? '**' + snapshot.error + '**\n\n' : '') +
                'Check that the server starts with \`+rcon.web 1 +rcon.port ' + server.port + ' +rcon.password ...\`,' +
                '\nthat port ' + server.port + ' is open over **TCP**, and that the password matches exactly.' +
                '\n\nConsole Edition (Xbox/PlayStation) has no RCON at all.',
              COLORS.danger,
            ),
          ],
        });
      }
      return true;
    }

    case 'reset':
      await interaction.update(resetView(config));
      return true;

    case 'resetconfirm': {
      await interaction.deferUpdate();
      const blank = await ctx.store.save(guild.id, emptyGuildConfig(guild.id));
      await ctx.servers.syncGuild(guild.id);
      await announce(ctx, guild, '🧹 Setup wiped', '<@' + interaction.user.id + ' cleared every role, log channel and server.', COLORS.warning);
      await interaction.editReply(mainPanel(blank, { snapshots: [], guild }));
      await interaction.followUp({ embeds: [hintEmbed('🧹 Everything cleared', 'Start again with ⚡ Quick setup, or fill in the sections one by one.', COLORS.warning)], flags: MessageFlags.Ephemeral });
      return true;
    }

    case 'done': {
      const fresh = ctx.store.get(guild.id);
      const status = describeConfig(fresh);
      const missing = [
        fresh.roles?.owner ? null : '👑 Owner Role — press 🪄 Guess roles or pick one',
        status.servers > 0 ? null : '🖥️ at least one server — Servers → slot 1 → Add',
        status.logs > 0 ? null : '📋 log channels (optional — press 📁 Make channels)',
      ].filter(Boolean);

      const body = status.ready
        ? [
            '**Everything is set:**',
            '🎭 ' + status.roles + ' staff role(s)',
            '📋 ' + status.logs + ' log channel(s)',
            '🖥️ ' + status.servers + ' server(s)',
            '',
            'The activity line is live and staff commands now follow these roles.',
            'Try **/pop** for who is online and **/status** for server health.',
          ].join('\n')
        : ['**Still missing:**', ...missing.map((line) => '• ' + line), '', 'Press 📖 **Guide** if you are not sure where to start.'].join('\n');

      await interaction.update({
        embeds: [hintEmbed(status.ready ? '✅ Setup complete' : '⚠️ Almost there', body, status.ready ? COLORS.success : COLORS.warning)],
        components: mainPanel(fresh, { snapshots, guild }).components,
      });

      if (status.ready) await announce(ctx, guild, '✅ Setup completed', '<@' + interaction.user.id + ' finished the ' + BRAND.name + ' setup.');
      return true;
    }

    default:
      await interaction.update(mainPanel(config, { snapshots, guild }));
      return true;
  }
}

/** The server slot modal. Responds in place when Discord lets us. */
export async function handleSetupModal(interaction, ctx) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'modalslot') return false;
  if (!(await gate(interaction, ctx))) return true;

  const guild = interaction.guild;
  const slot = Number(parsed.args[0]);
  if (!Number.isInteger(slot) || slot < 1 || slot > MAX_SERVERS) {
    await interaction.reply({ content: '⛔ Unknown server slot.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const config = ctx.store.get(guild.id);
  const existing = config.servers?.[slot - 1] ?? null;
  const password = interaction.fields.getTextInputValue('password');
  const result = normalizeServerInput({
    name: interaction.fields.getTextInputValue('name'),
    host: interaction.fields.getTextInputValue('host'),
    port: interaction.fields.getTextInputValue('port'),
    password: password || existing?.password || '',
  });

  if (!result.ok) {
    await interaction.reply({ embeds: [hintEmbed('⚠️ That server was not saved', result.error, COLORS.warning)], flags: MessageFlags.Ephemeral });
    return true;
  }

  const updated = await ctx.store.update(guild.id, (next) => {
    next.servers[slot - 1] = result.value;
    return next;
  });
  await ctx.servers.syncGuild(guild.id);
  await announce(ctx, guild, '🖥️ Server saved in slot ' + slot, '**' + result.value.name + '** (' + result.value.host + ':' + result.value.port + ').');

  const payload = slotView(updated, slot, ctx.servers.snapshot(guild.id, slot));

  if (typeof interaction.isFromMessage === 'function' && interaction.isFromMessage()) {
    try {
      await interaction.deferUpdate();
      await interaction.editReply(payload);
      return true;
    } catch (error) {
      ctx.logger.warn('[setup] could not reuse the panel message: ' + error.message);
    }
  }

  try {
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
  } catch (error) {
    ctx.logger.warn('[setup] could not answer the modal: ' + error.message);
  }
  return true;
}

export function setupPanelFor(config, guild, snapshots = []) {
  return mainPanel(config, { snapshots, guild });
}
