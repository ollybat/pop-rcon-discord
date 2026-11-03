import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  ChannelType,
  ModalBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { guideEmbed, hintEmbed, logsEmbed, panelEmbed, rolesEmbed, serversEmbed } from '../embeds.js';
import { BRAND, COLORS, LOG_KINDS, PRESENCE_LINES, STATUS, TIERS, tierById } from '../theme.js';
import { maskPassword } from '../format.js';
import { formatPresence, presenceFor } from '../presence.js';
import { MAX_SERVERS, describeConfig } from '../store.js';

export const SETUP_ID = 'sb:setup';

export function parseCustomId(customId) {
  const parts = String(customId ?? '').split(':');
  if (parts[0] !== 'sb' || parts[1] !== 'setup') return null;
  return { action: parts[2] ?? 'main', args: parts.slice(3) };
}

function button(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

export function mainPanel(config, { snapshots = [], guild = null } = {}) {
  const status = describeConfig(config);

  const top = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':view:roles', 'Roles', '🎭', ButtonStyle.Primary),
    button(SETUP_ID + ':view:logs', 'Logs', '📋', ButtonStyle.Primary),
    button(SETUP_ID + ':view:servers', 'Servers', '🖥️', ButtonStyle.Primary),
    button(SETUP_ID + ':refresh', 'Refresh', '🔄', ButtonStyle.Secondary),
    button(SETUP_ID + ':done', 'Done', '✅', ButtonStyle.Success),
  );

  const bottom = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':quick', status.ready ? 'Finish up' : 'Quick setup', '⚡', ButtonStyle.Success),
    button(SETUP_ID + ':matchroles', 'Guess roles', '🪄', ButtonStyle.Secondary),
    button(SETUP_ID + ':createlogs', 'Make channels', '📁', ButtonStyle.Secondary),
    button(SETUP_ID + ':guide', 'Guide', '📖', ButtonStyle.Secondary),
    button(SETUP_ID + ':reset', 'Reset', '🧹', ButtonStyle.Danger),
  );

  const tests = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':testlogs', 'Test channels', '🧪', ButtonStyle.Secondary),
    button(SETUP_ID + ':testping', 'Health check', '🏓', ButtonStyle.Secondary),
    button(SETUP_ID + ':view:board', 'Live board', '📌', ButtonStyle.Primary),
  );

  // Its own row: five buttons whose labels add up to 61 characters is wider than Discord allows,
  // and "The specified component exceeds the maximum width" is not a message anybody can act on.
  const views = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':view:status', 'Status line', '🟢', ButtonStyle.Primary),
    button(SETUP_ID + ':guidedm', 'DM me the guide', '📬', ButtonStyle.Secondary),
  );

  return { embeds: [panelEmbed({ guild, config, snapshots })], components: [top, bottom, tests, views] };
}

export function rolesView(config) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':role')
    .setPlaceholder('Pick a role to change')
    .addOptions(
      TIERS.map((tier) => ({
        label: tier.label,
        value: tier.id,
        emoji: tier.emoji,
        description: (config.roles?.[tier.id] ? 'Set' : 'Not set') + (tier.required ? ' • required' : ''),
      })),
    );

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':matchroles', 'Guess roles', '🪄', ButtonStyle.Success),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [rolesEmbed({ config })], components: [new ActionRowBuilder().addComponents(select), row] };
}

export function rolePickView(config, tierId) {
  const tier = tierById(tierId);
  if (!tier) return rolesView(config);

  const select = new RoleSelectMenuBuilder().setCustomId(SETUP_ID + ':roleset:' + tier.id).setPlaceholder('Pick the ' + tier.label);
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':roleclear:' + tier.id, 'Clear', '🧹', ButtonStyle.Danger).setDisabled(tier.required),
    button(SETUP_ID + ':view:roles', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return {
    embeds: [
      hintEmbed(
        tier.emoji + ' ' + tier.label,
        tier.description +
          '\n\nCurrently: ' +
          (config.roles?.[tier.id] ? '<@&' + config.roles[tier.id] + '>' : 'not set') +
          (tier.required ? '\nThis one is required, so it can be changed but not cleared.' : ''),
      ),
    ],
    components: [new ActionRowBuilder().addComponents(select), row],
  };
}

