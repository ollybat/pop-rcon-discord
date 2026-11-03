/** Small formatting helpers shared by embeds, logs and commands. */

export function duration(seconds) {
  // null / undefined mean "the server did not tell us", not zero seconds.
  if (seconds === null || seconds === undefined || seconds === '') return '—';
  const total = Number(seconds);
  if (!Number.isFinite(total) || total < 0) return '—';
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return days + 'd ' + hours + 'h';
  if (hours > 0) return hours + 'h ' + minutes + 'm';
  if (minutes > 0) return minutes + 'm';
  return Math.floor(total) + 's';
}

export function truncate(text, max = 1900) {
  const value = String(text ?? '');
  if (value.length <= max) return value;
  return value.slice(0, max - 15) + '\n… (truncated)';
}

export function codeBlock(text, max = 1900) {
  return ['```', truncate(text, max - 10), '```'].join('\n');
}

export function clock(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toISOString().slice(11, 19) + ' UTC';
}

export function plural(count, singular, many = null) {
  const value = Number(count) || 0;
  return value + ' ' + (value === 1 ? singular : many ?? singular + 's');
}

export function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/** A blocky progress bar for player counts: ██████░░░░ */
export function bar(current, max, width = 10) {
  const total = Number(max);
  const value = Number(current);
  if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(value)) return '░'.repeat(width);
  const filled = Math.max(0, Math.min(width, Math.round((value / total) * width)));
  return '█'.repeat(filled) + '░'.repeat(width - filled);
}

export function quoteArgument(value) {
  const cleaned = String(value ?? '')
    .replaceAll('"', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return '"' + cleaned + '"';
}

export function maskPassword(value) {
  const text = String(value ?? '');
  if (!text) return '(not set)';
  if (text.length <= 4) return '*'.repeat(text.length);
  return text.slice(0, 2) + '*'.repeat(Math.max(3, text.length - 4)) + text.slice(-2);
}

/**
 * Strip anything that must never leave the container before it reaches a log channel, a DM or
 * an embed. Two shapes matter:
 *
 *   1. the Rust RCON URL, which carries the password in its path: ws://host:28016/<password>
 *   2. any secret we are handed outright (the stored server passwords)
 */
export function scrubSecrets(text, secrets = []) {
  let out = String(text ?? '');

  out = out.replace(/\bwss?:\/\/[^\s"'`)|,]+/gi, (match) =>
    match.replace(/^(wss?:\/\/[^/]+)(\/[\s\S]*)?$/i, (all, origin, path) => (path ? origin + '/***' : origin)),
  );

  for (const secret of Array.isArray(secrets) ? secrets : [secrets]) {
    const value = String(secret ?? '').trim();
    if (value.length >= 3) out = out.split(value).join('***');
  }

  return out;
}

const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Average neighbouring values down to `width` buckets, so a long series still fits one line. */
function resample(values, width) {
  const out = [];
  const step = values.length / width;
  for (let index = 0; index < width; index += 1) {
    const from = Math.floor(index * step);
    const to = Math.max(Math.floor((index + 1) * step), from + 1);
    const slice = values.slice(from, to);
    out.push(Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length));
  }
  return out;
}

/**
 * A one-line bar chart for a list of readings: ▁▂▄▆█
 * A flat series renders as ▄ (there is no shape to show), and an empty series renders as ''.
 */
export function sparkline(values, { width = null, min = null, max = null } = {}) {
  const numbers = (Array.isArray(values) ? values : [])
    .filter((value) => value !== null && value !== undefined && value !== '')
    .map(Number)
    .filter((value) => Number.isFinite(value));
  if (numbers.length === 0) return '';

  const points = Number.isFinite(width) && width > 1 && numbers.length > width ? resample(numbers, Math.floor(width)) : numbers;
  const low = Number.isFinite(min) ? Number(min) : Math.min(...points);
  const high = Number.isFinite(max) ? Number(max) : Math.max(...points);
  const span = high - low;

  return points
    .map((value) => {
      if (!(span > 0)) return SPARK_BLOCKS[3];
      const level = Math.round(((value - low) / span) * (SPARK_BLOCKS.length - 1));
      return SPARK_BLOCKS[Math.max(0, Math.min(SPARK_BLOCKS.length - 1, level))];
    })
    .join('');
}

/** Discord renders <t:...:R> in the reader's own timezone: "3 minutes ago". */
export function relative(value = new Date()) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  return '<t:' + Math.floor(ms / 1000) + ':R>';
}

/** <t:...:t> is the short clock time, also in the reader's timezone. */
export function shortTime(value = new Date()) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(ms)) return '—';
  return '<t:' + Math.floor(ms / 1000) + ':t>';
}

/** ▲ +3 / ▼ -2 / ▬ unchanged, for "since the last reading" lines. */
export function trendArrow(delta) {
  if (delta === null || delta === undefined || delta === '') return '';
  const value = Number(delta);
  if (!Number.isFinite(value)) return '';
  if (value > 0) return '▲ +' + value;
  if (value < 0) return '▼ ' + value;
  return '▬ no change';
}

/** "12 of 100 (12%)", without pretending the total is known when it is not. */
export function percent(value, total) {
  const part = Number(value);
  const whole = Number(total);
  if (!Number.isFinite(part)) return '—';
  if (!Number.isFinite(whole) || whole <= 0) return '—';
  return Math.round((part / whole) * 100) + '%';
}
