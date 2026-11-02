import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COLORS, STATUS } from '../src/theme.js';
import { emptyGuildConfig, recordPeak } from '../src/store.js';
import {
  baseEmbed,
  commandLogEmbed,
  errorEmbed,
  errorLogEmbed,
  guideEmbed,
  joinLeaveEmbed,
  panelEmbed,
  peakLine,
  pingEmbed,
  playerLines,
  popServerEmbed,
  popSetupHintEmbed,
  popSummaryEmbed,
  rolesEmbed,
  serverLine,
  serversEmbed,
  statusLogEmbed,
  welcomeEmbed,
} from '../src/embeds.js';

const guild = { name: 'Spinback HQ' };

function buildConfig(overrides = {}) {
  return {
    ...emptyGuildConfig('g'),
    roles: { owner: '100', coOwner: null, headAdmin: null, admin: '400', moderator: null },
    logs: { joinLeave: '200', commands: null, errors: null, status: null },
    servers: [{ name: 'Spinback 5X EU', host: '1.2.3.4', port: 28016, password: 'hunter2' }, null, null],
    ...overrides,
  };
}

function fieldValues(embed) {
  return (embed.data.fields ?? []).map((field) => field.value ?? '');
}

function fieldNamed(embed, name) {
  return (embed.data.fields ?? []).find((field) => field.name.includes(name)) ?? null;
}

test('baseEmbed carries the light blue brand colour and the footer', () => {
  const embed = baseEmbed();
  assert.equal(embed.data.color, COLORS.brand);
  assert.equal(embed.data.footer.text, 'Spinback pop bot');

  const withFooter = baseEmbed({ footer: 'extra' });
  assert.equal(withFooter.data.footer.text, 'Spinback • extra');
});

