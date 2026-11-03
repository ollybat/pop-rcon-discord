import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ChannelRelay, formatChatMessage } from '../src/relay.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };
const CHANNEL = '111111111111111111';
const OTHER = '222222222222222222';

function makeClient({ text = true, failFor = null, channelId = CHANNEL } = {}) {
  const sent = [];
  let fetches = 0;
  return {
    sent,
    get fetches() {
      return fetches;
    },
    client: {
      channels: {
        fetch: async (id) => {
          fetches += 1;
          if (failFor && id === failFor) throw new Error('Unknown Channel');
          return {
            id,
            isTextBased: () => text,
            send: async (content) => {
              sent.push({ id: id ?? channelId, content });
              return { id: 'm1' };
            },
          };
        },
      },
    },
  };
}

test('formatChatMessage says who, where and what', () => {
  assert.equal(
    formatChatMessage({ message: 'gg wp', raw: { Username: 'Olly', Channel: 'global' } }),
    '**[Rust global] Olly:** gg wp',
  );
  assert.match(formatChatMessage({ message: 'hi', raw: {} }), /\[Rust global\] unknown:/);
  assert.equal(formatChatMessage({ message: 'x'.repeat(2000), raw: { Username: 'A' } }).length < 1600, true, 'a long line is cut, not rejected by Discord');
});

test('a channel from /setup wins over the env channel, per guild', async () => {
  const { client, sent } = makeClient();
  const relay = new ChannelRelay({
    client,
    channelId: '999999999999999999',
    channelIdFor: (guildId) => (guildId === 'g1' ? CHANNEL : guildId === 'g2' ? OTHER : null),
    logger: silentLogger,
  });

  assert.equal(relay.channelFor('g1'), CHANNEL);
  assert.equal(relay.channelFor('g2'), OTHER);
  assert.equal(relay.channelFor('g3'), '999999999999999999', 'the env channel is the fallback');

  assert.equal(await relay.chat({ message: 'hello', raw: { Username: 'Olly' } }, 'g1'), true);
  assert.equal(sent[0].id, CHANNEL);
  assert.match(sent[0].content, /\*\*Olly:\*\* hello/);
});

test('with nothing configured the relay does nothing at all', async () => {
  const { client, sent } = makeClient();
  const relay = new ChannelRelay({ client, logger: silentLogger });

  assert.equal(relay.enabled, false);
  assert.equal(await relay.chat({ message: 'hi', raw: {} }, 'g1'), false);
  assert.equal(sent.length, 0);
});

test('a guild that never picked a channel falls back, and one that did not is skipped', async () => {
  const { client, sent } = makeClient();
  const relay = new ChannelRelay({ client, channelIdFor: (guildId) => (guildId === 'g1' ? CHANNEL : null), logger: silentLogger });

  assert.equal(relay.enabled, true, 'a store-backed relay is enabled');
  assert.equal(await relay.send('hi', 'g2'), false, 'no channel for that guild');
  assert.equal(await relay.send('hi', 'g1'), true);
  assert.equal(sent.length, 1);
});

test('a broken channel is not cached, and a non-text channel is refused', async () => {
  const broken = makeClient({ failFor: CHANNEL });
  const relay = new ChannelRelay({ client: broken.client, channelId: CHANNEL, logger: silentLogger });

  assert.equal(await relay.send('one'), false);
  assert.equal(await relay.send('two'), false);
  assert.equal(broken.fetches, 2, 'it tries again instead of caching the failure');

  const notText = makeClient({ text: false });
  const other = new ChannelRelay({ client: notText.client, channelId: CHANNEL, logger: silentLogger });
  assert.equal(await other.send('hi'), false);
  assert.equal(notText.sent.length, 0);
});

test('a working channel is fetched once and reused', async () => {
  const { client, sent } = makeClient();
  const relay = new ChannelRelay({ client, channelId: CHANNEL, logger: silentLogger });

  await relay.send('one');
  await relay.send('two');
  assert.equal(sent.length, 2);
  assert.equal(relay.channels.size, 1);
});
