import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createServerWatch, outageDecision, outageText } from '../src/watch.js';

const silentLogger = { info() {}, warn() {}, debug() {}, error() {} };

function down(slot = 1, error = 'ECONNREFUSED') {
  return { slot, name: 'Server ' + slot, connected: false, info: null, error };
}

function up(slot = 1) {
  return { slot, name: 'Server ' + slot, connected: true, info: { players: 3, max: 100 }, error: null };
}

test('outageDecision only shouts once the outage is long enough', () => {
  const first = outageDecision({ connected: false, seenUp: true, now: 1000, downAfterSeconds: 300 });
  assert.equal(first.action, 'none', 'the clock starts quietly');
  assert.equal(first.state.since, 1000);

  const early = outageDecision({ state: first.state, connected: false, seenUp: true, now: 1000 + 299000, downAfterSeconds: 300 });
  assert.equal(early.action, 'none');

  const late = outageDecision({ state: early.state, connected: false, seenUp: true, now: 1000 + 300000, downAfterSeconds: 300, lastError: 'ETIMEDOUT' });
  assert.equal(late.action, 'down');
  assert.equal(late.seconds, 300);
  assert.equal(late.state.alerted, true);
  assert.equal(late.state.error, 'ETIMEDOUT');

  const again = outageDecision({ state: late.state, connected: false, seenUp: true, now: 1000 + 900000, downAfterSeconds: 300 });
  assert.equal(again.action, 'none', 'one outage is reported once');
});

test('a recovery is only reported for an outage that was reported', () => {
  const recovered = outageDecision({ state: { since: 0, alerted: true }, connected: true, seenUp: true, now: 60000 });
  assert.equal(recovered.action, 'recovered');
  assert.equal(recovered.seconds, 60);

  const blip = outageDecision({ state: { since: 0, alerted: false }, connected: true, seenUp: true, now: 20000 });
  assert.equal(blip.action, 'quiet');
  assert.equal(outageDecision({ connected: true, seenUp: true }).action, 'none');
});

test('a server that was never seen up is never called down', () => {
  const decision = outageDecision({ connected: false, seenUp: false, now: 10000000, downAfterSeconds: 1 });
  assert.equal(decision.action, 'none');
  assert.equal(decision.state, null);
});

test('outageText reads like a person wrote it', () => {
  assert.equal(outageText(12), '12s');
  assert.equal(outageText(60), '1m');
  assert.equal(outageText(3599), '59m');
  assert.equal(outageText(3600), '1h 0m');
  assert.equal(outageText(3600 + 23 * 60), '1h 23m');
  assert.equal(outageText(-5), '0s');
});

test('the watch alerts once, recovers once, and stays quiet about blips', async () => {
  const events = [];
  let clock = 0;
  const watch = createServerWatch({
    notify: (event) => events.push(event),
    downAfterSeconds: 120,
    now: () => clock,
    logger: silentLogger,
  });

  await watch.observe('g', up(1));
  assert.deepEqual(events, [], 'being up is not an event');

  clock = 1000;
  await watch.observe('g', down(1));
  assert.deepEqual(events, []);
  assert.equal(watch.downFor('g', 1), 0);

  clock = 1000 + 60000;
  await watch.observe('g', down(1));
  assert.deepEqual(events, [], 'a minute is not an outage');
  assert.equal(watch.downFor('g', 1), 60);

  clock = 1000 + 121000;
  await watch.observe('g', down(1, 'ETIMEDOUT'));
  assert.equal(events.length, 1);
  assert.equal(events[0].action, 'down');
  assert.equal(events[0].seconds, 121);
  assert.equal(events[0].snapshot.error, 'ETIMEDOUT');

  clock = 1000 + 600000;
  await watch.observe('g', down(1));
  assert.equal(events.length, 1, 'no second alert for the same outage');

  clock = 1000 + 601000;
  await watch.observe('g', up(1));
  assert.equal(events.length, 2);
  assert.equal(events[1].action, 'recovered');
  assert.equal(watch.downFor('g', 1), null, 'the clock is cleared');

  clock = 1000 + 602000;
  await watch.observe('g', up(1));
  assert.equal(events.length, 2, 'staying up says nothing');
});

test('the watch keeps one clock per server and can forget them', async () => {
  const events = [];
  let clock = 5000;
  const watch = createServerWatch({ notify: (event) => events.push(event), downAfterSeconds: 10, now: () => clock, logger: silentLogger });

  await watch.observe('g', up(1));
  await watch.observe('g', down(1));
  await watch.observe('g', down(2));
  assert.equal(watch.state.size, 1, 'only the server that was seen up is tracked');

  clock = 5000 + 11000;
  await watch.observe('g', down(1));
  assert.equal(events.filter((event) => event.action === 'down').length, 1);

  watch.forget('g', 1);
  assert.equal(watch.downFor('g', 1), null);
  watch.forget('g');
  assert.equal(watch.state.size, 0);
});

test('a notifier that throws does not take the bot down', async () => {
  const warnings = [];
  let clock = 0;
  const watch = createServerWatch({
    notify: () => { throw new Error('discord is having a day'); },
    downAfterSeconds: 1,
    now: () => clock,
    logger: { ...silentLogger, warn: (line) => warnings.push(line) },
  });

  await watch.observe('g', up(1));
  clock = 5000;
  const decision = await watch.observe('g', down(1));
  assert.equal(decision.action, 'down');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /could not report down/);
});
