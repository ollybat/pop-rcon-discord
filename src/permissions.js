import { TIERS, TIER_MATCHERS, tierById, tierRank } from './theme.js';

/** Highest configured tier a member holds, or null when they hold none. */
export function tierOfMember(member, roles) {
  if (!member || !member.roles || !roles) return null;

  const held = member.roles.cache ?? new Map();
  let best = null;

  for (const [tierId, roleId] of Object.entries(roles)) {
    if (!roleId) continue;
    if (!held.has(roleId)) continue;
    if (!tierById(tierId)) continue;
    if (best === null || tierRank(tierId) > tierRank(best)) best = tierId;
  }

  return best;
}

/**
 * Guess the staff roles from the names already in the server, so nobody has to hand-pick
 * five roles to get started. Roles that are already set are kept, and Discord's own
 * integration roles (bots, boosters) are ignored.
 * Returns { roles, matched, unmatched }.
 */
export function matchRolesByName(available, current = {}) {
  const roles = [...(available?.values?.() ?? available ?? [])].filter(
    (role) => role && role.id && !role.managed && role.name && role.name !== '@everyone',
  );

  const result = { ...current };
  const matched = [];
  const unmatched = [];

  for (const tier of TIERS) {
    if (result[tier.id]) continue;

    const wanted = TIER_MATCHERS[tier.id] ?? [];
    const found = roles
      .filter((role) => wanted.some((needle) => String(role.name).toLowerCase().includes(needle)))
      .sort((a, b) => (b.position ?? 0) - (a.position ?? 0))
      .at(0);

    if (found) {
      result[tier.id] = found.id;
      matched.push(tier.id);
    } else {
      unmatched.push(tier.id);
    }
  }

  return { roles: result, matched, unmatched };
}

export function isBotOwner(userId, botOwnerIds = []) {
  return Boolean(userId) && botOwnerIds.map(String).includes(String(userId));
}

export function isGuildOwner(interactionOrMember) {
  const guild = interactionOrMember?.guild ?? null;
  const member = interactionOrMember?.member ?? guild?.ownerId ?? null;
  const userId = member?.id ?? interactionOrMember?.user?.id ?? null;
  const ownerId = guild?.ownerId ?? null;
  return Boolean(ownerId) && Boolean(userId) && String(ownerId) === String(userId);
}

/**
 * The one gate every command goes through.
 * Returns { allowed, tier, reason } - reason is shown to the user when they are refused.
 */
export function canRun({ member, user, guild, roles, minTier = null, ownerOnly = false, botOwnerIds = [] }) {
  const userId = user?.id ?? member?.id ?? null;

  if (ownerOnly) {
    if (isBotOwner(userId, botOwnerIds)) return { allowed: true, tier: 'botOwner', reason: null };
    if (guild && String(guild.ownerId) === String(userId)) return { allowed: true, tier: 'guildOwner', reason: null };
    return {
      allowed: false,
      tier: null,
      reason: 'Only the Discord server owner (or the bot owner) can use this.',
    };
  }

  if (isBotOwner(userId, botOwnerIds)) return { allowed: true, tier: 'botOwner', reason: null };
  if (guild && String(guild.ownerId) === String(userId)) return { allowed: true, tier: 'guildOwner', reason: null };

  const tier = tierOfMember(member, roles);
  if (!minTier) return { allowed: true, tier, reason: null };

  if (tier && tierRank(tier) >= tierRank(minTier)) return { allowed: true, tier, reason: null };

  const needed = tierById(minTier);
  return {
    allowed: false,
    tier,
    reason: needed
      ? 'You need the ' + needed.emoji + ' ' + needed.label + ' (or higher) to use this. Ask an owner to run /setup.'
      : 'You are not allowed to use this command.',
  };
}

/** Human-readable ladder, used in /setup and in the refusal message. */
export function tierLadder() {
  return TIERS.slice()
    .sort((a, b) => b.rank - a.rank)
    .map((tier) => tier.emoji + ' ' + tier.label)
    .join(' → ');
}

export function canRunSetup({ member, user, guild, botOwnerIds = [] }) {
  return canRun({ member, user, guild, roles: null, ownerOnly: true, botOwnerIds });
}
