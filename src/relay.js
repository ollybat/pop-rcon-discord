/** Optional: mirrors Rust in-game chat into one Discord channel. */

/** The one place that decides how an in-game chat line looks in Discord. */
export function formatChatMessage({ message, raw }) {
  const username = raw?.Username ?? raw?.Name ?? 'unknown';
  const channel = raw?.Channel ?? 'global';
  return '**[Rust ' + channel + '] ' + username + ':** ' + String(message ?? '').slice(0, 1500);
}

/**
 * Posts RCON chat events into one Discord channel.
 * Does nothing at all when no channel is configured, and re-resolves the
 * channel after a failure instead of caching a broken one.
 */
export class ChannelRelay {
  constructor({ client, channelId = null, logger = console }) {
    this.client = client;
    this.channelId = channelId;
    this.logger = logger;
    this.channel = null;
  }

  get enabled() {
    return Boolean(this.channelId);
  }

  async send(content) {
    if (!this.enabled) return false;

    try {
      if (!this.channel) this.channel = await this.client.channels.fetch(this.channelId);

      if (!this.channel || !this.channel.isTextBased()) {
        this.logger.warn('[relay] channel ' + this.channelId + ' is not a text channel');
        this.channel = null;
        return false;
      }

      await this.channel.send(content);
      return true;
    } catch (error) {
      this.channel = null;
      this.logger.warn('[relay] could not post to ' + this.channelId + ': ' + error.message);
      return false;
    }
  }

  async chat(event) {
    return this.send(formatChatMessage(event));
  }
}
