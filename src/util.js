const CODE_FENCE = '```';

/** Clamp any string so it can be dropped into a Discord message safely. */
export function truncate(text, maxLength = 1900) {
  const value = String(text ?? '');
  if (value.length <= maxLength) return value;
  return value.slice(0, maxLength - 15) + '\n… (truncated)';
}

/** Wrap console output in a code block, truncated to fit one message. */
export function codeBlock(text, maxLength = 1900) {
  return [CODE_FENCE, truncate(text, maxLength - 8), CODE_FENCE].join('\n');
}

/** Quote a value for a Rust console command ("value"), stripping quotes/newlines. */
export function quoteArgument(value) {
  const cleaned = String(value)
    .replaceAll('"', ' ')
    .replaceAll('\r', ' ')
    .replaceAll('\n', ' ')
    .trim();
  return '"' + cleaned + '"';
}

export function humanDuration(seconds) {
  const total = Number(seconds);
  if (!Number.isFinite(total) || total <= 0) return '—';
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  return hours > 0 ? hours + 'h ' + minutes + 'm' : minutes + 'm';
}