export function logsView(config) {
  // One picker per row is all Discord allows (a select menu takes the whole row), and five rows is
  // the whole message, so the kinds are chosen first and the channel picked on the next screen -
  // exactly like the roles flow. Two selects side by side is rejected outright.
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':logpick')
    .setPlaceholder('Pick a log channel to set')
    .addOptions(
      LOG_KINDS.map((kind) => ({
        label: kind.label,
        value: kind.id,
        emoji: kind.emoji,
        description: config?.logs?.[kind.id] ? 'Set — change or clear it' : 'Not set yet',
      })),
    );

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':testlogs', 'Send test', '🧪', ButtonStyle.Secondary),
    button(SETUP_ID + ':createlogs', 'Make channels', '📁', ButtonStyle.Success),
    button(SETUP_ID + ':logclear', 'Clear all', '🧹', ButtonStyle.Danger),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [logsEmbed({ config })], components: [new ActionRowBuilder().addComponents(select), row] };
}

/** One log channel: the picker, and a Clear for a channel that is already set. */
export function logPickView(config, kindId) {
  const kind = LOG_KINDS.find((entry) => entry.id === kindId);
  if (!kind) return logsView(config);

  const current = config?.logs?.[kind.id] ?? null;
  const select = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':logset:' + kind.id)
    .setPlaceholder(kind.emoji + ' Pick the ' + kind.label + ' channel')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':logclearone:' + kind.id, 'Clear', '🧹', ButtonStyle.Danger).setDisabled(!current),
    button(SETUP_ID + ':view:logs', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return {
    embeds: [
      hintEmbed(
        kind.emoji + ' ' + kind.label,
        [
          kind.description ?? 'Pick the channel this kind of message goes to.',
          '',
          'Currently: ' + (current ? '<#' + current + '>' : 'not set'),
        ].join('\n'),
      ),
    ],
    components: [new ActionRowBuilder().addComponents(select), row],
  };
}

/**
 * The live board: one message per server that keeps itself current, plus the milestone switches.
 * Kept in its own view because it is the one part of setup members notice every day.
 */
export function boardView(config, { snapshots = [], guild = null } = {}) {
  const boardConfig = config.board ?? { channelId: null, messageId: null, enabled: false };
  const master = config.alerts?.enabled !== false;
  const milestonesOn = master && config.alerts?.milestones !== false;
  const outageOn = master && config.alerts?.outage !== false;

  const select = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':boardset')
    .setPlaceholder('📌 Channel for the live board')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  const rows = [
    new ActionRowBuilder().addComponents(select),
    new ActionRowBuilder().addComponents(
      button(SETUP_ID + ':boardtoggle', boardConfig.enabled ? 'Pause it' : 'Keep it live', '🔴', boardConfig.enabled ? ButtonStyle.Secondary : ButtonStyle.Success).setDisabled(
        !boardConfig.channelId,
      ),
      button(SETUP_ID + ':boardpost', 'Post it now', '📤', ButtonStyle.Secondary).setDisabled(!boardConfig.channelId),
      button(SETUP_ID + ':alertstoggle', milestonesOn ? 'Milestones on' : 'Milestones off', milestonesOn ? '🔔' : '🔕', milestonesOn ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(SETUP_ID + ':outagetoggle', outageOn ? 'Outages on' : 'Outages off', outageOn ? '🚨' : '🔕', outageOn ? ButtonStyle.Success : ButtonStyle.Secondary),
      button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
    ),
  ];

  const digestConfig = config.digest ?? { enabled: false, channelId: null, hour: null };
  const digestSelect = new ChannelSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':digestset')
    .setPlaceholder('📊 Channel for the daily digest')
    .setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)
    .setMinValues(0)
    .setMaxValues(1);

  rows.push(new ActionRowBuilder().addComponents(digestSelect));
  rows.push(
    new ActionRowBuilder().addComponents(
      button(SETUP_ID + ':digesttoggle', digestConfig.enabled ? 'Digest on' : 'Digest off', '📊', digestConfig.enabled ? ButtonStyle.Success : ButtonStyle.Secondary).setDisabled(!digestConfig.channelId),
      button(SETUP_ID + ':digesthour', 'Send at ' + String(digestConfig.hour ?? 20).padStart(2, '0') + ':00 UTC', '🕗', ButtonStyle.Secondary),
      button(SETUP_ID + ':digestpreview', 'Preview it', '👀', ButtonStyle.Secondary),
    ),
  );

  return { embeds: [boardEmbed({ config, snapshots, guild })], components: rows };
}

