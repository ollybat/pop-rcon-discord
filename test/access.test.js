import assert from 'node:assert/strict';
import { test } from 'node:test';
import { accessDecision, createGuildGate, lockFrom, lockedEmbed } from '../src/access.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

function fakeStore(ids = []) {
  const set = new Set(ids.map(String));
  return { listGuildIds: () => [...set], claim(id) { set.add(String(id)); } };
}

test('lockFrom prefers the explicit list, then the servers that claimed the bot', () => {
  assert.equal(lockFrom().mode, 'open');
  assert.deepEqual([...lockFrom().ids], []);

  assert.equal(lockFrom({ allowed: ['1', '2'] }).mode, 'explicit');
  assert.deepEqual([...lockFrom({ allowed: [1, 2] }).ids], ['1', '2'], 'ids are stored as strings');
  assert.equal(lockFrom({ allowed: ['  ', ''] }).mode, 'open', 'blank entries are not a claim');

  assert.equal(lockFrom({ claimed: ['1553825462315257868'] }).mode, 'claimed');
  assert.deepEqual([...lockFrom({ claimed: [1234] }).ids], ['1234'], 'a numeric id is stored as its string');

  const both = lockFrom({ allowed: ['1'], claimed: ['9'] });
  assert.equal(both.mode, 'explicit', 'the environment wins over what the data directory says');
  assert.equal(both.ids.has('9'), false);
});

test('accessDecision lets one server in and tells the others why not', () => {
  const claimed = lockFrom({ claimed: ['1553825462315257868'] });
  assert.deepEqual(accessDecision(claimed, '1553825462315257868'), { allowed: true, reason: null });

  const stranger = accessDecision(claimed, '999');
  assert.equal(stranger.allowed, false);
  assert.match(stranger.reason, /claimed/);

  assert.equal(accessDecision(claimed, null).allowed, false, 'no guild id is not a pass');
  assert.equal(accessDecision(claimed, undefined).allowed, false);
  assert.equal(accessDecision(lockFrom({ claimed: ['1234'] }), 1234).allowed, true, 'a number id still matches');

  assert.equal(accessDecision(lockFrom(), 'anything').allowed, true, 'an unclaimed bot is open');
  assert.match(accessDecision(lockFrom({ allowed: ['1'] }), '2').reason, /another server/);
});

test('the refusal is branded, honest and free of secrets', () => {
  const embed = lockedEmbed({ lock: lockFrom({ claimed: ['1'] }), guild: { id: '2', name: 'Someone Else' }, brand: 'Spinback' });
  const data = embed.data;

  assert.match(data.title, /belongs to one server/);
  assert.match(data.description, /Someone Else/);
  assert.equal(data.footer.text, 'Powered by Spinback');
  assert.match(data.fields.at(-1).value, /configuration/);
  assert.ok(!JSON.stringify(data).includes('1553825462315257868'), 'no other server id leaks into the refusal');

  const claimed = lockedEmbed({ lock: lockFrom({ claimed: ['1'] }), guild: { id: '2', name: 'Someone Else' } });
  assert.match(claimed.data.description, /the one whose setup has been saved/);

  const anonymous = lockedEmbed({ lock: lockFrom({ allowed: ['1'] }) });
  assert.match(anonymous.data.description, /This is not the server this bot looks after/);
  assert.match(anonymous.data.description, /only answers in the servers it was set up for/);
});

test('the gate follows the data directory, so the first /setup claims the bot', async () => {
  const store = fakeStore([]);
  const gate = createGuildGate({ store, logger: silentLogger, brand: 'Spinback' });

  assert.equal(gate.lock.mode, 'open');
  assert.equal(gate.allows('1553825462315257868'), true, 'before anybody claims it, anybody may set it up');

  store.claim('1553825462315257868');
  gate.refresh();

  assert.equal(gate.lock.mode, 'claimed');
  assert.equal(gate.allows('1553825462315257868'), true);
  assert.equal(gate.allows('999'), false, 'a fresh claim locks the others out immediately');
});

test('turnAway tells the other server, and leaves when the environment asks it to', async () => {
  const store = fakeStore(['1']);
  const sent = [];
  let left = 0;
  const guild = {
    id: '2',
    name: 'Other Clan',
    systemChannel: { send: async (payload) => sent.push(payload) },
    leave: async () => { left += 1; },
  };

  const polite = createGuildGate({ store, logger: silentLogger, brand: 'Spinback' });
  assert.deepEqual(await polite.turnAway(guild), { refused: true, left: false });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].embeds[0].data.footer.text, 'Powered by Spinback');
  assert.equal(left, 0, 'it stays put unless it was told to leave');

  const leaving = createGuildGate({ store, logger: silentLogger, leaveUnknown: true });
  assert.deepEqual(await leaving.turnAway(guild), { refused: true, left: true });
  assert.equal(left, 1);
});

test('turnAway survives a server with nowhere to speak and nothing to leave', async () => {
  const warnings = [];
  const gate = createGuildGate({ store: fakeStore(['1']), logger: { ...silentLogger, warn: (line) => warnings.push(line) }, leaveUnknown: true });

  assert.deepEqual(await gate.turnAway({ id: '3', name: 'Nowhere', channels: { cache: { find: () => null } } }), { refused: true, left: true });
  assert.ok(warnings.some((line) => line.includes('refused')), 'the host log still says what happened');
});

test('a second saved setup is logged as a warning to fix, not a silent takeover', () => {
  const warnings = [];
  const store = fakeStore(['1', '2']);
  const gate = createGuildGate({ store, logger: { ...silentLogger, warn: (line) => warnings.push(line) } });

  assert.equal(gate.lock.mode, 'claimed');
  assert.equal(gate.lock.ids.size, 2);
  assert.ok(warnings.some((line) => line.includes('ALLOWED_GUILD_IDS')));
});
