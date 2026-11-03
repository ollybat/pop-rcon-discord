import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findPlayer, lookupPayload } from '../src/lookup.js';
import { emptyGuildConfig, dayKey } from '../src/store.js';
import { history, slotKey } from '../src/history.js';

const GUILD = 'g';
const AT = new Date('2026-11-03T12:00:00.000Z');

function snapshot(over = {}) {
  return {
    slot: 1,
    name: 'spinback 5x',
    host: '149.102.158.125',
    port: 28116,
    connected: true,
    latencyMs: 20,
    at: AT.toISOString(),
    error: null,
    info: {
      players: 12,
      max: 100,
      queued: 1,
      joining: 0,
      uptime: 3600,
      restarting: false,
      map: 'Procedural Map',
      framerate: 60,
      entityCount: 820,
      memory: 2048,
    },
    players: [
      { id: 'a', name: 'alpha', seconds: 600, ping: 30 },
      { id: 'b', name: 'Beta', seconds: 60, ping: 200 },
    ],
    ...over,
  };
}

test('findPlayer takes an exact name first, then a partial one', () => {
  const snapshots = [snapshot()];

  const exact = findPlayer(snapshots, 'alpha');
  assert.equal(exact.player.name, 'alpha', 'names are matched whatever the case');
  assert.equal(exact.snapshot.slot, 1);
  assert.equal(exact.matches.length, 1);

  assert.equal(findPlayer(snapshots, 'ALPHA').player.name, 'alpha');
  assert.equal(findPlayer(snapshots, 'bet').player.name, 'Beta');
  assert.equal(findPlayer(snapshots, 'nobody').player, null);
  assert.equal(findPlayer(snapshots, 'nobody').matches.length, 0);
  assert.equal(findPlayer(snapshots, '').player, null);
  assert.equal(findPlayer(snapshots, null).player, null);
  assert.equal(findPlayer([], 'alpha').player, null);
});

test('the dossier is one branded card with everything the bot knows', () => {
  const config = emptyGuildConfig(GUILD);
  const payload = lookupPayload({ snapshots: [snapshot()], config, guild: { id: GUILD }, at: AT });
  const data = payload.embeds[0].data;
  const names = data.fields.map((field) => field.name).join(' | ');

  assert.match(data.title, /spinback 5x/);
  assert.match(data.title, /12\/100/);
  assert.equal(data.footer.text, 'Powered by Spinback');
  assert.match(data.description, /never leave the bot host/, 'the address promise is on the card');

  assert.match(names, /Population/);
  assert.match(names, /Right now/);
  assert.match(names, /The server/);
  assert.match(names, /Record book/);
  assert.match(names, /On right now/);

  const population = data.fields.find((field) => field.name.includes('Population')).value;
  assert.match(population, /12\/100/);
  assert.match(population, /12%/, 'the share is spelled out');

  const facts = data.fields.find((field) => field.name === 'Right now').value;
  assert.match(facts, /1 queued/);
  assert.match(facts, /up 1h 0m|up 1h/, 'uptime is human: ' + facts);
  assert.match(facts, /20 ms/);

  const server = data.fields.find((field) => field.name === 'The server').value;
  assert.match(server, /Procedural Map/);
  assert.match(server, /60 fps/);
  assert.match(server, /820 entities/);
  assert.match(server, /2\.0 GB/, 'memory is shown the way people say it');

  assert.ok(data.fields.length <= 25, 'Discord allows 25 fields, we use ' + data.fields.length);
});

test('the address and the password are never printed, in any shape', () => {
  const config = emptyGuildConfig(GUILD);
  config.servers = [{ slot: 1, name: 'spinback 5x', host: '149.102.158.125', port: 28116, password: 'sup3r-s3cret' }];

  const text = JSON.stringify(lookupPayload({ snapshots: [snapshot()], config, guild: { id: GUILD }, at: AT }));
  assert.ok(!text.includes('149.102.158.125'), 'no RCON host');
  assert.ok(!text.includes('28116'), 'no RCON port');
  assert.ok(!text.includes('sup3r-s3cret'), 'no RCON password');
});

test('the trend line appears once there are readings, and the record book once there are days', () => {
  const key = slotKey(GUILD, 1);
  for (const players of [4, 6, 9, 7, 12]) history.push(key, { players, max: 100 });

  const today = dayKey(AT);
  const config = emptyGuildConfig(GUILD);
  config.stats = {
    1: { day: today, peak: 12, peakAt: new Date('2026-11-03T11:00:00.000Z').toISOString(), days: { [today]: 12, '2026-11-02': 19 }, best: { peak: 19, day: '2026-11-02' } },
  };

  const data = lookupPayload({ snapshots: [snapshot()], config, guild: { id: GUILD }, at: AT }).embeds[0].data;
  const trend = data.fields.find((field) => field.name.includes('Trend'));
  const record = data.fields.find((field) => field.name.includes('Record book')).value;

  assert.ok(trend, 'a shape needs at least three readings');
  assert.match(trend.value, /now/);
  assert.match(trend.value, /readings/);

  assert.match(record, /Today: \*\*12\*\*/);
  assert.match(record, /Best day so far: \*\*19\*\* on 2026-11-02/);
  assert.match(record, /2 days recorded/);

  history.forget(key);
});

