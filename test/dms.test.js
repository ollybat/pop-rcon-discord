import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDmRelay, looksLikeHelpRequest, ownerTargets, sharedGuilds } from '../src/dms.js';

function fakeGuild({ id = 'g1', name = 'Spinback HQ', ownerId = 'owner1', members = [] } = {}) {
  const ids = new Set(members.map(String));
  return {
    id,
    name,
    ownerId,
    members: {
      cache: { has: (userId) => ids.has(String(userId)) },
      fetch: async (userId) => (ids.has(String(userId)) ? { id: String(userId) } : null),
    },
  };
}

function fakeClient({ guilds = [], users = {} } = {}) {
  const cache = new Map();
  for (const guild of guilds) cache.set(guild.id, guild);
  return { guilds: { cache }, users: { fetch: async (id) => users[String(id)] ?? null } };
}

function fakeDm({ id = 'u1', username = 'alpha', content = 'hello', attachments = 0 } = {}) {
  const sent = [];
  const replies = [];
  return {
    guild: null,
    author: { id, username, bot: false },
    content,
    attachments: { size: attachments },
    channel: { send: async (payload) => (sent.push(payload), payload) },
    reply: async (payload) => (replies.push(payload), payload),
    sent,
    replies,
  };
}

function inboxFor(id, username = id) {
  const received = [];
  return { user: { id, username, send: async (payload) => (received.push(payload), payload) }, received };
}

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

test('looksLikeHelpRequest spots the messages that need a human', () => {
  assert.equal(looksLikeHelpRequest('can you unban my friend please'), true);
  assert.equal(looksLikeHelpRequest('why is the server offline?'), true);
  assert.equal(looksLikeHelpRequest('is the wipe tonight'), true);
  assert.equal(looksLikeHelpRequest('gg'), false);
  assert.equal(looksLikeHelpRequest(''), false);
  assert.equal(looksLikeHelpRequest(null), false);
});

test('ownerTargets dedupes, keeps the order and never includes the sender', () => {
  const targets = ownerTargets({
    botOwnerIds: ['boss', 'owner1'],
    extraIds: ['boss', 'extra'],
    guilds: [{ ownerId: 'owner1' }, { ownerId: 'owner2' }, { ownerId: null }],
    exclude: ['extra', null],
  });

  assert.deepEqual(targets, ['boss', 'owner1', 'owner2']);
  assert.deepEqual(ownerTargets(), []);
});

test('sharedGuilds checks the member cache and then asks Discord', async () => {
  const client = fakeClient({
    guilds: [fakeGuild({ id: 'a', members: ['u1'] }), fakeGuild({ id: 'b', members: ['u1'] }), fakeGuild({ id: 'c', members: ['other'] })],
  });

  const found = await sharedGuilds(client, 'u1');
  assert.deepEqual(found.map((guild) => guild.id), ['a', 'b']);
  assert.deepEqual(await sharedGuilds(fakeClient(), 'u1'), []);
});

test('a DM from a member is answered and passed to the owners', async () => {
  const owner = inboxFor('owner1', 'olly');
  const boss = inboxFor('boss', 'spare');
  const client = fakeClient({ guilds: [fakeGuild({ members: ['u1'] })], users: { owner1: owner.user, boss: boss.user } });
  const mirrored = [];
  const logs = { staff: async (guildId, payload) => (mirrored.push({ guildId, payload }), true) };

  const relay = createDmRelay({ client, logs, logger: quiet, options: { botOwnerIds: ['boss'], prefix: '!' } });
  const message = fakeDm({ content: 'can you unban my friend please' });

  assert.equal(await relay.handle(message), true);
  assert.equal(message.sent.length, 1, 'the sender gets one answer back');
  assert.match(message.sent[0].embeds[0].data.title, /Spinback support/);
  assert.match(message.sent[0].embeds[0].data.description, /on its way to the clan owners/);

  assert.equal(owner.received.length, 1, 'the server owner is told');
  assert.equal(boss.received.length, 1, 'and so is the bot owner');
  assert.match(owner.received[0].embeds[0].data.title, /Help request from alpha/);
  assert.match(owner.received[0].embeds[0].data.description, /unban my friend/);
  assert.match(JSON.stringify(owner.received[0].embeds[0].data.fields), /u1/, 'the user id is in there');
  assert.match(JSON.stringify(owner.received[0].embeds[0].data.fields), /!reply u1/, 'and how to answer');

  assert.equal(mirrored.length, 1, 'it also lands in the staff channel');
  assert.equal(mirrored[0].guildId, 'g1');
});

