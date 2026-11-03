import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RCON_START_LINE, guildOwnerOf, onboardingEmbeds, sendGuideTo, welcomeOwner } from '../src/onboarding.js';

const quiet = { info() {}, warn() {}, error() {}, debug() {} };

function inbox({ fail = false } = {}) {
  const received = [];
  const warnings = [];
  return {
    user: {
      id: 'owner1',
      username: 'olly',
      send: async (payload) => {
        if (fail) throw new Error('Cannot send messages to this user');
        received.push(payload);
        return payload;
      },
    },
    received,
    logger: { ...quiet, warn: (line) => warnings.push(line) },
  };
}

function guild({ id = 'g1', name = 'Spinback', ownerId = 'owner1', systemChannel = null, fetchOwner = null } = {}) {
  return {
    id,
    name,
    ownerId,
    systemChannel,
    fetchOwner: fetchOwner ?? (async () => inboxUser),
    channels: { cache: { find: () => systemChannel } },
    members: { me: {} },
  };
}

const inboxUser = { id: 'owner1', username: 'olly' };

test('the guide is three branded embeds with no secret in them', () => {
  const embeds = onboardingEmbeds({ guild: { name: 'Spinback HQ' }, prefix: '!' });
  assert.equal(embeds.length, 3);

  for (const embed of embeds) {
    assert.equal(embed.data.footer.text, 'Powered by Spinback');
    assert.match(embed.data.title, /\S/);
  }

  const first = embeds[0].data.description;
  assert.match(first, /Spinback HQ/, 'it names the server it just joined');
  assert.match(first, /`\/setup`/, 'and points at the panel');
  assert.match(first, /`!pop`/, 'and at the public command');
  assert.match(first, /never reaches a channel/, 'and promises the password stays private');

  const steps = embeds[1].data.description;
  assert.match(steps, /Servers/);
  assert.match(steps, /Test channels/);
  assert.match(steps, /rcon\.web 1/);
  assert.ok(steps.includes(RCON_START_LINE.slice(0, 40)), 'the start line is spelled out');

  const trouble = embeds[2].data.description;
  assert.match(trouble, /Message Content Intent/);
  assert.match(trouble, /applications\.commands/);
  assert.match(trouble, /!reply/);
});

test('the guide follows the configuration', () => {
  const off = onboardingEmbeds({ prefixEnabled: false, dmEnabled: false });
  assert.match(off[0].data.description, /`\/pop`/, 'no prefix commands, so the slash form');
  assert.ok(!off[0].data.description.includes('prefix'), 'no mention of a prefix it does not have');
  assert.ok(!off[0].data.description.includes('writes to me in a DM'), 'nor of DMs it cannot answer');
  assert.match(off[0].data.description, /your server/, 'an unknown guild still reads properly');
});

test('sendGuideTo reports whether Discord accepted the DM', async () => {
  const good = inbox();
  assert.equal(await sendGuideTo({ user: good.user, guild: { name: 'Spinback' }, logger: good.logger }), true);
  assert.equal(good.received.length, 1);
  assert.equal(good.received[0].embeds.length, 3);

  const closed = inbox({ fail: true });
  assert.equal(await sendGuideTo({ user: closed.user, guild: { name: 'Spinback' }, logger: closed.logger }), false);
  assert.match(closed.warnings.join(' '), /could not DM/);
  assert.equal(await sendGuideTo({ user: null }), false);
});

test('guildOwnerOf tries fetchOwner first and falls back to the user cache', async () => {
  const fetched = await guildOwnerOf(guild({ fetchOwner: async () => ({ id: 'owner1', username: 'olly' }) }));
  assert.equal(fetched.username, 'olly');

  const broken = guild({ fetchOwner: async () => { throw new Error('nope'); } });
  broken.client = { users: { fetch: async () => ({ id: 'owner1', username: 'cached' }) } };
  assert.equal((await guildOwnerOf(broken)).username, 'cached');

  assert.equal(await guildOwnerOf(null), null);
  assert.equal(await guildOwnerOf({ id: 'g1' }), null, 'no owner id, no owner');
});

test('inviting the bot DMs the owner the guide once', async () => {
  const owner = inbox();
  const seen = new Set();
  const target = guild({ fetchOwner: async () => owner.user, systemChannel: null });

  const first = await welcomeOwner({ guild: target, logger: quiet, seen, prefix: '!', dmEnabled: true });
  assert.equal(first.delivered, true);
  assert.equal(owner.received.length, 1);

  const second = await welcomeOwner({ guild: target, logger: quiet, seen });
  assert.equal(second.delivered, false);
  assert.equal(second.reason, 'already welcomed');
  assert.equal(owner.received.length, 1, 'and not twice');
});

test('a closed DM is answered in the server instead of vanishing', async () => {
  const owner = inbox({ fail: true });
  const posted = [];
  const channel = { type: 0, send: async (payload) => (posted.push(payload), payload), permissionsFor: () => ({ has: () => true }) };
  const target = guild({ fetchOwner: async () => owner.user, systemChannel: channel });

  const result = await welcomeOwner({ guild: target, logger: quiet, seen: new Set() });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'dm closed');
  assert.equal(posted.length, 1, 'the note goes to the server');
  assert.match(posted[0].embeds[0].data.description, /direct messages from server members/);
  assert.match(posted[0].embeds[0].data.description, /\/setup/);
  assert.equal(posted[0].embeds[0].data.footer.text, 'Powered by Spinback');
});

test('no owner means nothing is sent anywhere', async () => {
  const target = guild({ ownerId: null, fetchOwner: async () => null });
  const result = await welcomeOwner({ guild: target, logger: quiet, seen: new Set() });
  assert.equal(result.delivered, false);
  assert.equal(result.reason, 'no owner');
  assert.equal((await welcomeOwner({ guild: null })).reason, 'no guild');
});
