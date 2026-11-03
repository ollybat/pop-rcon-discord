import { dmAutoReplyEmbed, dmForwardEmbed, dmRelayEmbed, dmRelayUsageEmbed } from './embeds.js';
import { scrubSecrets, truncate } from './format.js';

/** One auto-reply per sender per window, so a bored visitor cannot make the bot chatter. */
export const AUTO_REPLY_COOLDOWN_MS = 5 * 60 * 1000;
/** Forwards per sender per window, so nobody can flood the owners. */
export const FORWARD_LIMIT = 10;
export const FORWARD_WINDOW_MS = 15 * 60 * 1000;
/** How much of a DM we repeat to the owners. */
export const MAX_MESSAGE_LENGTH = 1200;
/** How long a sender stays "answerable" with !reply. */
export const ANSWERABLE_WINDOW_MS = 24 * 60 * 60 * 1000;

const HELP_PATTERNS = [
  /\bhelp\b/i,
  /\bhow do i\b/i,
  /\bhow can i\b/i,
  /\bcan you\b/i,
  /\bcould you\b/i,
  /\bplease\b/i,
  /\badmin/i,
  /\bban\b/i,
  /\bkick\b/i,
  /\bunban\b/i,
  /\bwhitelist\b/i,
  /\breport\b/i,
  /\bproblem\b/i,
  /\bissue\b/i,
  /\bbroken\b/i,
  /\boffline\b/i,
  /\bdown\b/i,
  /\bwipe\b/i,
  /\bwhy\b/i,
  /\?$/,
];

/** Does this DM read like somebody asking the clan for help? */
export function looksLikeHelpRequest(text) {
  const value = String(text ?? '').trim();
  if (!value) return false;
  return HELP_PATTERNS.some((pattern) => pattern.test(value));
}

/** Every id that should hear about a DM: the bot owners, extra ids, then each shared server owner. */
export function ownerTargets({ botOwnerIds = [], extraIds = [], guilds = [], exclude = [] } = {}) {
  const skip = new Set(exclude.map(String));
  const ids = [];

  for (const id of [...botOwnerIds, ...extraIds]) {
    const value = id ? String(id) : null;
    if (value && !skip.has(value) && !ids.includes(value)) ids.push(value);
  }

  for (const guild of guilds) {
    const value = guild?.ownerId ? String(guild.ownerId) : null;
    if (value && !skip.has(value) && !ids.includes(value)) ids.push(value);
  }

  return ids;
}

/** The servers the bot and this user are both in, newest membership first. */
export async function sharedGuilds(client, userId) {
  const found = [];

  for (const guild of client.guilds.cache.values()) {
    const cached = guild.members?.cache?.has?.(userId);
    if (cached) {
      found.push(guild);
      continue;
    }

    const member = await guild.members?.fetch?.(userId).catch(() => null);
    if (member) found.push(guild);
  }

  return found;
}

/**
 * Direct messages: acknowledge the sender, then pass the message to the clan owners (in their DMs
 * and in the staff channel when one is configured). Owners can answer with
 * `!reply <user id> <message>`, which the bot delivers as a DM from them.
 */
