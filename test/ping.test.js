import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PING_ID, buildPingPayload, handlePingComponent, pingRows } from '../src/ping.js';
import { createStats } from '../src/stats.js';
import { emptyGuildConfig } from '../src/store.js';

const snapshots = [
  {
    slot: 1,
    name: 'Spinback 5X EU',
    connected: true,
    info: { players: 12, max: 100, queued: 2, joining: 0, uptime: 7200, restarting: false },
    players: [],
    latencyMs: 90,
    at: new Date().toISOString(),
    error: null,
  },
];

function fakeServers() {
  return { refreshGuild: async () => snapshots };
}

test('the health check button exists and reports everything', async () => {
  assert.equal(PING_ID, 'sb:ping');
  assert.equal(pingRows().length, 1);

  const stats = createStats();
  stats.inc('polls', 7);
  stats.note('one wobble');

  const payload = await buildPingPayload({
    guild: { id: 'g1' },
    guildConfig: { ...emptyGuildConfig('g1'), servers: [{ name: 'Spinback 5X EU', host: '1.2.3.4', port: 28016, password: 'secret' }] },
    servers: fakeServers(),
    web: {},
    client: { ws: { ping: 42 } },
    pollSeconds: 20,
    stats,
  });

  const embed = payload.embeds[0].data;
  assert.match(embed.title, /Pong/);
  assert.match(embed.description, /42 ms\*\* to Discord/);

  const names = embed.fields.map((field) => field.name).join(' | ');
  assert.match(names, /RCON/);
  assert.match(names, /Runtime/);
  assert.match(names, /Configuration/);

  const rcon = embed.fields.find((field) => field.name === 'RCON').value;
  assert.match(rcon, /Spinback 5X EU/);
  assert.match(rcon, /90 ms/);
  assert.match(rcon, /12\/100/);

  const runtime = embed.fields.find((field) => field.name === 'Runtime').value;
  assert.match(runtime, /7 polls/);
  assert.match(runtime, /MB RAM/, 'the process size is part of the report');
  assert.match(runtime, /polls every 20s/);
  assert.match(runtime, /1 error/);

  const config = embed.fields.find((field) => field.name === 'Configuration').value;
  assert.match(config, /1 server configured/);
  assert.ok(!JSON.stringify(embed).includes('secret'), 'never a password');
  assert.ok(!JSON.stringify(embed).includes('1.2.3.4'), 'and never an address');
});

test('it says nothing about a public URL when none is configured', async () => {
  const payload = await buildPingPayload({ guild: { id: 'g1' }, guildConfig: null, servers: fakeServers(), web: {} });
  const names = payload.embeds[0].data.fields.map((field) => field.name);
  assert.ok(!names.includes('Public URL'));
  assert.ok(!names.includes('Configuration'), 'no config, no config field');
});

test('the Check again button re-runs the report for allowed staff only', async () => {
  const edits = [];
  const replies = [];

  const interaction = {
    customId: 'sb:ping:refresh',
    guild: { id: 'g1', ownerId: 'owner1' },
    member: { id: 'u1', roles: { cache: new Map() } },
    user: { id: 'u1' },
    deferUpdate: async () => {},
    editReply: async (payload) => edits.push(payload),
    reply: async (payload) => replies.push(payload),
  };

  const ctx = {
    store: { get: () => emptyGuildConfig('g1') },
    servers: fakeServers(),
    botOwnerIds: [],
    web: {},
  };

  assert.equal(await handlePingComponent(interaction, ctx), true);
  assert.equal(replies.length, 1, 'a stranger is refused');
  assert.match(replies[0].content, /⛔/);
  assert.equal(edits.length, 0);

  const owner = { ...interaction, user: { id: 'owner1' }, member: { id: 'owner1', roles: { cache: new Map() } } };
  assert.equal(await handlePingComponent(owner, ctx), true);
  assert.equal(edits.length, 1, 'the owner gets a fresh report');
  assert.match(edits[0].embeds[0].data.title, /Pong/);

  assert.equal(await handlePingComponent({ customId: 'sb:pop:view:1:1:1' }, ctx), false, 'other buttons are left alone');
});
