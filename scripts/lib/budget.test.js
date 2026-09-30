'use strict';

const assert = require('node:assert/strict');
const { test, timed, declare, budgetOf, budgetedApi, DEFAULT_BUDGET_MS } = require('./budget');

// Two milliseconds of real work, for the cases that need the real clock.
function spin() { const end = Date.now() + 2; while (Date.now() < end) { /* burn */ } }

// A clock the test moves by hand, so a budget case costs nothing to run.
function clock(...readings) {
  return () => (readings.length > 1 ? readings.shift() : readings[0]);
}

test('a synchronous body that stays inside its budget returns its value', () => {
  assert.equal(timed(() => 'kept', 100, 'x', clock(0, 40))(), 'kept');
});

// The defect in #46: node's timeout cannot interrupt this body, so nothing but
// the elapsed time can fail it.
test('a synchronous body over its budget fails once it returns', () => {
  assert.throws(
    () => timed(() => 'ignored', 100, 'slow sync', clock(0, 3000))(),
    /slow sync took 3000\.0ms, over its 100ms budget/,
  );
});

test('an asynchronous body over its budget fails too', async () => {
  await assert.rejects(
    timed(async () => 'ignored', 100, 'slow async', clock(0, 250))(),
    /slow async took 250\.0ms, over its 100ms budget/,
  );
});

test('an asynchronous body inside its budget resolves with its value', async () => {
  assert.equal(await timed(async () => 'kept', 100, 'x', clock(0, 10))(), 'kept');
});

test('the arguments and the this of the body are passed through', () => {
  const ctx = { mark: 'ctx' };
  const seen = timed(function (a, b) { return [this.mark, a, b]; }, 100, 'x', clock(0))
    .call(ctx, 1, 2);
  assert.deepEqual(seen, ['ctx', 1, 2]);
});

// The cases above drive a hand-moved clock; this one proves the real one is
// what the default reads.
test('the unmocked clock is the one that measures', () => {
  assert.throws(() => timed(spin, 1, 'spin')(), /over its 1ms budget/);
});

test('a test declares its own budget, and gets the default when it does not', () => {
  const seen = [];
  const register = declare((name, options) => seen.push([name, options.timeout]));
  register('declared', { timeout: 2000 }, () => {});
  register('defaulted', () => {});
  assert.deepEqual(seen, [['declared', 2000], ['defaulted', DEFAULT_BUDGET_MS]]);
});

test('the budget node is told is the budget that is measured', () => {
  let told;
  declare((name, options, fn) => { told = { ms: options.timeout, fn }; })('x', { timeout: 50 }, () => {});
  assert.equal(told.ms, 50);
  assert.equal(budgetOf({ timeout: 50 }), 50);
});

// A callback test returns before its work is done, so the elapsed time would
// measure nothing and the budget would silently stop binding.
test('a callback-style body is refused rather than mis-measured', () => {
  assert.throws(
    () => declare(() => {})('cb', (t, done) => done()),
    /cb: take a budget from a returned promise, not a callback/,
  );
});

// A slow synchronous body in a `describe` is the same defect one level up, so
// the factory that builds the real exports is the thing worth exercising.
test('test, it and describe all time their own body', () => {
  const bodies = {};
  const capture = (key) => (name, options, fn) => { bodies[key] = fn; };
  const api = budgetedApi({ test: capture('test'), it: capture('it'), describe: capture('describe') });
  for (const key of Object.keys(api)) api[key](key, { timeout: 0 }, spin);
  for (const key of Object.keys(api)) {
    assert.throws(bodies[key], new RegExp(`${key} took .+ over its 0ms budget`), key);
  }
});

test('skip, only and todo are budgeted too, and a bodyless test is let through', () => {
  const seen = [];
  const api = budgetedApi({
    test: Object.assign(() => {}, { skip: (name, o, fn) => seen.push([name, fn]) }),
    it: () => {}, describe: () => {},
  });
  api.test.skip('skipped', { timeout: 0 }, spin);
  assert.throws(seen[0][1], /over its 0ms budget/);
  assert.doesNotThrow(() => declare(() => {})('no body at all'));
});
