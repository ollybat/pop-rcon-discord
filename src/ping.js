import { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import { pingEmbed } from './embeds.js';
import { probeHealth } from './web.js';
import { canRun } from './permissions.js';
import { stats as processStats } from './stats.js';

export const PING_ID = 'sb:ping';

/** The only button: check everything again without retyping the command. */
export function pingRows() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(PING_ID + ':refresh').setLabel('Check again').setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    ),
  ];
}

/** Accept either the counters or a stats snapshot. */
function countersFrom(stats) {
  if (!stats) return processStats.snapshot();
  if (typeof stats.snapshot === 'function') return stats.snapshot();
  return stats;
}

/**
 * Everything /ping reports: the bot's own numbers, every server's RCON round-trip, what the public
 * URL answered and how the guild is configured. Answered privately, so it may name roles and
 * channels - never a password.
 */
export async function buildPingPayload({
  guild,
  guildConfig = null,
  servers = null,
  web = {},
  client = null,
  pollSeconds = null,
  prefix = '!',
  prefixEnabled = true,
  dms = null,
  stats = null,
  memoryMb = null,
} = {}) {
  const snapshots = servers && guild ? await servers.refreshGuild(guild.id).catch(() => []) : [];
  const health = web.publicUrl ? await probeHealth({ url: web.publicUrl, timeoutMs: web.timeoutMs }) : null;
  const localUrl = !health && web.enabled && web.port ? 'http://127.0.0.1:' + web.port + '/health' : null;

  return {
    embeds: [
      pingEmbed({
        gatewayMs: client && Number.isFinite(client.ws?.ping) ? client.ws.ping : null,
        uptimeSeconds: Math.round(process.uptime()),
        snapshots,
        health,
        localUrl,
        pollSeconds,
        memoryMb: Number.isFinite(memoryMb) ? memoryMb : Math.round(process.memoryUsage().rss / 1048576),
        stats: countersFrom(stats),
        config: guildConfig,
        dms,
        prefix,
        prefixEnabled,
      }),
    ],
    components: pingRows(),
  };
}

/** The 🔄 button, for the same people who may run /ping at all. */
export async function handlePingComponent(interaction, ctx) {
  if (!(interaction.customId ?? '').startsWith(PING_ID + ':')) return false;

  const guild = interaction.guild;
  if (!guild) {
    await interaction.reply({ content: 'Use this inside a Discord server.', flags: MessageFlags.Ephemeral });
    return true;
  }

  const guildConfig = ctx.store.get(guild.id);
  const gate = canRun({
    member: interaction.member,
    user: interaction.user,
    guild,
    roles: guildConfig?.roles ?? null,
    minTier: 'coOwner',
    botOwnerIds: ctx.botOwnerIds,
  });

  if (!gate.allowed) {
    await interaction.reply({ content: '⛔ ' + (gate.reason ?? 'Only the clan owners can check this.'), flags: MessageFlags.Ephemeral });
    return true;
  }

  await interaction.deferUpdate();
  const payload = await buildPingPayload({
    guild,
    guildConfig,
    servers: ctx.servers,
    web: ctx.web ?? {},
    client: ctx.client ?? null,
    pollSeconds: ctx.pollSeconds ?? null,
    prefix: ctx.prefix ?? '!',
    prefixEnabled: ctx.prefixEnabled !== false,
    dms: ctx.dms ?? null,
    stats: ctx.stats ?? null,
  });

  await interaction.editReply(payload);
  return true;
}