test('the sender is answered once per cooldown, and strangers are not forwarded', async () => {
  const owner = inboxFor('owner1');
  const client = fakeClient({ guilds: [fakeGuild({ members: ['u1'] })], users: { owner1: owner.user } });
  const relay = createDmRelay({ client, logger: quiet, options: { autoReplyCooldownMs: 60000 } });

  const first = fakeDm({ content: 'hi' });
  const second = fakeDm({ content: 'hi again' });
  await relay.handle(first);
  await relay.handle(second);

  assert.equal(first.sent.length, 1);
  assert.equal(second.sent.length, 0, 'no second auto reply inside the cooldown');
  assert.equal(owner.received.length, 2, 'both messages still reach the owner');

  const stranger = createDmRelay({
    client: fakeClient({ guilds: [fakeGuild({ members: ['someone-else'] })], users: { owner1: owner.user } }),
    logger: quiet,
    options: {},
  });
  const strangerMessage = fakeDm({ id: 'u9', username: 'driftwood', content: 'add me on your server' });
  await stranger.handle(strangerMessage);

  assert.equal(strangerMessage.sent.length, 1, 'still polite');
  assert.match(strangerMessage.sent[0].embeds[0].data.description, /send it again from the Discord server/);
  assert.equal(owner.received.length, 2, 'but a stranger does not reach the owner');
});

test('a sender cannot flood the owners', async () => {
  const owner = inboxFor('owner1');
  const client = fakeClient({ guilds: [fakeGuild({ members: ['u1'] })], users: { owner1: owner.user } });
  const relay = createDmRelay({ client, logger: quiet, options: { forwardLimit: 2 } });

  for (let index = 0; index < 4; index += 1) await relay.handle(fakeDm({ content: 'message ' + index }));

  assert.equal(owner.received.length, 2, 'only the first two are forwarded');
});

test('an owner answers with !reply and it reaches the member', async () => {
  const member = inboxFor('u1', 'alpha');
  const client = fakeClient({ guilds: [fakeGuild({ ownerId: 'owner1', members: ['u1'] })], users: { u1: member.user } });
  const relay = createDmRelay({ client, logger: quiet, options: { prefix: '!' } });
  relay.markAnswerable('u1');

  const message = fakeDm({ id: 'owner1', username: 'olly', content: '!reply u1 you are unbanned, sorry about that' });
  assert.equal(await relay.handle(message), true);

  assert.equal(member.received.length, 1);
  assert.match(member.received[0].embeds[0].data.title, /Answer from Spinback staff/);
  assert.match(member.received[0].embeds[0].data.description, /unbanned/);
  assert.match(JSON.stringify(message.replies.at(-1).embeds[0].data), /Sent to/);
});

test('!reply refuses strangers, unknown users and missing arguments', async () => {
  const member = inboxFor('u1', 'alpha');
  const client = fakeClient({ guilds: [fakeGuild({ ownerId: 'owner1', members: ['u1'] })], users: { u1: member.user } });
  const relay = createDmRelay({ client, logger: quiet, options: {} });

  const notOwner = fakeDm({ id: 'u7', username: 'random', content: '!reply u1 hello' });
  await relay.handle(notOwner);
  assert.equal(member.received.length, 0);
  assert.match(JSON.stringify(notOwner.replies.at(-1).embeds[0].data), /Only the Spinback owners/);

  relay.markAnswerable('u1');
  const unknown = fakeDm({ id: 'owner1', content: '!reply 999 hello' });
  await relay.handle(unknown);
  assert.match(JSON.stringify(unknown.replies.at(-1).embeds[0].data), /has not written to me recently/);

  const silent = fakeDm({ id: 'owner1', content: '!reply' });
  await relay.handle(silent);
  assert.match(JSON.stringify(silent.replies.at(-1).embeds[0].data), /Relay an answer/);
  assert.equal(member.received.length, 0);
});

test('the relay ignores bots, server messages and a disabled switch', async () => {
  const client = fakeClient({ guilds: [fakeGuild({ members: ['u1'] })] });
  const relay = createDmRelay({ client, logger: quiet, options: {} });

  const fromBot = { guild: null, author: { id: 'b', bot: true }, content: 'hi', channel: { send: async () => null } };
  assert.equal(await relay.handle(fromBot), false, 'bots are ignored');
  assert.equal(await relay.handle({ guild: { id: 'g1' }, author: { id: 'u1', bot: false }, content: 'hi' }), false, 'server messages are not DMs');

  const off = createDmRelay({ client, logger: quiet, options: { enabled: false } });
  assert.equal(await off.handle(fakeDm()), false);
});
