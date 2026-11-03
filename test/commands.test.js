import assert from 'node:assert/strict';
import { test } from 'node:test';
import { commandByName, commands, defaultSlot, deniedEmbed, describeOptions, readOptions, slashCommandData } from '../src/commands.js';
import { emptyGuildConfig } from '../src/store.js';

test('the bot serves three commands: /setup, !pop and /ping', () => {
  assert.deepEqual(
    commands.map((command) => command.name),
    ['setup', 'pop', 'ping'],
  );

  const data = slashCommandData();
  assert.deepEqual(
    data.map((definition) => definition.name),
    ['setup', 'ping'],
    'only /setup and /ping are registered with Discord',
  );

  for (const definition of data) {
    assert.match(definition.name, /^[a-z-]{1,32}$/);
    assert.ok(definition.description.length > 0 && definition.description.length <= 100);
  }

  for (const command of commands) assert.equal(typeof command.run, 'function');
  assert.equal(commandByName('POP').name, 'pop');
  assert.equal(commandByName('nope'), null);
});

test('the old command set is really gone from the slash menu', () => {
  const data = slashCommandData().map((definition) => definition.name);
  for (const name of ['pop', 'status', 'board', 'help', 'players', 'say', 'kick', 'save', 'ban', 'console']) {
    assert.ok(!data.includes(name), name + ' must not be registered any more');
  }
});

test('/setup is owner only and slash only; !pop is open and /ping is for the owners', () => {
  const setup = commandByName('setup');
  assert.equal(setup.ownerOnly, true);
  assert.equal(setup.slashOnly, true);
  assert.equal(setup.minTier, null);
  assert.equal(setup.prefixUsage, null, 'setup is slash only');

  const pop = commandByName('pop');
  assert.equal(pop.minTier, null, 'pop is for everybody');
  assert.equal(pop.prefixOnly, true, 'pop is prefix only');
  assert.match(pop.prefixUsage, /^!pop/);

  const ping = commandByName('ping');
  assert.equal(ping.minTier, 'coOwner', 'only the Owner and Co-Owner roles may ping');
  assert.match(ping.prefixUsage, /^!ping/);
  assert.ok(!ping.slashOnly && !ping.prefixOnly, 'ping works both ways');

  // privacy: the setup panel and the health check are answered in private, !pop is public on purpose
  assert.equal(setup.private, true, 'the setup panel is private');
  assert.equal(ping.private, true, 'the health check is private');
  assert.equal(pop.private, false, 'the population report is for the whole clan');

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
  assert.match(embed.data.description, /\/setup/);
  assert.equal(embed.data.footer.text, 'Powered by Spinback');
});


test('a plain !pop answers with the compact view', async () => {
  const snapshot = {
    slot: 1,
    name: 'spinback 5x',
    host: '127.0.0.1',
    port: 28016,
    connected: true,
    info: { players: 12, max: 100, queued: 0, joining: 0, uptime: 600, restarting: false, map: 'Procedural Map', framerate: 61, entityCount: 820, memory: 900 },
    players: [{ id: 'a', name: 'alpha', seconds: 600, ping: 30 }],
    latencyMs: 20,
    at: new Date().toISOString(),
    error: null,
  };

  let sent = null;
  const ctx = {
    guild: { id: 'g' },
    guildConfig: emptyGuildConfig('g'),
    options: { integer: () => null, boolean: () => null },
    invoker: { defer: async () => {}, edit: async (payload) => { sent = payload; } },
    servers: { refreshGuild: async () => [snapshot] },
  };

  await commandByName('pop').run(ctx);

  const data = sent.embeds[0].data;
  assert.ok(!data.fields.some((field) => field.name.includes('Map')), 'no map field: it is in the header line');
  assert.match(data.description, /Procedural Map/);
  assert.ok(data.fields.length <= 3);

  // The long version is still one button away.
  const labels = sent.components.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(labels.includes('More'), 'the compact answer offers More');

  // Asking for it explicitly still gives the long one.
  let expanded = null;
  const asked = { ...ctx, options: { integer: () => null, boolean: (name) => (name === 'details' ? true : null) }, invoker: { defer: async () => {}, edit: async (payload) => { expanded = payload; } } };
  await commandByName('pop').run(asked);
  const rich = expanded.embeds[0].data;
  assert.ok(rich.fields.some((field) => field.name.includes('Map')));
  assert.ok(rich.fields.length > 3);
  const richLabels = expanded.components.flatMap((row) => row.components.map((button) => button.data.label));
  assert.ok(richLabels.includes('Less'));
});
