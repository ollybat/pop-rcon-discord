import { EmbedBuilder } from 'discord.js';

/** The one place that decides how an in-game chat line looks in Discord. */
export function formatChatMessage({ message, raw }) {
  const username = raw?.Username || 'unknown';
  const channel = raw?.Channel || 'global';
  return '**[' + channel + '] ' + username + ':** ' + message;
}

/**
 * Posts RCON events into one Discord channel.
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

  async chat({ message, raw }) {
    return this.send(formatChatMessage({ message, raw }));
  }

  async rconConnected(target) {
    return this.send({
      embeds: [new EmbedBuilder().setColor(0x3ba55d).setDescription('RCON connected to ' + target)],
    });
  }

  async rconDisconnected({ code, reason }) {
    const suffix = reason ? ': ' + reason : '';
    return this.send({
      embeds: [new EmbedBuilder().setColor(0xed4245).setDescription('RCON disconnected (code ' + code + suffix + ')')],
    });
  }
}
