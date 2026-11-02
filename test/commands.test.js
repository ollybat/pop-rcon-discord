import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandByName, commands, defaultSlot, deniedEmbed, describeOptions, readOptions, slashCommandData } from '../src/commands.js';
import { emptyGuildConfig } from '../src/store.js';

test('every command has a usable slash definition', () => {
  const data = slashCommandData();
  assert.equal(data.length, commands.length);
  assert.ok(data.length >= 7);

  const names = new Set();
  for (const definition of data) {
    assert.match(definition.name, /^[a-z-]{1,32}$/);
    assert.ok(definition.description.length > 0 && definition.description.length <= 100);
    assert.ok(!names.has(definition.name), 'duplicate command ' + definition.name);
    names.add(definition.name);
  }

  assert.deepEqual(
    [...names].sort(),
    ['ban', 'console', 'kick', 'players', 'pop', 'say', 'setup'],
  );
});

test('setup is owner only and slash only, staff commands need a tier', () => {
  const setup = commandByName('setup');
  assert.equal(setup.ownerOnly, true);
  assert.equal(setup.slashOnly, true);
  assert.equal(setup.minTier, null);

  assert.equal(commandByName('pop').minTier, null);
  assert.equal(commandByName('players').minTier, 'moderator');
  assert.equal(commandByName('say').minTier, 'admin');
  assert.equal(commandByName('kick').minTier, 'admin');
  assert.equal(commandByName('ban').minTier, 'headAdmin');
  assert.equal(commandByName('console').minTier, 'coOwner');

  for (const command of commands) assert.equal(typeof command.run, 'function');
  assert.equal(commandByName('POP').name, 'pop');
  assert.equal(commandByName('nope'), null);
});

test('readOptions understands slash interactions', () => {
  const interaction = {
    options: {
      getString: (name) => (name === 'message' ? 'hello' : null),
      getInteger: (name) => (name === 'server' ? 2 : null),
      getBoolean: (name) => (name === 'players' ? false : null),
    },
  };

  const options = readOptions({ command: commandByName('pop'), interaction });
  assert.equal(options.integer('server'), 2);
  assert.equal(options.boolean('players'), false);
  assert.equal(options.string('nope'), null);
});

test('readOptions understands !prefix arguments', () => {
  const pop = commandByName('pop');

  const empty = readOptions({ command: pop, args: [] });
  assert.equal(empty.integer('server'), null);
  assert.equal(empty.boolean('players'), null);

  const two = readOptions({ command: pop, args: ['2'] });
  assert.equal(two.integer('server'), 2);

  const withPlayers = readOptions({ command: pop, args: ['3', 'yes'] });
  assert.equal(withPlayers.integer('server'), 3);
  assert.equal(withPlayers.boolean('players'), true);

  const off = readOptions({ command: pop, args: ['1', 'off'] });
  assert.equal(off.boolean('players'), false);

  const words = readOptions({ command: commandByName('say'), args: ['server', 'restart', 'now'] });
  assert.equal(words.string('message'), 'server');
});

test('describeOptions feeds the command log', () => {
  const prefix = describeOptions(commandByName('pop'), null, ['2', 'yes']);
  assert.deepEqual(prefix, [
    { name: 'server', value: '2' },
    { name: 'players', value: 'yes' },
  ]);

  const slash = describeOptions(commandByName('kick'), { options: { data: [{ name: 'player', value: 'griefer' }] } });
  assert.deepEqual(slash, [{ name: 'player', value: 'griefer' }]);

  const long = describeOptions(commandByName('say'), null, ['x'.repeat(200)]);
  assert.equal(long[0].value.length, 80);
});

test('defaultSlot follows the first configured server', () => {
  assert.equal(defaultSlot(emptyGuildConfig('g')), 1);
  assert.equal(defaultSlot({ servers: [null, { host: 'h', port: 1, password: 'p' }, null] }), 2);
  assert.equal(defaultSlot({ servers: [null, null, null] }, { host: 'h', port: 1, password: 'p' }), 1);
});

test('deniedEmbed explains which roles are allowed', () => {
  const embed = deniedEmbed(commandByName('kick'), { reason: 'no' });
  assert.match(embed.data.title, /Not allowed/);
  assert.match(embed.data.description, /no/);
  assert.match(embed.data.fields[0].value, /Admin Role/);
  assert.match(embed.data.footer.text, /\/setup/);
});