function boardEmbed({ config, snapshots = [] } = {}) {
  const boardConfig = config.board ?? {};
  const digestConfig = config.digest ?? {};
  const master = config.alerts?.enabled !== false;
  const milestonesOn = master && config.alerts?.milestones !== false;
  const outageOn = master && config.alerts?.outage !== false;
  const lines = [];

  if (boardConfig.channelId && boardConfig.enabled) {
    lines.push('📌 **Live right now** in <#' + boardConfig.channelId + '>.');
    lines.push(boardConfig.messageId ? 'I will keep that one message up to date, and post a fresh one if somebody deletes it.' : 'It posts on the next pass and then keeps itself current.');
  } else if (boardConfig.channelId) {
    lines.push('⏸ **Paused.** The channel is set to <#' + boardConfig.channelId + '> — press 🔴 Keep it live to start it again.');
  } else {
    lines.push('**No channel yet.** Pick one above and the board starts on its own.');
  }

  lines.push(
    '',
    '**What it shows** — the same report as /pop: who is online, the queue, uptime, the day\'s peak and the shape of the last few readings.',
    '',
    'It refreshes every ' + (config.board?.intervalSeconds ?? 30) + 's, and skips an edit when nothing changed, so a quiet server costs nothing.',
    'Anyone can also press **🔴 Keep live** on a /pop answer to make that message update itself for a while.',
    '',
    milestonesOn
      ? '🔔 **Milestones on** — a new record for the day, the server filling up, the queue starting and a restart are announced in your status log channel.'
      : '🔕 **Milestones off** — no announcements for records, a full server, a moving queue or a restart.',
    '',
    outageOn
      ? '🚨 **Outages on** — a server that does not answer for 5 minutes is reported once, and once more when it comes back; the server owner also gets a direct message unless DMs are closed.'
      : '🔕 **Outages off** — nothing is said when a server stops answering.',
    '',
    digestConfig.enabled
      ? '📊 **Digest on** at ' + String(digestConfig.hour ?? 20).padStart(2, '0') + ':00 UTC in <#' + digestConfig.channelId + '> — yesterday\'s busiest moment, the week\'s average and the best day so far.'
      : digestConfig.channelId
        ? '📊 **Digest paused.** <#' + digestConfig.channelId + '> is ready — press 📊 Digest on to start it.'
        : '📊 **No digest yet.** Pick a channel below for a short "yesterday on the server" post once a day.',
  );

  const servers = snapshots.filter(Boolean).length;
  if (servers === 0 && boardConfig.channelId) {
    lines.push('', '⚠️ No server is configured yet, so there is nothing to put on the board — add one under **Servers**.');
  }

  return hintEmbed(
    '📌 Live board',
    lines.join('\n'),
    boardConfig.enabled && boardConfig.channelId ? COLORS.success : COLORS.brand,
  );
}