test('the setup panel summarises roles, logs, servers and readiness', () => {
  const embed = panelEmbed({ guild, config: buildConfig() });
  assert.match(embed.data.title, /Spinback setup/);

  const roles = fieldNamed(embed, 'Staff roles');
  assert.match(roles.name, /\(2\/5\)/, 'the field name counts the roles that are set');
  assert.match(roles.value, /<@&100>/);
  assert.match(roles.value, /not set/);

  const logs = fieldNamed(embed, 'Log channels');
  assert.match(logs.name, /\(1\/4\)/);
  assert.match(logs.value, /<#200>/);

  const servers = fieldNamed(embed, 'Servers');
  assert.match(servers.value, /Spinback 5X EU \(1\.2\.3\.4:28016\)/);
  assert.match(servers.value, /Slot 2/);

  assert.match(fieldNamed(embed, 'Ready')?.name ?? '', /Ready/);
  assert.match(fieldValues(embed).join(' '), /at least one server/);
});

test('the setup panel says what is still missing', () => {
  const embed = panelEmbed({ guild, config: emptyGuildConfig('g') });
  assert.equal(embed.data.color, COLORS.brand);
  assert.match(embed.data.title, /setup/i);
  assert.match(fieldNamed(embed, 'Not finished')?.name ?? '', /Not finished/);
  assert.match(fieldValues(embed).join(' '), /Still needed/);
  assert.match(fieldValues(embed).join(' '), /Owner Role/);
});

test('rolesEmbed and serversEmbed keep every tier and the password warning', () => {
  const config = buildConfig();
  assert.match(rolesEmbed({ config }).data.description, /Owner Role/);
  assert.match(serversEmbed({ config }).data.description, /never shown in Discord/);
});

test('serverLine shows masked passwords and live counts', () => {
  const server = { name: 'Spinback 5X EU', host: '1.2.3.4', port: 28016, password: 'hunter2' };
  assert.match(serverLine(null), /not configured/);
  assert.match(serverLine(server), /1\.2\.3\.4:28016/);
  assert.ok(!serverLine(server, { connected: true, info: { players: 4, max: 100, restarting: false }, latencyMs: 12 }).includes('hunter2'));

  const online = serverLine(server, { connected: true, info: { players: 4, max: 100, restarting: false }, latencyMs: 12 });
  assert.match(online, /4\/100 online/);
  assert.match(online, /12ms/);
  assert.match(online, /hu\*\*\*r2/);

  assert.match(serverLine(server, { connected: false, error: 'ECONNREFUSED' }), /ECONNREFUSED/);
});

test('playerLines chunks a long roster and stops growing the embed', () => {
  const empty = playerLines([]);
  assert.equal(empty.length, 1);
  assert.match(empty[0].value, /Nobody is online/);

  const players = Array.from({ length: 40 }, (_, index) => ({
    id: String(index),
    name: 'player' + index,
    ping: 20,
    seconds: 600,
  }));

  const fields = playerLines(players, 15, 6);
  assert.equal(fields.length, 3);
  assert.match(fields[0].name, /40/);
  assert.match(fields[0].value, /player0/);
  assert.ok(!fields[0].value.includes('player20'));

  const capped = playerLines(Array.from({ length: 500 }, (_, index) => ({ id: String(index), name: 'p' + index, ping: null, seconds: null })), 15, 2);
  assert.equal(capped.length, 2);
  assert.match(capped[1].value, /more player/);
});

test('popServerEmbed covers online, offline and unresponsive servers', () => {
  const online = popServerEmbed({
    slot: 1,
    name: 'Spinback 5X EU',
    connected: true,
    info: { players: 12, max: 100, queued: 2, joining: 1, uptime: 3600, restarting: false, hostname: 'Spinback 5X EU' },
    players: [{ id: '1', name: 'alpha', ping: 25, seconds: 120 }],
    latencyMs: 9,
    at: new Date().toISOString(),
    error: null,
  });

  assert.equal(online.data.color, STATUS.online.color);
  assert.match(online.data.title, /12\/100/);
  assert.match(online.data.footer.text, /RCON 9ms/);
  assert.ok(fieldNamed(online, 'Population'));
  assert.match(fieldNamed(online, 'Players').value, /alpha/);

  const noPlayers = popServerEmbed(
    { slot: 1, name: 'S', connected: true, info: { players: 0, max: 100, restarting: false }, players: [], latencyMs: 4, at: null },
    { showPlayers: false },
  );
  assert.equal(noPlayers.data.fields.filter((field) => field.name.includes('Players')).length, 0);

  const offline = popServerEmbed({ slot: 1, name: 'S', connected: false, info: null, players: [], latencyMs: null, at: null, error: 'boom' });
  assert.equal(offline.data.color, STATUS.offline.color);
  assert.match(offline.data.description, /boom/);

  const quiet = popServerEmbed({ slot: 1, name: 'S', connected: true, info: null, players: [], latencyMs: 1, at: null });
  assert.match(quiet.data.description, /serverinfo/);

  const resting = popServerEmbed({
    slot: 1,
    name: 'S',
    connected: true,
    info: { players: 0, max: 100, queued: 0, joining: 0, uptime: 60, restarting: true, hostname: 'S' },
    players: [],
    latencyMs: 5,
    at: null,
  });
  assert.equal(resting.data.color, STATUS.resting.color);
});

test('join and leave embeds, including the restart-sized summary', () => {
  const server = { name: 'Spinback 5X EU' };
  const join = joinLeaveEmbed({ type: 'join', player: { id: '1', name: 'alpha' }, server, online: 5, max: 100 });
  assert.equal(join.data.color, COLORS.success);
  assert.match(join.data.title, /alpha/);
  assert.match(join.data.footer.text, /5\/100 online/);

  const leave = joinLeaveEmbed({ type: 'leave', player: { id: '1', name: 'alpha' }, server, online: 4, max: 100, sessionSeconds: 3700 });
  assert.equal(leave.data.color, COLORS.warning);
  assert.match(fieldNamed(leave, 'Left').value, /1h 1m/);

  const mass = joinLeaveEmbed({ type: 'join', player: { name: '', id: '' }, server, online: 0, max: 100, massChange: true, joinedCount: 12, leftCount: 11 });
  assert.equal(mass.data.color, COLORS.warning);
  assert.match(mass.data.description, /12 joined and 11 left/);
});

test('the command log records who did what, with which tier', () => {
  const entry = commandLogEmbed({
    user: { id: '9', username: 'olly' },
    tier: 'admin',
    command: 'kick',
    options: [{ name: 'player', value: 'griefer' }],
    ok: true,
    ms: 42,
    guild,
    channel: { id: '5' },
  });

  assert.equal(entry.data.color, COLORS.brand);
  assert.match(entry.data.title, /kick/);
  assert.match(entry.data.description, /<@9>/);
  assert.match(fieldNamed(entry, 'Access').value, /Admin Role/);
  assert.match(fieldNamed(entry, 'Options').value, /griefer/);
  assert.match(fieldNamed(entry, 'Took').value, /42ms/);

  const owner = commandLogEmbed({ user: { id: '9', username: 'olly' }, tier: null, command: 'setup', ok: true, guild });
  assert.match(fieldNamed(owner, 'Access').value, /Server owner/);

  const failed = commandLogEmbed({ user: { id: '9', username: 'olly' }, tier: 'admin', command: 'ban', ok: false, error: 'RCON command timed out', guild });
  assert.equal(failed.data.color, COLORS.danger);
  assert.match(fieldNamed(failed, 'Error').value, /timed out/);
});

test('error, status, summary and hint embeds render', () => {
  const error = errorLogEmbed({ source: '/pop', message: 'boom', context: 'guild 1', stack: 'at x' });
  assert.equal(error.data.color, COLORS.danger);
  assert.match(error.data.description, /boom/);

  assert.match(statusLogEmbed({ title: '📡 up', description: 'connected' }).data.title, /up/);
  assert.match(popSummaryEmbed({ totalPlayers: 5, totalMax: 300, onlineServers: 2, totalServers: 3 }).data.description, /5\/300/);
  assert.match(popSetupHintEmbed().data.description, /\/setup/);
  assert.match(errorEmbed(new Error('nope')).data.description, /nope/);
  assert.equal(errorEmbed(new Error('nope')).data.color, COLORS.danger);
});

test('peakLine shows today\'s busiest moment', () => {
  const config = buildConfig();
  assert.equal(peakLine(config, 1), null, 'nothing recorded yet');

  recordPeak(config, 1, 63, new Date());
  assert.match(peakLine(config, 1, 200), /\*\*63\/200\*\*/);
  assert.match(peakLine(config, 1), /\*\*63\*\*/);
  assert.equal(peakLine(config, 3), null, 'an empty slot has no peak');
});

test('popServerEmbed can carry the peak of the day', () => {
  const embed = popServerEmbed(
    {
      slot: 1,
      name: 'Spinback 5X EU',
      connected: true,
      info: { players: 12, max: 100, queued: 0, joining: 0, uptime: 60, restarting: false, hostname: 'S' },
      players: [],
      latencyMs: 4,
      at: null,
    },
    { peak: '**63/100** at 19:30 UTC' },
  );

  assert.match(fieldNamed(embed, 'Peak today').value, /63\/100/);
});

test('pingEmbed reports the gateway, the servers and the public URL', () => {
  const embed = pingEmbed({
    gatewayMs: 42,
    uptimeSeconds: 3671,
    snapshots: [
      {
        slot: 1,
        name: 'Spinback 5X EU',
        connected: true,
        info: { players: 12, max: 100, queued: 2 },
        latencyMs: 9,
      },
      { slot: 2, name: 'Second', connected: false, info: null, latencyMs: null, error: 'ECONNREFUSED' },
    ],
    health: { url: 'https://nyksp9z6p1.apps.bot-hosting.cloud/health', ok: true, status: 200, ms: 31, error: null },
  });

  assert.match(embed.data.title, /Pong/);
  assert.match(embed.data.description, /42 ms/);
  assert.match(embed.data.description, /1h 1m/);
  assert.match(fieldNamed(embed, 'RCON').value, /Spinback 5X EU/);
  assert.match(fieldNamed(embed, 'RCON').value, /12\/100/);
  assert.match(fieldNamed(embed, 'RCON').value, /9 ms/);
  assert.match(fieldNamed(embed, 'RCON').value, /ECONNREFUSED/);
  assert.match(fieldNamed(embed, 'Public URL').value, /200 OK/);
  assert.match(fieldNamed(embed, 'Public URL').value, /nyksp9z6p1/);
  assert.match(embed.data.footer.text, /Private/);
  assert.doesNotMatch(embed.data.footer.text, /public/i);

  const offline = pingEmbed({ snapshots: [], health: { url: 'http://x', ok: false, status: null, ms: 4000, error: 'timed out after 4000ms' } });
  assert.match(fieldNamed(offline, 'RCON').value, /\/setup/);
  assert.match(fieldNamed(offline, 'Public URL').value, /timed out/);

  const withRuntime = pingEmbed({ gatewayMs: 30, snapshots: [], pollSeconds: 20, memoryMb: 84.6 });
  assert.match(fieldNamed(withRuntime, 'Runtime').value, /polls every 20s/);
  assert.match(fieldNamed(withRuntime, 'Runtime').value, /85 MB RAM/);

  const local = pingEmbed({ snapshots: [], localUrl: 'http://127.0.0.1:25976/health' });
  assert.match(fieldNamed(local, 'Health endpoint').value, /127\.0\.0\.1:25976/);
  // RCON, Runtime and the public URL
  assert.equal(offline.data.fields.length, 3);
});


test('the setup panel is private and never renders the RCON password', () => {
  const config = buildConfig();
  const panel = panelEmbed({ guild, config });
  const rendered = JSON.stringify(panel.data);

  assert.match(panel.data.footer.text, /Private/);
  assert.match(panel.data.description, /Nothing here is public/);
  assert.ok(!rendered.includes('hunter2'), 'the raw password must never be rendered');
  assert.match(panel.data.fields[2].value, /1\.2\.3\.4:28016/, 'the owner still sees the address');

  const servers = serversEmbed({ config }).data.description;
  assert.ok(!servers.includes('hunter2'), 'the server list must not render the password either');
  assert.match(servers, /never shown in Discord/);

  // with a live snapshot the list mentions the password, masked, and still not in clear
  const live = serversEmbed({
    config,
    snapshots: [{ slot: 1, connected: true, info: { players: 4, max: 100, restarting: false }, latencyMs: 12 }],
  }).data.description;
  assert.ok(!live.includes('hunter2'), 'the masked form must not contain the secret');
  assert.match(live, /hu\*{3}r2/);
});

test('errors and the public !pop embed are scrubbed of an RCON url', () => {
  const leak = 'connect failed: ws://1.2.3.4:28016/hunter2';

  const offline = popServerEmbed({ slot: 1, name: 'S', connected: false, info: null, players: [], latencyMs: null, at: null, error: leak });
  assert.ok(!JSON.stringify(offline.data).includes('hunter2'), 'the public embed must not echo the url password');
  assert.match(offline.data.description, /ws:\/\/1\.2\.3\.4:28016\/\*\*\*/);

  assert.ok(!JSON.stringify(errorEmbed(new Error(leak)).data).includes('hunter2'));
  assert.ok(!JSON.stringify(errorLogEmbed({ source: '/ping', message: leak, context: leak, stack: leak }).data).includes('hunter2'));
});

test('guideEmbed shows the exact Rust start line', () => {
  const embed = guideEmbed({ config: buildConfig() });
  assert.match(embed.data.description, /\+rcon\.web 1/);
  assert.match(embed.data.description, /rcon\.port 28016/);
  assert.match(embed.data.description, /Guess roles/);
  assert.match(embed.data.footer.text, /Console Edition/);
});

test('welcomeEmbed tells a new server owner what to do first', () => {
  const embed = welcomeEmbed({ prefix: '!', prefixEnabled: true });
  assert.match(embed.data.description, /\/setup/);
  assert.match(embed.data.description, /Guess roles/);
  assert.match(embed.data.description, /!pop/);
});