test('an empty record book says so instead of inventing numbers', () => {
  const data = lookupPayload({ snapshots: [snapshot()], config: emptyGuildConfig(GUILD), guild: { id: GUILD }, at: AT }).embeds[0].data;
  const record = data.fields.find((field) => field.name.includes('Record book')).value;
  assert.match(record, /first reading becomes day one/);
});

test('one player, by name, with the honest limit attached', () => {
  const payload = lookupPayload({ snapshots: [snapshot()], config: emptyGuildConfig(GUILD), guild: { id: GUILD }, query: 'Beta', at: AT });
  assert.equal(payload.embeds.length, 1);

  const data = payload.embeds[0].data;
  assert.match(data.title, /Beta/);
  assert.match(data.description, /spinback 5x/, 'the card says which server they are on');
  assert.equal(data.footer.text, 'Powered by Spinback');

  const names = data.fields.map((field) => field.name).join(' | ');
  assert.match(names, /Session/);
  assert.match(names, /Connection/);
  assert.match(names, /Honest limit/);
  assert.match(data.fields.find((field) => field.name === 'Connection').value, /🔴 200 ms/, 'a poor connection is not dressed up');
});

test('an unknown name lists who is on instead of coming back empty', () => {
  const payload = lookupPayload({ snapshots: [snapshot()], config: emptyGuildConfig(GUILD), guild: { id: GUILD }, query: 'ghost', at: AT });
  const data = payload.embeds[0].data;

  assert.match(data.title, /No one called/);
  assert.match(data.description, /alpha/);
  assert.match(data.description, /Beta/);
  assert.match(data.description, /no playtime or last-seen/);
  assert.equal(data.footer.text, 'Powered by Spinback');
});

test('the setup summary is only for staff, and only for the server it belongs to', () => {
  const config = emptyGuildConfig(GUILD);
  config.roles = { owner: '111' };
  config.logs.status = '999';
  config.servers = [{ slot: 1, name: 'spinback 5x', host: 'h', port: 1, password: 'p' }];

  const open = lookupPayload({ snapshots: [snapshot()], config, guild: { id: GUILD }, at: AT });
  assert.ok(!open.embeds.some((embed) => /How this bot is set up/.test(embed.data.title)), 'everybody else does not see the wiring');

  const staff = lookupPayload({ snapshots: [snapshot()], config, guild: { id: GUILD }, staffTier: 'coOwner', at: AT });
  const last = staff.embeds.at(-1).data;
  assert.match(last.title, /How this bot is set up here/);
  assert.match(last.fields.map((field) => field.value).join(' | '), /<#999>/);
  assert.match(last.fields.map((field) => field.value).join(' | '), /<@&111>/);
  assert.equal(last.footer.text, 'Powered by Spinback');
  assert.ok(!JSON.stringify(staff).includes('rcon'), 'even the staff view keeps the password out');
});

test('with nothing configured the answer is an instruction, not an empty embed', () => {
  const payload = lookupPayload({ snapshots: [], config: emptyGuildConfig(GUILD), guild: { id: GUILD }, at: AT });
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.embeds[0].data.title, /Nothing to look up yet/);
  assert.match(payload.embeds[0].data.description, /\/setup/);
});

test('an offline server still gets a card, with the truth on it', () => {
  const offline = snapshot({ connected: false, info: null, players: [], error: 'connect ECONNREFUSED' });
  const data = lookupPayload({ snapshots: [offline], config: emptyGuildConfig(GUILD), guild: { id: GUILD }, at: AT }).embeds[0].data;

  assert.match(data.title, /Offline/);
  assert.equal(data.footer.text, 'Powered by Spinback');
  assert.ok(!(data.fields ?? []).some((field) => field.name === 'Population'), 'no population to show when there is no answer');
});

test('every embed in a lookup is inside the limits Discord enforces', () => {
  const payload = lookupPayload({
    snapshots: [snapshot(), snapshot({ slot: 2, name: 'spinback 2x' }), snapshot({ slot: 3, name: 'spinback 1x' })],
    config: emptyGuildConfig(GUILD),
    guild: { id: GUILD },
    staffTier: 'owner',
    pollSeconds: 20,
    at: AT,
  });

  assert.equal(payload.embeds.length, 5, 'three dossiers, the honest one and the staff one');
  for (const embed of payload.embeds) {
    const data = embed.data;
    assert.ok(data.title.length <= 256, 'title too long: ' + data.title.length);
    assert.ok((data.description ?? '').length <= 4096);
    assert.ok(data.fields.length <= 25);
    for (const field of data.fields) {
      assert.ok(field.name.length <= 256, 'field name too long: ' + field.name);
      assert.ok(field.value.length <= 1024, 'field value too long in ' + field.name + ': ' + field.value.length);
    }
    assert.equal(data.footer.text, 'Powered by Spinback');
  }
});
