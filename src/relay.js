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
  constructor({ client, channelId = null, channelIdFor = null, logger = console }) {
    this.client = client;
    // The channel can come from the env (one channel, every guild) or from /setup, per guild.
    this.channelId = channelId;
    this.channelIdFor = typeof channelIdFor === 'function' ? channelIdFor : null;
    this.logger = logger;
    this.channels = new Map();
  }

  /** What /setup saved for this guild, else the env channel, else nothing. */
  channelFor(guildId) {
    const configured = this.channelIdFor ? this.channelIdFor(guildId) : null;
    return configured ?? this.channelId ?? null;
  }

  get enabled() {
    return Boolean(this.channelId || this.channelIdFor);
  }

  async send(content, guildId = null) {
    const channelId = this.channelFor(guildId);
    if (!channelId) return false;

    try {
      let channel = this.channels.get(channelId);
      if (!channel) {
        channel = await this.client.channels.fetch(channelId);
        if (!channel || !channel.isTextBased()) {
          this.logger.warn('[relay] channel ' + channelId + ' is not a text channel');
          return false;
        }
        this.channels.set(channelId, channel);
      }

      await channel.send(content);
      return true;
    } catch (error) {
      // Never cache a channel that failed: it may have been deleted or re-created.
      this.channels.delete(channelId);
      this.logger.warn('[relay] could not post to ' + channelId + ': ' + error.message);
      return false;
    }
  }

  async chat(event, guildId = null) {
    return this.send(formatChatMessage(event), guildId);
  }
}
