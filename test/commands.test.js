import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandByName, commands, defaultSlot, deniedEmbed, describeOptions, readOptions, slashCommandData } from '../src/commands.js';
import { emptyGuildConfig } from '../src/store.js';

test('the bot serves exactly two commands: /setup and !pop', () => {
  assert.deepEqual(
    commands.map((command) => command.name),
    ['setup', 'pop'],
  );

  const data = slashCommandData();
  assert.equal(data.length, 1, 'only /setup is registered with Discord');
  assert.equal(data[0].name, 'setup');
  assert.ok(data[0].description.length > 0 && data[0].description.length <= 100);

  for (const command of commands) assert.equal(typeof command.run, 'function');
  assert.equal(commandByName('POP').name, 'pop');
  assert.equal(commandByName('nope'), null);
});

test('the old command set is really gone from the slash menu', () => {
  const data = slashCommandData().map((definition) => definition.name);
  assert.deepEqual(data, ['setup']);
  for (const name of ['pop', 'status', 'board', 'help', 'players', 'say', 'kick', 'save', 'ban', 'console']) {
    assert.ok(!data.includes(name), name + ' must not be registered any more');
  }
});

test('/setup is owner only and slash only; !pop is the one prefix command', () => {
  const setup = commandByName('setup');
  assert.equal(setup.ownerOnly, true);
  assert.equal(setup.slashOnly, true);
  assert.equal(setup.minTier, null);
  assert.equal(setup.prefixUsage, null, 'setup is slash only');

  const pop = commandByName('pop');
  assert.equal(pop.minTier, null, 'pop is for everybody');
  assert.equal(pop.prefixOnly, true, 'pop is prefix only');
  assert.match(pop.prefixUsage, /^!pop/);

  for (const name of ['status', 'board', 'help', 'players', 'say', 'kick', 'save', 'ban', 'console']) {
    assert.equal(commandByName(name), null, name + ' should not exist any more');
  }
});

test('readOptions understands prefix arguments', () => {
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
});

test('describeOptions feeds the command log', () => {
  const prefix = describeOptions(commandByName('pop'), null, ['2', 'yes']);
  assert.deepEqual(prefix, [
    { name: 'server', value: '2' },
    { name: 'players', value: 'yes' },
  ]);

  const slash = describeOptions(commandByName('setup'), { options: { data: [{ name: 'option', value: 'x' }] } });
  assert.deepEqual(slash, [{ name: 'option', value: 'x' }]);

  const long = describeOptions(commandByName('pop'), null, ['x'.repeat(200)]);
  assert.equal(long[0].value.length, 80);
});

test('defaultSlot follows the first configured server', () => {
  assert.equal(defaultSlot(emptyGuildConfig('g')), 1);
  assert.equal(defaultSlot({ servers: [null, { host: 'h', port: 1, password: 'p' }, null] }), 2);
  assert.equal(defaultSlot({ servers: [null, null, null] }, { host: 'h', port: 1, password: 'p' }), 1);
});

test('deniedEmbed explains which roles are allowed', () => {
  const embed = deniedEmbed({ name: 'setup', minTier: 'admin' }, { reason: 'no' });
  assert.match(embed.data.title, /Not allowed/);
  assert.match(embed.data.description, /no/);
  assert.match(embed.data.fields[0].value, /Admin Role/);
  assert.match(embed.data.footer.text, /\/setup/);
});
