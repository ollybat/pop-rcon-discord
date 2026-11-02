import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GuildStore, configuredServers, describeConfig, emptyGuildConfig, normalizeGuildConfig, normalizeServerInput } from '../src/store.js';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

test('normalizeServerInput accepts real server details and cleans the host', () => {
  const result = normalizeServerInput({ name: ' Spinback 5X EU ', host: ' wss://play.example.com/', port: '28016', password: 'secret' });
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, { name: 'Spinback 5X EU', host: 'play.example.com', port: 28016, password: 'secret' });
});

test('normalizeServerInput defaults the port and the name', () => {
  const result = normalizeServerInput({ host: '1.2.3.4', password: 'x' });
  assert.equal(result.ok, true);
  assert.equal(result.value.port, 28016);
  assert.equal(result.value.name, '1.2.3.4');
});

test('normalizeServerInput refuses junk', () => {
  assert.equal(normalizeServerInput({ host: '', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: 'two words', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', port: '70000', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', port: 'abc', password: 'x' }).ok, false);
  assert.equal(normalizeServerInput({ host: '1.2.3.4', password: '' }).ok, false);
  assert.match(normalizeServerInput({ host: '1.2.3.4', password: '' }).error, /password/i);
});

test('normalizeGuildConfig drops ids and servers that are not usable', () => {
  const config = normalizeGuildConfig(
    {
      roles: { owner: '111111111111111111', coOwner: 'nope' },
      logs: { joinLeave: '222222222222222222' },
      servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }, null, { host: '', password: '' }],
    },
    'guild-1',
  );

  assert.equal(config.roles.owner, '111111111111111111');
  assert.equal(config.roles.coOwner, null);
  assert.equal(config.logs.joinLeave, '222222222222222222');
  assert.equal(config.logs.errors, null);
  assert.equal(configuredServers(config).length, 1);
  assert.equal(configuredServers(config)[0].slot, 1);
  assert.equal(configuredServers(config)[0].name, '1.2.3.4');
});

test('describeConfig reports readiness', () => {
  const empty = describeConfig(emptyGuildConfig('g'));
  assert.deepEqual(empty, { roles: 0, logs: 0, servers: 0, ready: false });

  const ready = describeConfig({
    roles: { owner: '1', admin: '2' },
    logs: { errors: '3' },
    servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }],
  });
  assert.deepEqual(ready, { roles: 2, logs: 1, servers: 1, ready: true });

  // Roles without a server (or the other way round) is still not ready.
  assert.equal(describeConfig({ roles: { owner: '1' }, servers: [null, null, null] }).ready, false);
  assert.equal(describeConfig({ roles: {}, servers: [{ host: '1.2.3.4', port: 28016, password: 'x' }] }).ready, false);
});

test('GuildStore round-trips a config through the disk, privately', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const store = new GuildStore({ dir, logger: silentLogger });
  assert.deepEqual(store.listGuildIds(), []);
  assert.equal(store.get('guild-1').roles.owner, null);

  await store.save('guild-1', {
    roles: { owner: '111111111111111111', admin: 'nope' },
    logs: { joinLeave: '222222222222222222' },
    servers: [{ name: 'Spinback 5X EU', host: '1.2.3.4', port: 28016, password: 'x' }],
  });

  assert.deepEqual(store.listGuildIds(), ['guild-1']);
  assert.equal(store.get('guild-1').roles.admin, null, 'an invalid role id is not stored');
  assert.ok(store.get('guild-1').updatedAt);

  const mode = (await stat(store.pathFor('guild-1'))).mode & 0o777;
  if (process.platform !== 'win32') assert.equal(mode, 0o600, 'the file holds RCON passwords');

  const fresh = new GuildStore({ dir, logger: silentLogger });
  const loaded = await fresh.load('guild-1');
  assert.equal(loaded.roles.owner, '111111111111111111');
  assert.equal(configuredServers(loaded)[0].host, '1.2.3.4');
  assert.equal(configuredServers(loaded)[0].password, 'x');
});

test('GuildStore.update reads, mutates and writes', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'pop-rcon-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));

  const store = new GuildStore({ dir, logger: silentLogger });
  const updated = await store.update('guild-1', (config) => {
    config.roles.owner = '111111111111111111';
    return config;
  });

  assert.equal(updated.roles.owner, '111111111111111111');
  assert.equal(store.get('guild-1').roles.owner, '111111111111111111');

  // A guild with no file yet loads as an empty config instead of throwing.
  assert.equal((await store.load('guild-2')).roles.owner, null);
});
