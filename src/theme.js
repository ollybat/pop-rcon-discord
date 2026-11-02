/** Spinback branding: one place for the name, the light blue palette and the tier labels. */
export const BRAND = {
  name: 'Spinback',
  tagline: 'Spinback pop bot',
  serverDefault: 'Spinback 5X EU',
  clan: 'Spinback clan',
  version: '0.6.0',
};

/** Light blue is the brand colour; the rest stay semantic so status is still readable. */
export const COLORS = {
  brand: 0x5bc8f5,
  brandSoft: 0x8fdcff,
  success: 0x63d2b4,
  warning: 0xf0c674,
  danger: 0xe4687a,
  muted: 0x8fa8bb,
  online: 0x5bc8f5,
  resting: 0xf0c674,
  offline: 0xe4687a,
};

export const STATUS = {
  online: { emoji: '🟢', label: 'Online', color: COLORS.online },
  resting: { emoji: '🟡', label: 'Resting', color: COLORS.resting },
  offline: { emoji: '🔴', label: 'Offline', color: COLORS.offline },
};

export const EMOJI = {
  players: '👥',
  queue: '⏳',
  ping: '📶',
  map: '🗺️',
  uptime: '⏱️',
  framerate: '🎞️',
  entities: '🏗️',
  owner: '👑',
  roles: '🎭',
  logs: '📋',
  servers: '🖥️',
  ok: '✅',
  missing: '➖',
  denied: '⛔',
};

/** Staff tiers, highest first. `required` blocks the setup wizard until it is filled in. */
export const TIERS = [
  {
    id: 'owner',
    label: 'Owner Role',
    emoji: '👑',
    rank: 5,
    required: true,
    description: 'Full control of the bot: setup, console access and every staff command.',
  },
  {
    id: 'coOwner',
    label: 'Co-Owner Role',
    emoji: '🛡️',
    rank: 4,
    required: false,
    description: 'Everything Head Admin can do, plus raw console access.',
  },
  {
    id: 'headAdmin',
    label: 'Head Admin Role',
    emoji: '⚔️',
    rank: 3,
    required: false,
    description: 'Bans, kicks, chat broadcasts and player tools.',
  },
  {
    id: 'admin',
    label: 'Admin Role',
    emoji: '🔧',
    rank: 2,
    required: false,
    description: 'Kicks and chat broadcasts.',
  },
  {
    id: 'moderator',
    label: 'Moderator Role',
    emoji: '🔨',
    rank: 1,
    required: false,
    description: 'Read-only staff tools: player lists and population checks.',
  },
];

export const TIER_IDS = TIERS.map((tier) => tier.id);

/** Names the wizard looks for when it guesses your existing staff roles. */
export const TIER_MATCHERS = {
  owner: ['owner', 'founder', 'leader', 'boss', 'chief'],
  coOwner: ['co-owner', 'co owner', 'coowner', 'deputy', 'vice'],
  headAdmin: ['head admin', 'headadmin', 'head-admin', 'senior admin', 'super admin', 'manager'],
  admin: ['admin', 'administrator'],
  moderator: ['moderator', 'mod ', 'mods', 'helper', 'staff', 'trial'],
};

/** Channels the Quick setup button creates when you have none yet. */
export const LOG_CHANNEL_PRESETS = {
  joinLeave: { name: '🚪・joins-leaves', topic: 'Spinback: who joins and leaves the Rust servers' },
  commands: { name: '⌨️・staff-commands', topic: 'Spinback: every staff command, who ran it and the outcome' },
  errors: { name: '🚨・bot-errors', topic: 'Spinback: RCON and bot errors' },
  status: { name: '📡・server-status', topic: 'Spinback: connects, disconnects and setup changes' },
};

export const CATEGORY_PRESET = { name: '🎧 Spinback' };

export function tierById(id) {
  return TIERS.find((tier) => tier.id === id) ?? null;
}

export function tierRank(id) {
  const tier = tierById(id);
  return tier ? tier.rank : 0;
}

/** Log destinations the wizard can fill in. */
export const LOG_KINDS = [
  {
    id: 'joinLeave',
    label: 'Join & Leave',
    emoji: '🚪',
    description: 'Who connects to a server and who leaves, with session length.',
  },
  {
    id: 'commands',
    label: 'Command Log',
    emoji: '⌨️',
    description: 'Every staff command: who ran it, where, with what options and how it ended.',
  },
  {
    id: 'errors',
    label: 'Error Log',
    emoji: '🚨',
    description: 'RCON failures, permission problems and unhandled errors.',
  },
  {
    id: 'status',
    label: 'Server Status',
    emoji: '📡',
    description: 'Connects, disconnects and restarts, plus setup changes.',
  },
];

export const LOG_KIND_IDS = LOG_KINDS.map((kind) => kind.id);

export function logKindById(id) {
  return LOG_KINDS.find((kind) => kind.id === id) ?? null;
}

export function footerText(extra) {
  return extra ? BRAND.name + ' • ' + extra : BRAND.tagline;
}