export function createDmRelay({
  client,
  store = null,
  logs = null,
  logger = console,
  options = {},
} = {}) {
  const enabled = options.enabled !== false;
  const botOwnerIds = options.botOwnerIds ?? [];
  const extraIds = options.forwardIds ?? [];
  const forwardStrangers = options.forwardStrangers === true;
  const autoReplyCooldownMs = options.autoReplyCooldownMs ?? AUTO_REPLY_COOLDOWN_MS;
  const forwardLimit = options.forwardLimit ?? FORWARD_LIMIT;
  const forwardWindowMs = options.forwardWindowMs ?? FORWARD_WINDOW_MS;
  const answerableWindowMs = options.answerableWindowMs ?? ANSWERABLE_WINDOW_MS;
  const prefix = options.prefix ?? '!';
  const maxLength = options.maxLength ?? MAX_MESSAGE_LENGTH;
  const now = options.now ?? (() => Date.now());
  const counters = options.stats ?? null;

  const replied = new Map();
  const forwarded = new Map();
  const answerable = new Map();

  function shouldAutoReply(userId, at = now()) {
    const last = replied.get(String(userId)) ?? 0;
    return at - last >= autoReplyCooldownMs;
  }

  function markReplied(userId, at = now()) {
    replied.set(String(userId), at);
  }

  function allowForward(userId, at = now()) {
    const key = String(userId);
    const recent = (forwarded.get(key) ?? []).filter((stamp) => at - stamp < forwardWindowMs);
    forwarded.set(key, recent);
    return recent.length < forwardLimit;
  }

  function markForwarded(userId, at = now()) {
    const key = String(userId);
    const recent = forwarded.get(key) ?? [];
    recent.push(at);
    forwarded.set(key, recent);
  }

  /** Who recently wrote to us, so !reply can only answer real conversations. */
  function isAnswerable(userId, at = now()) {
    const seen = answerable.get(String(userId)) ?? 0;
    return at - seen < answerableWindowMs;
  }

  function markAnswerable(userId, at = now()) {
    answerable.set(String(userId), at);
  }

  /** Is this user allowed to relay an answer back to someone? */
  async function isOwner(user) {
    const id = String(user?.id ?? '');
    if (!id) return false;
    if (botOwnerIds.map(String).includes(id) || extraIds.map(String).includes(id)) return true;

    for (const guild of client.guilds.cache.values()) {
      if (String(guild.ownerId ?? '') === id) return true;
    }

    return false;
  }

  function textOf(message) {
    const content = String(message?.content ?? '').trim();
    if (content) return content;
    const attachments = message?.attachments?.size ?? message?.attachments?.length ?? 0;
    return attachments > 0 ? '*(sent ' + attachments + ' attachment' + (attachments === 1 ? '' : 's') + ' with no text)*' : '';
  }

  /** `!reply <user id> <message>` - only owners, only to somebody who wrote to the bot. */
  async function handleRelay(message) {
    const raw = String(message.content ?? '').trim();
    const body = raw.slice((prefix + 'reply').length).trim();
    const [targetId, ...rest] = body.split(/\s+/);
    const answer = rest.join(' ').trim();

    if (!targetId || !answer) {
      await message.reply({ embeds: [dmRelayUsageEmbed(prefix)] }).catch(() => {});
      return true;
    }

    if (!(await isOwner(message.author))) {
      await message.reply({ embeds: [dmRelayUsageEmbed(prefix, 'Only the Spinback owners can relay an answer.')] }).catch(() => {});
      return true;
    }

    if (!isAnswerable(targetId)) {
      await message.reply({
        embeds: [dmRelayUsageEmbed(prefix, 'That user id has not written to me recently, so I will not message them.')],
      }).catch(() => {});
      return true;
    }

    const target = await client.users.fetch(targetId).catch(() => null);
    if (!target) {
      await message.reply({ embeds: [dmRelayUsageEmbed(prefix, 'I could not find that user.')] }).catch(() => {});
      return true;
    }

    const sent = await target
      .send({ embeds: [dmRelayEmbed({ from: message.author, text: truncate(answer, maxLength) })] })
      .catch(() => null);

    if (sent) counters?.inc?.('dmReplied');

    await message
      .reply({
        embeds: [
          dmRelayUsageEmbed(
            prefix,
            sent ? '✅ Sent to **' + (target.username ?? targetId) + '**.' : '⚠️ I could not DM them - they may have DMs closed.',
          ),
        ],
      })
      .catch(() => {});

    return true;
  }

  /** The whole DM path: acknowledge, then forward. Returns true when this was a DM we handled. */
  async function handle(message) {
    if (!enabled) return false;
    if (!message || message.guild) return false;
    if (!message.author || message.author.bot) return false;

    const at = now();
    const text = textOf(message);
    const raw = String(message.content ?? '').trim();

    if (raw.toLowerCase().startsWith((prefix + 'reply').toLowerCase())) return handleRelay(message);

    const guilds = await sharedGuilds(client, message.author.id).catch(() => []);
    const help = looksLikeHelpRequest(text);
    const mayForward = (guilds.length > 0 || forwardStrangers) && allowForward(message.author.id, at);
    const wantReply = shouldAutoReply(message.author.id, at);

    if (mayForward) {
      markAnswerable(message.author.id, at);
      markForwarded(message.author.id, at);

      const targets = ownerTargets({ botOwnerIds, extraIds, guilds, exclude: [message.author.id] });
      const embed = () => dmForwardEmbed({
        user: message.author,
        guilds,
        text: truncate(scrubSecrets(text), maxLength),
        help,
        at: new Date(at).toISOString(),
        prefix,
      });

      let delivered = 0;
      for (const id of targets) {
        const owner = await client.users.fetch(id).catch(() => null);
        if (!owner) continue;
        const sent = await owner.send({ embeds: [embed()] }).catch(() => null);
        if (sent) delivered += 1;
      }

      if (logs) {
        for (const guild of guilds) await logs.staff?.(guild.id, { embeds: [embed()] }).catch(() => false);
      }

      counters?.inc?.('dmForwarded', Math.max(1, delivered));
      logger.info?.('[dm] ' + (help ? 'help request' : 'message') + ' from ' + message.author.username + ' -> ' + delivered + ' owner(s)');

      if (wantReply) markReplied(message.author.id, at);
      if (wantReply) counters?.inc?.('dmAnswered');
      if (wantReply) {
        await message.channel
          .send({ embeds: [dmAutoReplyEmbed({ user: message.author, guilds, prefix, forwarded: delivered > 0, help })] })
          .catch(() => {});
      }

      return true;
    }

    // Nothing to forward (a stranger, or too many messages): still be polite, once in a while.
    if (wantReply) counters?.inc?.('dmAnswered');
    if (wantReply) {
      markReplied(message.author.id, at);
      await message.channel
        .send({ embeds: [dmAutoReplyEmbed({ user: message.author, guilds, prefix, forwarded: false, help })] })
        .catch(() => {});
    }

    return true;
  }

  return {
    enabled,
    handle,
    isAnswerable,
    markAnswerable,
    shouldAutoReply,
    markReplied,
    allowForward,
    markForwarded,
    reset() {
      replied.clear();
      forwarded.clear();
      answerable.clear();
    },
  };
}
