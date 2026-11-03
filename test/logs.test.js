import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LogRouter } from '../src/logs.js';

const GUILD = '1553825462315257868';
const CHANNEL = '111111111111111111';

const silentLogger = { debug() {}, info() {}, warn() {}, error() {} };

/** A store with one error-log channel and (optionally) a server password to scrub. */
function makeStore({ channelId = CHANNEL, password = null } = {}) {
  return {
    get: () => ({
      logs: { errors: channelId, status: channelId, commands: channelId, joinLeave: channelId },
      servers: password ? [{ name: 'S', host: 'h', port: 28016, password }] : [],
    }),
  };
}

/** A channel that records what was posted and edited, and can lose its messages. */
function makeClient({ sendFails = false, messageMissing = false, editFails = false } = {}) {
  const sent = [];
  const edits = [];
  let nextId = 900;
  const channel = {
    isTextBased: () => true,
    send: async (payload) => {
      if (sendFails) throw new Error('no permission');
      const message = { id: String(nextId += 1), payload };
      sent.push(message);
      return message;
    },
    messages: {
      fetch: async (id) => {
        if (messageMissing) return null;
        return {
          id,
          edit: async (payload) => {
            if (editFails) throw new Error('no permission');
            edits.push(payload);
            return true;
          },
        };
      },
    },
  };
  return { client: { channels: { fetch: async () => channel, cache: new Map([[CHANNEL, channel]]) } }, sent, edits };
}

/** A clock and a timer queue the test drives by hand: no waiting, no flakiness. */
function makeClock(start = 0) {
  let current = start;
  const timers = [];
  return {
    now: () => new Date(current),
    advance: (ms) => { current += ms; },
    setTimer: (fn, ms) => { const timer = { fn, at: current + ms, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearTimer: (timer) => { if (timer) timer.cleared = true; },
    runDueTimers: () => { for (const timer of timers) { if (timer.cleared || timer.done || timer.at > current) continue; timer.done = true; timer.fn(); } },
  };
}

function makeRouter(options = {}) {
  const clock = options.clock ?? makeClock();
  const discord = makeClient(options);
  const router = new LogRouter({
    client: discord.client,
    store: makeStore(options),
    logger: options.logger ?? silentLogger,
    queueDelayMs: 0,
    repeatWindowMs: options.repeatWindowMs ?? 15 * 60 * 1000,
    quietMs: options.quietMs ?? 60 * 1000,
    editThrottleMs: options.editThrottleMs ?? 5000,
    now: clock.now,
    setTimer: clock.setTimer,
    clearTimer: clock.clearTimer,
  });
  return { router, clock, ...discord };
}

const fault = { source: 'RCON spinback 5x', message: 'RCON command timed out after 10000ms: serverinfo', context: 'poll' };

test('an outage is one message, however many times it repeats', async () => {
  const { router, clock, sent, edits } = makeRouter();

  await router.error(GUILD, fault);
  assert.equal(sent.length, 1, 'the first failure is posted in full');
  assert.ok(!sent[0].payload.embeds[0].data.fields.some((field) => field.name === 'Repeats'), 'nothing to count yet');

  // Nineteen failures over four minutes is exactly what filled the channel up.
  for (let i = 0; i < 19; i += 1) {
    clock.advance(6000);
    await router.error(GUILD, fault);
  }

  assert.equal(sent.length, 1, 'and not one copy more');
  assert.ok(edits.length > 0, 'instead the original message is updated');
  const counter = edits[edits.length - 1].embeds[0].data.fields.find((field) => field.name === 'Repeats');
  assert.ok(counter, 'the message carries a tally');
  assert.match(counter.value, /\*\*20x\*\*/);
  assert.ok(!/Quiet again/.test(counter.value), 'it is not quiet while it is still happening');
});

test('the message says so when the fault stops', async () => {
  const { router, clock, sent, edits } = makeRouter({ quietMs: 60000 });

  await router.error(GUILD, fault);
  clock.advance(6000);
  await router.error(GUILD, fault);
  assert.equal(sent.length, 1);

  clock.advance(61000);
  clock.runDueTimers();
  await router.tail.catch(() => {});

  const counter = edits[edits.length - 1].embeds[0].data.fields.find((field) => field.name === 'Repeats');
  assert.match(counter.value, /Quiet again/);
  assert.match(counter.value, /\*\*2x\*\*/);
});

test('a different fault gets its own message', async () => {
  const { router, clock, sent } = makeRouter();

  await router.error(GUILD, fault);
  clock.advance(1000);
  await router.error(GUILD, { ...fault, message: 'connect ECONNREFUSED' });
  clock.advance(1000);
  await router.error(GUILD, { ...fault, source: 'Discord interaction' });

  assert.equal(sent.length, 3, 'three different problems, three messages');
});

test('a fault that comes back after the window is posted fresh', async () => {
  const { router, clock, sent } = makeRouter({ repeatWindowMs: 60000 });

  await router.error(GUILD, fault);
  clock.advance(61000);
  await router.error(GUILD, fault);

  assert.equal(sent.length, 2, 'yesterday\u2019s timeout is not today\u2019s');
});

test('the console is not repeated either', async () => {
  const errors = [];
  const logger = { ...silentLogger, error: (...args) => errors.push(args.join(' ')), debug() {} };
  const { router, clock } = makeRouter({ logger });

  await router.error(GUILD, fault);
  for (let i = 0; i < 5; i += 1) {
    clock.advance(6000);
    await router.error(GUILD, fault);
  }

  assert.equal(errors.length, 1, 'one console line for the episode');
  assert.match(errors[0], /RCON spinback 5x: RCON command timed out/);
});

test('edits are throttled, so a failing server cannot trip the rate limit', async () => {
  const { router, clock, edits } = makeRouter({ editThrottleMs: 5000 });

  await router.error(GUILD, fault);
  for (let i = 0; i < 8; i += 1) {
    clock.advance(20);
    await router.error(GUILD, fault);
  }

  assert.equal(edits.length, 0, 'eight failures inside five seconds cost no edit at all');
  clock.advance(6000);
  await router.error(GUILD, fault);
  assert.equal(edits.length, 1, 'and one edit afterwards');
});

test('a deleted error message is replaced by the next occurrence', async () => {
  const { router, clock, sent } = makeRouter({ messageMissing: true });

  await router.error(GUILD, fault);
  clock.advance(6000);
  await router.error(GUILD, fault);
  assert.equal(router.repeats.size, 0, 'the message it cannot edit is forgotten');

  clock.advance(6000);
  await router.error(GUILD, fault);
  assert.equal(sent.length, 2, 'so the fault is posted again instead of vanishing');
});

test('the password never reaches the error channel', async () => {
  const { router, sent } = makeRouter({ password: 'hunter2-secret' });
  await router.error(GUILD, { source: 'RCON S', message: 'auth failed for hunter2-secret', context: 'poll hunter2-secret' });

  const data = sent[0].payload.embeds[0].data;
  assert.ok(!JSON.stringify(data).includes('hunter2-secret'), 'nor its fragments');
  assert.ok(!JSON.stringify(data).includes('hunter2'));
  assert.match(data.description, /\*\*\*/);
});

test('a dead channel is reported once and never thrown', async () => {
  const { router, clock } = makeRouter({ channelId: null });
  await router.error(GUILD, fault);
  clock.advance(6000);
  await router.error(GUILD, fault);
  assert.equal(router.repeats.size, 1);
  router.forgetRepeats();
  assert.equal(router.repeats.size, 0);
});