export function serversView(config, { snapshots = [] } = {}) {
  const select = new StringSelectMenuBuilder()
    .setCustomId(SETUP_ID + ':slots')
    .setPlaceholder('Pick a slot to add or edit a server')
    .addOptions(
      SLOTS.map((slot) => {
        const server = config.servers?.[slot - 1] ?? null;
        return {
          label: 'Slot ' + slot,
          value: String(slot),
          emoji: server ? '🎮' : '➕',
          description: server ? server.name + ' • ' + server.host + ':' + server.port : 'Empty — pick this to add a server',
        };
      }),
    );

  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':guide', 'Guide', '📖', ButtonStyle.Success),
    button(SETUP_ID + ':refresh', 'Test all', '📡', ButtonStyle.Secondary),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [serversEmbed({ config, snapshots })], components: [new ActionRowBuilder().addComponents(select), row] };
}

export function slotView(config, slot, snapshot = null) {
  const server = config.servers?.[slot - 1] ?? null;
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':slotedit:' + slot, server ? 'Edit' : 'Add', server ? '✏️' : '➕', ButtonStyle.Primary),
    button(SETUP_ID + ':slottest:' + slot, 'Test', '📡', ButtonStyle.Secondary),
    button(SETUP_ID + ':slotclear:' + slot, 'Remove', '🗑️', ButtonStyle.Danger).setDisabled(!server),
    button(SETUP_ID + ':view:servers', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  const state = snapshot ? (snapshot.connected ? (snapshot.info?.restarting ? 'resting' : 'online') : 'offline') : null;
  const lines = [
    server ? '**' + server.name + '**' : 'Nothing configured in slot ' + slot + ' yet.',
    server
      ? 'Address: \`' + server.host + ':' + server.port + '\` • password \`' + maskPassword(server.password) + '\`'
      : 'Press **Add** to fill in the name, address, RCON port and password.',
    state ? STATUS[state].emoji + ' ' + STATUS[state].label + (snapshot.latencyMs === null ? '' : ' • ' + snapshot.latencyMs + 'ms') : '',
    server ? 'Press **Test** to check it right now.' : '',
  ].filter(Boolean);

  return { embeds: [hintEmbed('🖥️ Server slot ' + slot, lines.join('\n\n'))], components: [row] };
}

function unusedMask(value) {
  const text = String(value ?? '');
  if (text.length <= 4) return '*'.repeat(text.length || 1);
  return text.slice(0, 2) + '*'.repeat(Math.max(3, text.length - 4)) + text.slice(-2);
}

export function serverModal(slot, server = null) {
  const name = new TextInputBuilder()
    .setCustomId('name')
    .setLabel('Server name')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(60)
    .setPlaceholder(BRAND.serverDefault);

  const host = new TextInputBuilder()
    .setCustomId('host')
    .setLabel('Server IP or host')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(120)
    .setPlaceholder('123.45.67.89');

  const port = new TextInputBuilder()
    .setCustomId('port')
    .setLabel('RCON port')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(5)
    .setValue(String(server?.port ?? 28016));

  const password = new TextInputBuilder()
    .setCustomId('password')
    .setLabel(server ? 'RCON password (blank keeps it)' : 'RCON password')
    .setStyle(TextInputStyle.Short)
    .setRequired(!server)
    .setMaxLength(200);

  if (server) {
    name.setValue(server.name);
    host.setValue(server.host);
  }

  return new ModalBuilder()
    .setCustomId(SETUP_ID + ':modalslot:' + slot)
    .setTitle('Server slot ' + slot)
    .addComponents(
      new ActionRowBuilder().addComponents(name),
      new ActionRowBuilder().addComponents(host),
      new ActionRowBuilder().addComponents(port),
      new ActionRowBuilder().addComponents(password),
    );
}

/**
 * The bot's own bio: the four lines it may wear, the one it wears right now, and the switch that
 * adds the PROBLEM state. A preview beats a description, so the live line is drawn by the very same
 * code the presence uses.
 */
