import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { BRAND, BRAND_LOGO } from './theme.js';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const PNG_HEADERS = { 'content-type': 'image/png', 'cache-control': 'public, max-age=86400' };

let logoCache;

/**
 * The Spinback mark. It lives in the repository as base64 text (assets/spinback-logo.b64) so the
 * source stays plain text, and is decoded once, on the first request.
 */
export function brandLogo() {
  if (logoCache !== undefined) return logoCache;

  try {
    const encoded = readFileSync(new URL('../assets/spinback-logo.b64', import.meta.url), 'utf8');
    logoCache = Buffer.from(encoded.replace(/\s+/g, ''), 'base64');
  } catch {
    logoCache = null;
  }

  return logoCache;
}
const TEXT_HEADERS = { 'content-type': 'text/plain; charset=utf-8' };

/**
 * A tiny HTTP health endpoint so the free host's public URL answers instead of 502-ing.
 *
 *   GET /health, /status, /  ->  the bot's live state as JSON
 *   GET /ping                ->  "pong" (the cheapest possible uptime check)
 *
 * Nothing here is secret: ping, version, uptime, guild count and per-server player counts.
 */
export function createHealthServer({ logger = null, port = 0, host = '0.0.0.0', status = () => ({}) } = {}) {
  let server = null;

  const handler = (request, response) => {
    const path = (request.url ?? '/').split('?')[0];

    if (path === '/logo.png' || path === '/logo' || path === '/favicon.ico') {
      const logo = brandLogo();
      if (!logo) {
        response.writeHead(404, JSON_HEADERS);
        response.end(JSON.stringify({ ok: false, error: 'no logo bundled' }));
        return;
      }
      response.writeHead(200, PNG_HEADERS);
      response.end(logo);
      return;
    }

    if (path === '/ping') {
      response.writeHead(200, TEXT_HEADERS);
      response.end('pong');
      return;
    }

    if (path === '/' || path === '/health' || path === '/status' || path === '/healthz') {
      let payload;
      try {
        payload = { ok: true, service: BRAND.name, version: BRAND.version, logo: BRAND_LOGO, ...status() };
      } catch (error) {
        payload = { ok: false, service: BRAND.name, error: error.message };
      }

      response.writeHead(200, JSON_HEADERS);
      response.end(JSON.stringify(payload, null, 2));
      return;
    }

    response.writeHead(404, JSON_HEADERS);
    response.end(JSON.stringify({ ok: false, error: 'not found' }));
  };

  return {
    get listening() {
      return Boolean(server?.listening);
    },

    /** Where the server ended up - the useful half of the address when port 0 was requested. */
    get address() {
      const info = server?.address();
      return info && typeof info === 'object' ? info : { address: host, port };
    },

    /** Resolves with the node server, or null when no port is configured (null/undefined/false). */
    start() {
      return new Promise((resolve, reject) => {
        if (port === null || port === undefined || port === false) {
          resolve(null);
          return;
        }

        server = createServer(handler);
        server.on('clientError', (error, socket) => socket.destroy(error));
        server.once('error', reject);
        server.listen(port, host, () => {
          server?.removeListener('error', reject);
          server.on('error', (error) => logger?.warn?.('[web] ' + error.message));
          const where = server.address();
          logger?.info?.('[web] health endpoint listening on ' + host + ':' + (where?.port ?? port));
          resolve(server);
        });
      });
    },

    stop() {
      return new Promise((resolve) => {
        if (!server) {
          resolve();
          return;
        }
        const closing = server;
        server = null;
        closing.close(() => resolve());
      });
    },
  };
}

/**
 * Ask a URL for its health and time it. Never throws: a failure is part of the report.
 * Returns { url, ok, status, ms, body, error }.
 */
export async function probeHealth({ url, timeoutMs = 4000, fetchImpl = globalThis.fetch } = {}) {
  if (!url) return { url: null, ok: false, status: null, ms: null, body: null, error: 'no url' };
  if (typeof fetchImpl !== 'function') return { url, ok: false, status: null, ms: null, body: null, error: 'no fetch available' };

  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(url, { signal: controller.signal, headers: { accept: 'application/json, text/plain, */*' } });
    let body = null;
    try {
      body = (await response.text()).slice(0, 2000);
    } catch {
      body = null;
    }
    return {
      url,
      ok: response.ok,
      status: response.status,
      ms: Date.now() - started,
      body,
      error: response.ok ? null : 'HTTP ' + response.status,
    };
  } catch (error) {
    return {
      url,
      ok: false,
      status: null,
      ms: Date.now() - started,
      body: null,
      error: error?.name === 'AbortError' ? 'timed out after ' + timeoutMs + 'ms' : String(error?.message ?? error),
    };
  } finally {
    clearTimeout(timer);
  }
}
