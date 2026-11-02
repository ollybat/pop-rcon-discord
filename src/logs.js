import { COLORS } from './theme.js';
import { commandLogEmbed, errorLogEmbed, joinLeaveEmbed, statusLogEmbed } from './embeds.js';

/**
 * Posts bot events into the channels configured by /setup.
 * Everything goes through one queue so a burst of joins cannot trip Discord's rate limit.
 */
export class LogRouter {
  constructor({ client, store, logger = console, queueDelayMs = 250 }) {
    this.client = client;
    this.store = store;
    this.logger = logger;
    this.queueDelayMs = queueDelayMs;
    this.tail = Promise.resolve();
    this.channels = new Map();
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

  /** Serialise every post; failures are logged, never thrown at the caller. */
  enqueue(guildId, kind, payload) {
    const task = async () => {
      const channel = await this.resolveChannel(guildId, kind);
      if (!channel) {
        if (kind === 'errors') this.logger.error('[logs] ' + JSON.stringify(payload).slice(0, 300));
        return false;
      }

      try {
        await channel.send(payload);
        return true;
      } catch (error) {
        this.logger.warn('[logs] could not post to the ' + kind + ' channel: ' + error.message);
        return false;
      }
    };

    this.tail = this.tail.then(() => new Promise((resolve) => setTimeout(resolve, this.queueDelayMs))).then(task).catch(() => false);
    return this.tail;
  }

  joinLeave(guildId, details) {
    return this.enqueue(guildId, 'joinLeave', { embeds: [joinLeaveEmbed(details)] });
  }

  command(guildId, details) {
    return this.enqueue(guildId, 'commands', { embeds: [commandLogEmbed(details)] });
  }

  error(guildId, details) {
    this.logger.error('[error] ' + (details?.source ? details.source + ': ' : '') + (details?.message ?? ''));
    return this.enqueue(guildId, 'errors', { embeds: [errorLogEmbed(details)] });
  }

  status(guildId, { title, description, color = COLORS.brand }) {
    return this.enqueue(guildId, 'status', { embeds: [statusLogEmbed({ title, description, color })] });
  }
}
