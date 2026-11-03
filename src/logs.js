import { COLORS } from './theme.js';
import { scrubSecrets } from './format.js';
import { commandLogEmbed, errorLogEmbed, joinLeaveEmbed, statusLogEmbed } from './embeds.js';

/**
 * Posts bot events into the channels configured by /setup.
 * Everything goes through one queue so a burst of joins cannot trip Discord's rate limit.
 */
export class LogRouter {
  constructor({
    client,
    store,
    logger = console,
    queueDelayMs = 250,
    // One problem, one message: a repeat inside this window updates the first message instead of
    // posting another. The count is what makes it useful - nobody wants nineteen copies of the
    // same timeout, everybody wants to know it happened nineteen times.
    repeatWindowMs = 15 * 60 * 1000,
    quietMs = 60 * 1000,
    // At most one update per half minute: a 20-second poll cannot turn one fault into 18 edits.
    editThrottleMs = 30 * 1000,
    now = () => new Date(),
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.client = client;
    this.store = store;
    this.logger = logger;
    this.queueDelayMs = queueDelayMs;
    this.repeatWindowMs = repeatWindowMs;
    this.quietMs = quietMs;
    this.editThrottleMs = editThrottleMs;
    this.now = now;
    this.setTimer = setTimer;
    this.clearTimer = clearTimer;
    this.tail = Promise.resolve();
    this.channels = new Map();
    this.repeats = new Map();
  }

  /** Every secret this guild has stored, so a log line can never contain one. */
  secretsFor(guildId) {
    const servers = this.store.get(guildId)?.servers;
    if (!Array.isArray(servers)) return [];
    return servers.filter(Boolean).map((server) => server.password).filter(Boolean);
  }

  kindFor(guildId, kind) {
    return this.store.get(guildId)?.logs?.[kind] ?? null;
  }

  async resolveChannel(guildId, kind) {
    const channelId = this.kindFor(guildId, kind);
    if (!channelId) return null;

    const key = guildId + ':' + kind + ':' + channelId;
    if (this.channels.has(key)) return this.channels.get(key);

    try {
      const channel = await this.client.channels.fetch(channelId);
      if (!channel || !channel.isTextBased()) {
        this.logger.warn('[logs] ' + kind + ' channel ' + channelId + ' is not a text channel');
        return null;
      }
      this.channels.set(key, channel);
      return channel;
    } catch (error) {
      this.logger.warn('[logs] cannot open the ' + kind + ' channel ' + channelId + ': ' + error.message);
      return null;
    }
  }

  /** Serialise every post and edit; failures are logged, never thrown at the caller. */
  enqueueTask(task) {
    this.tail = this.tail
      .then(() => new Promise((resolve) => setTimeout(resolve, this.queueDelayMs)))
      .then(task)
      .catch((error) => {
        this.logger.warn?.('[logs] ' + (error?.message ?? error));
        return false;
      });
    return this.tail;
  }

  /** Resolves with the sent message (or false), so a caller can keep talking about it. */
  enqueue(guildId, kind, payload) {
    return this.enqueueTask(async () => {
      const channel = await this.resolveChannel(guildId, kind);
      if (!channel) {
        if (kind === 'errors') this.logger.error('[logs] ' + JSON.stringify(payload).slice(0, 300));
        return false;
      }

      const sent = await channel.send(payload).catch((error) => {
        this.logger.warn('[logs] could not post to the ' + kind + ' channel: ' + error.message);
        return null;
      });
      return sent ?? false;
    });
  }

  joinLeave(guildId, details) {
    return this.enqueue(guildId, 'joinLeave', { embeds: [joinLeaveEmbed(details)] });
  }

  command(guildId, details) {
    return this.enqueue(guildId, 'commands', { embeds: [commandLogEmbed(details)] });
  }

  /** Post an arbitrary payload into the staff channel - used for forwarded direct messages. */
  staff(guildId, payload) {
    return this.enqueue(guildId, 'commands', payload);
  }

  /** Identical fault = same source, same message, same place. */
  errorKey(guildId, details) {
    return [guildId, details.source ?? '', details.message ?? '', details.context ?? ''].join('|');
  }

  /**
   * Report a fault. The first one is posted in full; a repeat inside the window edits that same
   * message with a running count, and once it stops the message says so. One outage is then one
   * message, however many polls it broke.
   */
  error(guildId, details = {}) {
    const secrets = this.secretsFor(guildId);
    const safe = {
      ...details,
      source: scrubSecrets(details.source, secrets),
      message: scrubSecrets(details.message, secrets),
      context: scrubSecrets(details.context, secrets),
      stack: scrubSecrets(details.stack, secrets),
    };

    const key = this.errorKey(guildId, safe);
    const at = this.now();
    const entry = this.repeats.get(key);
    if (entry && at.getTime() - entry.lastAt.getTime() < this.repeatWindowMs) {
      return this.repeatError(guildId, key, entry, safe, at);
    }

    this.logger.error('[error] ' + (safe.source ? safe.source + ': ' : '') + (safe.message ?? ''));

    return this.enqueue(guildId, 'errors', { embeds: [errorLogEmbed(safe)] }).then((sent) => {
      const fresh = {
        messageId: sent && sent.id ? sent.id : null,
        count: 1,
        firstAt: at,
        lastAt: at,
        lastEditAt: at,
        quiet: false,
        quietTimer: null,
        details: safe,
      };
      this.repeats.set(key, fresh);
      this.scheduleQuiet(guildId, key, fresh);
      return sent;
    });
  }

  /** The same fault again: count it, keep the original message honest, stay quiet on the console. */
  repeatError(guildId, key, entry, safe, at) {
    entry.count += 1;
    entry.lastAt = at;
    entry.quiet = false;
    this.scheduleQuiet(guildId, key, entry);
    this.logger.debug?.('[error] repeat x' + entry.count + ' - ' + (safe.source ? safe.source + ': ' : '') + (safe.message ?? ''));

    if (at.getTime() - entry.lastEditAt.getTime() < this.editThrottleMs) return Promise.resolve(false);
    return this.editRepeat(guildId, key, entry);
  }

  /** When the fault stops, say so once. */
  scheduleQuiet(guildId, key, entry) {
    if (entry.quietTimer) this.clearTimer(entry.quietTimer);
    entry.quietTimer = this.setTimer(() => {
      entry.quietTimer = null;
      entry.quiet = true;
      this.editRepeat(guildId, key, entry);
    }, this.quietMs);
    entry.quietTimer?.unref?.();
  }

  /** Rewrite the original error message with the running count, and with the all-clear. */
  editRepeat(guildId, key, entry) {
    if (!entry.messageId) return Promise.resolve(false);
    entry.lastEditAt = this.now();

    const details = {
      ...entry.details,
      repeat: { count: entry.count, firstAt: entry.firstAt, lastAt: entry.lastAt, quiet: Boolean(entry.quiet) },
    };

    return this.enqueueTask(async () => {
      const channel = await this.resolveChannel(guildId, 'errors');
      const message = channel?.messages?.fetch ? await channel.messages.fetch(entry.messageId).catch(() => null) : null;
      if (!message) {
        // Deleted, or no permission: forget it, so the next occurrence is posted again.
        if (entry.quietTimer) this.clearTimer(entry.quietTimer);
        entry.quietTimer = null;
        this.repeats.delete(key);
        return false;
      }

      return message.edit({ embeds: [errorLogEmbed(details)] }).then(() => true).catch((error) => {
        this.logger.warn?.('[logs] could not update the error message: ' + error.message);
        return false;
      });
    });
  }

  /** Drop every remembered fault (shutdown, and the tests). */
  forgetRepeats() {
    for (const entry of this.repeats.values()) if (entry.quietTimer) this.clearTimer(entry.quietTimer);
    this.repeats.clear();
  }

  status(guildId, { title, description, color = COLORS.brand }) {
    const secrets = this.secretsFor(guildId);
    return this.enqueue(guildId, 'status', {
      embeds: [statusLogEmbed({ title: scrubSecrets(title, secrets), description: scrubSecrets(description, secrets), color })],
    });
  }
}
