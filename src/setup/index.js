import { MessageFlags } from 'discord.js';
import { describeConfig, normalizeServerInput, MAX_SERVERS } from '../store.js';
import { canRunSetup } from '../permissions.js';
import { BRAND, COLORS, LOG_KIND_IDS, logKindById, tierById } from '../theme.js';
import { hintEmbed } from '../embeds.js';
import { mainPanel, logsView, rolePickView, rolesView, serverModal, serversView, slotView, parseCustomId } from './panel.js';

function denied(interaction, gate) {
  return interaction.reply({
    content: '⛔ ' + (gate.reason ?? 'Only the Discord server owner can use this.'),
    flags: MessageFlags.Ephemeral,
  });
}

async function announce(ctx, guild, title, description, color = COLORS.brand) {
  await ctx.logs.status(guild.id, { title, description, color });
}

/** Buttons, selects and modals all land here; every branch re-checks the owner gate. */
export async function handleSetupComponent(interaction, ctx) {
  const parsed = parseCustomId(interaction.customId);
  if (!parsed) return false;

  const guild = interaction.guild;
  const gate = canRunSetup({ member: interaction.member, user: interaction.user, guild, botOwnerIds: ctx.botOwnerIds });
  if (!gate.allowed) {
    await denied(interaction, gate);
    return true;
  }

  const config = ctx.store.get(guild.id);
  const { action, args } = parsed;
  const snapshots = ctx.servers.snapshots(guild.id);

  switch (action) {
    case 'main':
      await interaction.update(mainPanel(config, { snapshots, guild }));
      return true;

    case 'view': {
      const view = args[0];
      if (view === 'roles') await interaction.update(rolesView(config));
      else if (view === 'logs') await interaction.update(logsView(config));
      else if (view === 'servers') await interaction.update(serversView(config, { snapshots }));
      else await interaction.update(mainPanel(config, { snapshots, guild }));
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
      await announce(ctx, guild, '🎭 ' + tier.label + ' set', '<@&' + roleId + '> was configured as the ' + tier.emoji + ' ' + tier.label + ' by <@' + interaction.user.id + '>.');
      await interaction.update(rolePickView(updated, tier.id));
      return true;
    }

    case 'roleclear': {
      const tier = tierById(args[0]);
      if (!tier) {
        await interaction.update(rolesView(config));
        return true;
      }
      if (tier.required) {
        await interaction.reply({ content: '👑 The ' + tier.label + ' is required — pick a role instead of clearing it.', flags: MessageFlags.Ephemeral });
        return true;
      }

      const updated = await ctx.store.update(guild.id, (next) => {
        next.roles[tier.id] = null;
        return next;
      });
      await announce(ctx, guild, '🧹 ' + tier.label + ' cleared', 'The ' + tier.label + ' was cleared by <@' + interaction.user.id + '>.', COLORS.warning);
      await interaction.update(rolePickView(updated, tier.id));
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
      if (channelId) await announce(ctx, guild, kind.emoji + ' ' + kind.label + ' log set', 'Log channel set to <#' + channelId + '> by <@' + interaction.user.id + '>.');
      return true;
    }

    case 'logclear': {
      const updated = await ctx.store.update(guild.id, (next) => {
        for (const kindId of LOG_KIND_IDS) next.logs[kindId] = null;
        return next;
      });
      await interaction.update(logsView(updated));
      await announce(ctx, guild, '🧹 Log channels cleared', 'All log channels were cleared by <@' + interaction.user.id + '>.', COLORS.warning);
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
      await announce(ctx, guild, '🗑️ Server removed', '**' + server.name + '** was removed from slot ' + slot + ' by <@' + interaction.user.id + '>.', COLORS.warning);
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
        await interaction.editReply({
          embeds: [
            hintEmbed(
              '✅ ' + server.name + ' answered',
              'Players: ' + (snapshot.info ? snapshot.info.players + '/' + snapshot.info.max : 'unknown') + '\nLatency: ' + (snapshot.latencyMs ?? '—') + 'ms\nHostname: ' + (snapshot.info?.hostname ?? 'unknown'),
              COLORS.success,
            ),
          ],
        });
      } else {
        await interaction.editReply({
          embeds: [
            hintEmbed(
              '⛔ No answer from ' + server.name,
              (snapshot?.error ? snapshot.error + '\n\n' : '') +
                'Check that the server was started with \`+rcon.web 1 +rcon.port ' + server.port + ' +rcon.password ...\`, that the port is open over TCP, and that the password matches.',
              COLORS.danger,
            ),
          ],
        });
      }
      return true;
    }

    case 'done': {
      const fresh = ctx.store.get(guild.id);
      const status = describeConfig(fresh);
      const missing = [
        fresh.roles?.owner ? null : '👑 Owner Role',
        status.servers > 0 ? null : 'at least one server (🖥️ Servers)',
        status.logs > 0 ? null : 'a log channel is optional but recommended (📋 Logs)',
      ].filter(Boolean);

      const body = status.ready
        ? 'Everything needed is configured:\n' +
          '• ' + status.roles + ' staff role(s)\n' +
          '• ' + status.logs + ' log channel(s)\n' +
          '• ' + status.servers + ' server(s)\n\nStaff commands now follow these roles, and /pop is live.'
        : 'Still missing:\n' + missing.map((line) => '• ' + line).join('\n');

      await interaction.update({ embeds: [hintEmbed(status.ready ? '✅ Setup complete' : '⚠️ Almost there', body, status.ready ? COLORS.success : COLORS.warning)], components: mainPanel(fresh, { snapshots, guild }).components });
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

  const guild = interaction.guild;
  const gate = canRunSetup({ member: interaction.member, user: interaction.user, guild, botOwnerIds: ctx.botOwnerIds });
  if (!gate.allowed) {
    await denied(interaction, gate);
    return true;
  }

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
  await announce(
    ctx,
    guild,
    '🖥️ Server saved in slot ' + slot,
    '**' + result.value.name + '** (' + result.value.host + ':' + result.value.port + ') was saved by <@' + interaction.user.id + '>.',
  );

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
