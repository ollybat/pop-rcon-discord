const LEVELS = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 99,
};

export const LEVEL_NAMES = Object.keys(LEVELS);

export function resolveLevel(value, fallback = 'info') {
  const wanted = String(value ?? '').trim().toLowerCase();
  return LEVELS[wanted] === undefined ? fallback : wanted;
}

/** Timestamps read better in a host panel than a bare epoch value. */
function timestamp() {
  return new Date().toISOString().replace('T', ' ').slice(0, 19);
}

function formatValue(value) {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

/**
 * Dependency-free leveled logger: debug < info < warn < error.
 * `silent` switches everything off, which is what the tests use.
 */
export function createLogger({ level = 'info', timestamps = true, scope = '' } = {}) {
  let current = resolveLevel(level);
  const prefix = scope ? '[' + scope + '] ' : '';

  const emit = (name, sink, args) => {
    if (LEVELS[name] < LEVELS[current]) return;
    const head = timestamps ? timestamp() + ' ' : '';
    const tag = name === 'info' ? '' : name.toUpperCase() + ' ';
    sink(head + prefix + tag + args.map(formatValue).join(' '));
  };

  return {
    get level() {
      return current;
    },
    setLevel(next) {
      current = resolveLevel(next, current);
      return current;
    },
    child(childScope) {
      return createLogger({
        level: current,
        timestamps,
        scope: scope ? scope + ':' + childScope : childScope,
      });
    },
    debug: (...args) => emit('debug', console.log, args),
    info: (...args) => emit('info', console.log, args),
    warn: (...args) => emit('warn', console.warn, args),
    error: (...args) => emit('error', console.error, args),
  };
}
