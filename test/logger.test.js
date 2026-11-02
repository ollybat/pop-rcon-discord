import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createLogger, resolveLevel } from '../src/logger.js';

function captureConsole() {
  const lines = [];
  const original = { log: console.log, warn: console.warn, error: console.error };

  console.log = (...args) => lines.push(args.join(' '));
  console.warn = (...args) => lines.push(args.join(' '));
  console.error = (...args) => lines.push(args.join(' '));

  return {
    lines,
    restore() {
      console.log = original.log;
      console.warn = original.warn;
      console.error = original.error;
    },
  };
}

test('resolveLevel normalises names and falls back', () => {
  assert.equal(resolveLevel('WARN'), 'warn');
  assert.equal(resolveLevel(' debug '), 'debug');
  assert.equal(resolveLevel('nope'), 'info');
  assert.equal(resolveLevel('nope', 'debug'), 'debug');
  assert.equal(resolveLevel(undefined, 'info'), 'info');
});

test('levels below the threshold stay quiet', () => {
  const sink = captureConsole();
  const logger = createLogger({ level: 'warn', timestamps: false });

  logger.debug('d');
  logger.info('i');
  logger.warn('w');
  logger.error('e');
  sink.restore();

  assert.deepEqual(sink.lines, ['WARN w', 'ERROR e']);
});

test('child loggers get a scope prefix and inherit the level', () => {
  const sink = captureConsole();
  const logger = createLogger({ level: 'info', timestamps: false }).child('rcon');

  logger.info('connected');
  logger.child('inner').warn('nested');
  sink.restore();

  assert.deepEqual(sink.lines, ['[rcon] connected', '[rcon:inner] WARN nested']);
});

test('setLevel can open and close the tap', () => {
  const sink = captureConsole();
  const logger = createLogger({ level: 'error', timestamps: false });

  logger.setLevel('debug');
  logger.debug('now visible');
  logger.setLevel('silent');
  logger.error('hidden');
  sink.restore();

  assert.deepEqual(sink.lines, ['DEBUG now visible']);
});

test('errors and objects are formatted readably', () => {
  const sink = captureConsole();
  const logger = createLogger({ level: 'info', timestamps: false });

  logger.error('failed:', new Error('boom'));
  logger.info({ players: 3 });
  sink.restore();

  assert.deepEqual(sink.lines, ['ERROR failed: boom', '{"players":3}']);
});

test('timestamps can be switched on', () => {
  const sink = captureConsole();
  const logger = createLogger({ level: 'info', timestamps: true });

  logger.info('hello');
  sink.restore();

  assert.match(sink.lines[0], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} hello$/);
});
