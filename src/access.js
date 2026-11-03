import { COLORS, EMOJI } from './theme.js';
import { baseEmbed } from './embeds.js';

/**
 * One bot, one Discord server. Two ways to say which one:
 *
 *   ALLOWED_GUILD_IDS  - an explicit list in the environment, the strongest statement.
 *   claimed            - nothing configured, so the bot locks itself to the guilds that have
 *                        already saved a configuration. The server that set it up keeps it.
 *
 * With neither, the bot is open - which is the honest state before anybody has set it up.
 */
export function lockFrom({ allowed = [], claimed = [] } = {}) {
  const explicit = (Array.isArray(allowed) ? allowed : []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (explicit.length > 0) return { ids: new Set(explicit), mode: 'explicit' };

  const seen = (Array.isArray(claimed) ? claimed : []).map((id) => String(id ?? '').trim()).filter(Boolean);
  if (seen.length > 0) return { ids: new Set(seen), mode: 'claimed' };

  return { ids: new Set(), mode: 'open' };
}

/** Does this guild get to use the bot? */
export function accessDecision(lock, guildId) {
  const id = guildId === null || guildId === undefined ? '' : String(guildId);
  if (!id) return { allowed: false, reason: 'that is not a Discord server' };
  if (!lock || lock.mode === 'open') return { allowed: true, reason: null };
  if (lock.ids.has(id)) return { allowed: true, reason: null };

  return {
    allowed: false,
    reason: lock.mode === 'explicit' ? 'this bot is set up for another server' : 'another server has already claimed this bot',
  };
}

/** A refusal that tells the truth and looks like it belongs to the brand. */
export function lockedEmbed({ lock = null, guild = null, brand = 'Spinback' } = {}) {
  const scope =
    lock && lock.mode === 'explicit'
      ? 'only answers in the servers it was set up for'
      : 'answers in one Discord server: the one whose setup has been saved';

  return baseEmbed({ color: COLORS.warning })
    .setTitle(EMOJI.lock + ' This bot belongs to one server')
    .setDescription(
      (guild ? '**' + guild.name + '** is not the server this bot looks after.' : 'This is not the server this bot looks after.') +
        '\n\n**' + brand + ' pop bot** ' + scope + '. It will not answer here, and nothing from this' +
        ' server is stored or forwarded anywhere.',
    )
    .addFields(
      {
        name: '👑 If this bot is yours',
        value: 'Remove it from this server and invite it to the one you set it up in. The welcome guide in your DMs (or `/setup`) is where it is configured.',
        inline: false,
      },
      {
        name: '📦 What the bot holds',
        value: 'One configuration per server it serves: roles, channels and RCON details. It does not read or copy anything else.',
        inline: false,
      },
    );
}

/**
 * The gate the event handlers ask before doing anything guild-shaped.
 * `refresh()` re-reads the claimed guild list, so a fresh /setup claims the bot without a restart.
 */
export function createGuildGate({ store = null, logger = console, allowed = [], leaveUnknown = false, brand = 'Spinback', getGuild = null } = {}) {
  const state = { lock: null };

  const claimed = () => (store && typeof store.listGuildIds === 'function' ? store.listGuildIds() : []);
  const refresh = () => {
    const before = state.lock;
    state.lock = lockFrom({ allowed, claimed: claimed() });

    if (!before || before.mode !== state.lock.mode || before.mode === 'open') {
      logger.info?.(
        '[access] ' +
          (state.lock.mode === 'open'
            ? 'open - no server has claimed this bot yet, the first /setup will claim it'
            : state.lock.mode + ' - serving ' + state.lock.ids.size + ' server(s)'),
      );
    }

    // Two saved setups means two servers think this bot is theirs: say so, and point at the fix.
    if (state.lock.mode === 'claimed' && state.lock.ids.size > 1) {
      logger.warn?.('[access] more than one server has a saved setup - set ALLOWED_GUILD_IDS to name the one this bot really serves');
    }

    return state.lock;
  };

  refresh();

  return {
    get lock() {
      return state.lock;
    },
    refresh,
    allows(guildId) {
      return accessDecision(state.lock, guildId).allowed;
    },
    check(guildId) {
      return accessDecision(state.lock, guildId);
    },
    /** Tell a stranger's server that it is a stranger's server, and leave if that is switched on. */
    async turnAway(guild) {
      const embed = lockedEmbed({ lock: state.lock, guild, brand });
      const channel = guild?.systemChannel ?? (guild?.channels?.cache?.find?.((entry) => entry.isTextBased?.() && entry.viewable) ?? null);

      if (channel) await channel.send({ embeds: [embed] }).catch(() => {});
      logger.warn?.('[access] refused ' + (guild?.name ?? 'an unknown server') + ' (' + (guild?.id ?? '?') + ')');

      if (leaveUnknown) {
        logger.warn?.('[access] leaving ' + (guild?.name ?? guild?.id) + ' as asked');
        await guild?.leave?.().catch?.(() => {});
      }

      return { refused: true, left: Boolean(leaveUnknown) };
    },
  };
}
