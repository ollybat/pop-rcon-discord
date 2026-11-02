import { formatPresence, normalizeServerInfo } from './presence.js';

/** Never print a full RCON password into a console log. */
export function maskSecret(value) {
  const text = String(value ?? '');
  if (!text) return '(not set)';
  if (text.length <= 4) return '*'.repeat(text.length);
  return text.slice(0, 2) + '*'.repeat(Math.max(3, text.length - 4)) + text.slice(-2);
}

/** Human-readable lines for a raw `serverinfo` reply. */
export function summarizeServerInfo(data) {
  const info = normalizeServerInfo(data);

  if (!info) {
    return { ok: false, info: null, lines: ['serverinfo did not return JSON - check the RCON connection'] };
  }

  return {
    ok: true,
    info,
    lines: [
      'hostname    ' + info.hostname,
      'players     ' + info.players + '/' + info.max,
      'queued      ' + info.queued,
      'joining     ' + info.joining,
      'uptime      ' + (info.uptime === null ? 'unknown' : info.uptime + 's'),
      'restarting  ' + (info.restarting ? 'yes' : 'no'),
    ],
  };
}

/** The exact status line the bot would show for this server state. */
export function presenceLine(info, formats) {
  const template = info && info.restarting ? formats.resting : formats.online;
  return formatPresence(template, info ?? {});
}
