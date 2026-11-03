import { SlashCommandBuilder } from 'discord.js';
import { COLORS, TIERS, tierById } from './theme.js';
import { baseEmbed } from './embeds.js';
import { popPayload, popPlaceholder } from './pop.js';
import { canRun } from './permissions.js';
import { effectiveServers } from './servers.js';
import { buildPingPayload } from './ping.js';

/**
 * The bot serves three commands.
 *
 *   /setup  — the setup panel, for the Discord server owner and the bot owner only.
 *   !pop    — the headline command, open to everybody, in prefix form.
 *   /ping   — health check (Discord ping, RCON round-trip, the public URL), for the clan owners.
 *
 * Everything else (staff tools, logs, the record book) is served through the setup panel,
 * its buttons and the status line, so the slash menu stays short and obvious.
 */
export const commands = [
  {
    name: 'setup',
    description: 'Configure your Rust servers, roles and logs (private)',
    prefixUsage: null,
    minTier: null,
    ownerOnly: true,
    slashOnly: true,
    private: true,
    data: new SlashCommandBuilder().setName('setup').setDescription('Configure roles, log channels and Rust servers'),
    async run(ctx) {
      const { setupPanelFor } = await import('./setup/index.js');
      const snapshots = ctx.servers.snapshots(ctx.guild.id);
      const payload = setupPanelFor(ctx.store.get(ctx.guild.id), ctx.guild, snapshots);
      await ctx.invoker.reply(payload);
    },
  },
  {
    name: 'pop',
    description: 'Show who is playing right now',
    prefixUsage: '!pop [slot]',
    minTier: null,
    prefixOnly: true,
    // Public on purpose: the population is for the whole clan to see. No server address, no secret.
    private: false,
    data: new SlashCommandBuilder()
      .setName('pop')
      .setDescription('Show who is playing right now')
      .addIntegerOption((option) =>
        option.setName('server').setDescription('Server slot (1-3). Leave empty for every server').setMinValue(1).setMaxValue(3).setRequired(false),
      )
      .addBooleanOption((option) => option.setName('players').setDescription('List the player names (default true)').setRequired(false))
      .addBooleanOption((option) =>
        option.setName('details').setDescription('Show the map, FPS, entities and the recent trend (default true)').setRequired(false),
      ),
    async run(ctx) {
      const slot = ctx.options.integer('server');
      const showPlayers = ctx.options.boolean('players') ?? true;

      await ctx.invoker.defer();
      const snapshots = await ctx.servers.refreshGuild(ctx.guild.id);

      if (snapshots.length === 0) {
        await ctx.invoker.edit(popPlaceholder());
        return;
      }

      await ctx.invoker.edit(
        popPayload({
          snapshots,
          config: ctx.guildConfig,
          showPlayers,
          details: ctx.options.boolean('details') ?? true,
          focus: slot,
          guildId: ctx.guild.id,
          pollSeconds: ctx.pollSeconds,
        }),
      );
    },
  },
  {
    name: 'ping',
    description: 'Health check: Discord ping, RCON ping and the public URL (Owner and Co-Owner, private)',
    prefixUsage: '!ping',
    minTier: 'coOwner',
    private: true,
    data: new SlashCommandBuilder().setName('ping').setDescription('Health check: Discord ping, RCON ping and the public URL'),
    async run(ctx) {
      await ctx.invoker.defer();

      await ctx.invoker.edit(
        await buildPingPayload({
          guild: ctx.guild,
          guildConfig: ctx.guildConfig,
          servers: ctx.servers,
          web: ctx.web ?? {},
          client: ctx.client ?? null,
          pollSeconds: ctx.pollSeconds ?? null,
          prefix: ctx.prefix ?? '!',
          prefixEnabled: ctx.prefixEnabled !== false,
          dms: ctx.dms ?? null,
          stats: ctx.stats ?? null,
        }),
      );
    },
  },

];

export function commandByName(name) {
  const wanted = String(name ?? '').toLowerCase();
  return commands.find((command) => command.name === wanted) ?? null;
}

/** The slash commands Discord should know about: only /setup. */
export function slashCommandData() {
  return commands.filter((command) => !command.prefixOnly).map((command) => command.data.toJSON());
}

/** Which server slot a guild command should talk to by default. */
export function defaultSlot(config, envServer = null) {
  return effectiveServers(config, envServer)[0]?.slot ?? 1;
}

/** Read a command's options the same way for slash commands and for !prefix. */
export function readOptions({ command, interaction, args = [] }) {
  if (interaction) {
    return {
      string: (name) => interaction.options.getString(name) ?? null,
      integer: (name) => interaction.options.getInteger(name) ?? null,
      boolean: (name) => interaction.options.getBoolean(name) ?? null,
    };
  }

  const map = {};
  const definitions = command.data.options ?? [];
  definitions.forEach((definition, index) => {
    const raw = args[index];
    if (raw === undefined) return;
    if (definition.type === 4) map[definition.name] = Number.parseInt(raw, 10);
    else if (definition.type === 5) map[definition.name] = ['true', 'yes', '1', 'on'].includes(String(raw).toLowerCase());
    else map[definition.name] = raw;
  });

  return {
    string: (name) => map[name] ?? null,
    integer: (name) => (Number.isFinite(map[name]) ? map[name] : null),
    boolean: (name) => (typeof map[name] === 'boolean' ? map[name] : null),
  };
}

/** What the user asked for, for the command log. Never includes a secret. */
export function describeOptions(command, interaction = null, args = []) {
  if (interaction) {
    return (interaction.options?.data ?? []).slice(0, 6).map((option) => ({
      name: option.name,
      value: String(option.value).slice(0, 80),
    }));
  }

  const definitions = command.data.options ?? [];
  return args.slice(0, 6).map((value, index) => ({
    name: definitions[index]?.name ?? 'arg' + (index + 1),
    value: String(value).slice(0, 80),
  }));
}

/**
 * Check access, run the command and report any failure to the caller.
 * Returns { ok, tier, error }.
 */
export async function dispatch(command, ctx) {
  const gate = canRun({
    member: ctx.member,
    user: ctx.user,
    guild: ctx.guild,
    roles: ctx.guildConfig?.roles ?? null,
    minTier: command.minTier ?? null,
    ownerOnly: Boolean(command.ownerOnly),
    botOwnerIds: ctx.botOwnerIds,
  });

  if (!gate.allowed) {
    await ctx.invoker.reply({ embeds: [deniedEmbed(command, gate)] });
    return { ok: false, tier: gate.tier, error: 'permission denied' };
  }

  try {
    await command.run(ctx);
    return { ok: true, tier: gate.tier, error: null };
  } catch (error) {
    await ctx.invoker.fail(error);
    return { ok: false, tier: gate.tier, error: error.message };
  }
}

export function deniedEmbed(command, gate) {
  const embed = baseEmbed({ color: COLORS.danger })
    .setTitle('⛔ Not allowed')
    .setDescription((gate.reason ?? 'You do not have the role for this command.') + '\n\n-# Roles are configured with /setup.');

  if (command.minTier) {
    embed.addFields({
      name: 'Who can use /' + command.name,
      value: TIERS.filter((tier) => tier.rank >= (tierById(command.minTier)?.rank ?? 99))
        .map((tier) => tier.emoji + ' ' + tier.label)
        .join(', '),
      inline: false,
    });
  }

  return embed;
}
