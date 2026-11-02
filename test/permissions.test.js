import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canRun, canRunSetup, isBotOwner, isGuildOwner, tierLadder, tierOfMember } from '../src/permissions.js';

const roles = { owner: '100', coOwner: '200', headAdmin: '300', admin: '400', moderator: '500' };

function member(...roleIds) {
  return { id: 'user-1', roles: { cache: new Map(roleIds.map((id) => [id, { id }])) } };
}

test('tierOfMember returns the highest configured tier', () => {
  assert.equal(tierOfMember(member('400', '500'), roles), 'admin');
  assert.equal(tierOfMember(member('500'), roles), 'moderator');
  assert.equal(tierOfMember(member('999'), roles), null);
  assert.equal(tierOfMember(member(), roles), null);
  assert.equal(tierOfMember(null, roles), null);
});

test('isGuildOwner compares the owner id', () => {
  const guild = { ownerId: 'user-1' };
  assert.equal(isGuildOwner({ guild, user: { id: 'user-1' } }), true);
  assert.equal(isGuildOwner({ guild, user: { id: 'user-2' } }), false);
  assert.equal(isGuildOwner({ guild: null, user: { id: 'user-1' } }), false);
});

test('isBotOwner only trusts the configured ids', () => {
  assert.equal(isBotOwner('7', ['7']), true);
  assert.equal(isBotOwner(7, ['7']), true);
  assert.equal(isBotOwner('8', ['7']), false);
  assert.equal(isBotOwner(null, ['7']), false);
});

test('canRun lets the server owner and bot owner through everything', () => {
  const guild = { ownerId: 'owner-id' };
  const ownerGate = canRun({ member: member(), user: { id: 'owner-id' }, guild, roles, minTier: 'owner' });
  assert.equal(ownerGate.allowed, true);
  assert.equal(ownerGate.tier, 'guildOwner');

  const botGate = canRun({ member: member(), user: { id: '7' }, guild, roles, minTier: 'owner', botOwnerIds: ['7'] });
  assert.equal(botGate.allowed, true);
  assert.equal(botGate.tier, 'botOwner');
});

test('canRun gates staff commands by tier rank', () => {
  const guild = { ownerId: 'owner-id' };

  assert.equal(canRun({ member: member('500'), user: { id: 'u' }, guild, roles, minTier: 'moderator' }).allowed, true);
  assert.equal(canRun({ member: member('500'), user: { id: 'u' }, guild, roles, minTier: 'admin' }).allowed, false);
  assert.equal(canRun({ member: member('300'), user: { id: 'u' }, guild, roles, minTier: 'admin' }).allowed, true);
  assert.equal(canRun({ member: member('100'), user: { id: 'u' }, guild, roles, minTier: 'coOwner' }).allowed, true);

  const denied = canRun({ member: member(), user: { id: 'u' }, guild, roles, minTier: 'admin' });
  assert.equal(denied.allowed, false);
  assert.match(denied.reason, /Admin Role/);
  assert.match(denied.reason, /\/setup/);
});

test('canRun with no minimum tier only checks the setup gate', () => {
  const guild = { ownerId: 'owner-id' };
  assert.equal(canRun({ member: member(), user: { id: 'u' }, guild, roles }).allowed, true);
  assert.equal(canRun({ member: member(), user: { id: 'u' }, guild, roles, minTier: null }).tier, null);
});

test('canRunSetup is owner-only', () => {
  const guild = { ownerId: 'owner-id' };
  assert.equal(canRunSetup({ member: member('100'), user: { id: 'user-1' }, guild }).allowed, false);
  assert.equal(canRunSetup({ member: member('100'), user: { id: 'owner-id' }, guild }).allowed, true);
  assert.equal(canRunSetup({ member: member(), user: { id: 'user-1' }, guild, botOwnerIds: ['user-1'] }).allowed, true);
});

test('tierLadder lists every tier from the top down', () => {
  const ladder = tierLadder();
  assert.match(ladder, /👑 Owner Role/);
  assert.ok(ladder.indexOf('👑') < ladder.indexOf('🔨'));
});