export function statusView(config, { snapshots = [], guild = null, formats = PRESENCE_LINES, slot = null } = {}) {
  const problemOn = config?.presence?.problem !== false;
  const live = presenceFor(snapshotFor(snapshots), { formats, problem: problemOn });
  const status = STATUS[live.state] ?? STATUS.online;

  const vocabulary = ['online', 'offline', 'resting', 'problem']
    .map((state) =>
      !problemOn && state === 'problem'
        ? STATUS.problem.emoji + ' RCON ┆ PROBLEM  (switched off)'
        : formatPresence(formats[state] ?? PRESENCE_LINES[state], { players: 12, max: 100, queued: 5 }),
    )
    .join('\n');

  const problems = problemOn
    ? [
        '**On.** The line turns ' + STATUS.problem.emoji + ' while the server is reachable but not healthy:',
        '• RCON answers, but the server never replies to `serverinfo`',
        '• the map is running under 20 FPS',
        '• an RCON round-trip takes longer than 1.5 s',
      ]
    : [
        '**Off.** A reachable-but-slow server keeps the ' + STATUS.online.emoji + ' line, and a socket that never answers reads as ' + STATUS.offline.emoji + ' OFFLINE.',
        'Press ' + STATUS.problem.emoji + ' **PROBLEM on** to add the fourth state.',
      ];

  return {
    embeds: [
      hintEmbed(
        status.emoji + ' Status line — what this bot is doing, in one glance',
        [
          'This line is the bot\'s own bio, right under its name in the member list. It only ever says one of the four below, so a glance is never ambiguous about the server.',
          '',
          '**It says this right now:**',
          '```',
          live.text,
          '```',
          '-# ' + (slot ? 'Following slot ' + slot : 'Following every server that is online') + ' · rewritten on every poll, in a private channel or in public: it never carries an address.',
        ].join('\n'),
        status.color,
      )
        .addFields(
          { name: '📖 The whole vocabulary', value: '```\n' + vocabulary + '\n```', inline: false },
          { name: STATUS.problem.emoji + ' PROBLEM mode — ' + (problemOn ? 'on' : 'off'), value: problems.join('\n'), inline: false },
        ),
    ],
    components: [
      new ActionRowBuilder().addComponents(
        button(SETUP_ID + ':statustoggle', problemOn ? 'PROBLEM off' : 'PROBLEM on', STATUS.problem.emoji, problemOn ? ButtonStyle.Secondary : ButtonStyle.Success),
        button(SETUP_ID + ':statusrefresh', 'Say it again', '🔄', ButtonStyle.Secondary),
        button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
      ),
    ],
  };
}

/** The snapshot the line is actually drawn from: the first online one, or the first at all. */
function snapshotFor(snapshots = []) {
  const list = snapshots ?? [];
  return list.find((snapshot) => snapshot?.connected && snapshot.info) ?? list[0] ?? { connected: false, reconnecting: false, info: null };
}

export function guideView(config) {
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':view:servers', 'Servers', '🖥️', ButtonStyle.Primary),
    button(SETUP_ID + ':main', 'Back', '⬅️', ButtonStyle.Secondary),
  );

  return { embeds: [guideEmbed({ config })], components: [row] };
}

export function resetView(config) {
  const row = new ActionRowBuilder().addComponents(
    button(SETUP_ID + ':resetconfirm', 'Yes, wipe it', '🗑️', ButtonStyle.Danger),
    button(SETUP_ID + ':main', 'Cancel', '⬅️', ButtonStyle.Secondary),
  );

  return {
    embeds: [
      hintEmbed(
        '🧹 Reset everything?',
        'This clears the roles, the log channels, the servers **and** every saved password for this Discord server.\n' +
          'It cannot be undone. Add the servers again afterwards.',
        COLORS.danger,
      ),
    ],
    components: [row],
  };
}

export const SLOTS = Array.from({ length: MAX_SERVERS }, (_, index) => index + 1);
