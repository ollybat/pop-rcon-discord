import assert from 'node:assert/strict';
import { get as httpGet } from 'node:http';
import { test } from 'node:test';
import { createHealthServer, probeHealth } from '../src/web.js';

const status = () => ({
  bot: 'Spinback#5709',
  uptimeSeconds: 42,
  gatewayPingMs: 38,
  guilds: 1,
  servers: [{ slot: 1, name: 'Spinback 5X EU', connected: true, players: 12, max: 100, latencyMs: 9 }],
});

function get(url) {
  return new Promise((resolve, reject) => {
    httpGet(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => (body += chunk));
      response.on('end', () => resolve({ status: response.statusCode, body }));
    }).on('error', reject);
  });
}

test('the health endpoint answers /health, /ping and 404 for everything else', async () => {
  const server = createHealthServer({ port: 0, host: '127.0.0.1', status });
  const node = await server.start();
  assert.ok(node, 'the server should be listening');
  const base = 'http://127.0.0.1:' + node.address().port;

  const health = await get(base + '/health');
  assert.equal(health.status, 200);
  const payload = JSON.parse(health.body);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'Spinback');
  assert.equal(payload.bot, 'Spinback#5709');
  assert.equal(payload.servers[0].players, 12);
  assert.equal(payload.gatewayPingMs, 38);

  assert.equal((await get(base + '/')).status, 200, 'the root is the health page');

  const pong = await get(base + '/ping');
  assert.equal(pong.status, 200);
  assert.equal(pong.body, 'pong');

  const missing = await get(base + '/nope');
  assert.equal(missing.status, 404);
  assert.equal(JSON.parse(missing.body).ok, false);

  assert.equal(server.listening, true);
  await server.stop();
  assert.equal(server.listening, false);
});

test('no port means no listener, and a broken status stays a 200 with ok:false', async () => {
  const off = createHealthServer({ port: null, status });
  assert.equal(await off.start(), null);
  assert.equal(off.listening, false);

  const broken = createHealthServer({
    port: 0,
    host: '127.0.0.1',
    status: () => {
      throw new Error('store exploded');
    },
  });
  const node = await broken.start();
  const health = await get('http://127.0.0.1:' + node.address().port + '/health');
  assert.equal(health.status, 200);
  assert.equal(JSON.parse(health.body).ok, false);
  assert.match(JSON.parse(health.body).error, /store exploded/);
  await broken.stop();
});

test('probeHealth times an answer and never throws', async () => {
  const good = await probeHealth({
    url: 'https://example.test/health',
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => '{"ok":true}' }),
  });
  assert.equal(good.ok, true);
  assert.equal(good.status, 200);
  assert.equal(good.url, 'https://example.test/health');
  assert.ok(good.ms >= 0);
  assert.equal(good.error, null);

  const refused = await probeHealth({
    url: 'https://example.test/health',
    fetchImpl: async () => {
      throw new Error('ECONNREFUSED 127.0.0.1');
    },
  });
  assert.equal(refused.ok, false);
  assert.match(refused.error, /ECONNREFUSED/);

  const notOk = await probeHealth({ url: 'http://x', fetchImpl: async () => ({ ok: false, status: 502, text: async () => 'bad gateway' }) });
  assert.equal(notOk.ok, false);
  assert.equal(notOk.status, 502);
  assert.match(notOk.error, /502/);

  assert.match((await probeHealth({})).error, /no url/);
  assert.match((await probeHealth({ url: 'http://x', fetchImpl: null })).error, /no fetch/);
});
