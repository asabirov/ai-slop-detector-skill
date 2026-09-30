'use strict';

// Test-only. node's per-test timeout cancels a test that is awaiting something;
// it cannot interrupt one that is blocking the thread, so a slow synchronous
// test passes inside any budget. Timing the body is the only enforcement left.
// why: #46

const nodeTest = require('node:test');

const DEFAULT_BUDGET_MS = 1000;
const MODIFIERS = ['only', 'skip', 'todo'];

function budgetOf(options = {}) {
  return typeof options.timeout === 'number' ? options.timeout : DEFAULT_BUDGET_MS;
}

// Measured, not interrupted: the body runs to its end and then fails.
function timed(fn, ms, name, now = () => performance.now()) {
  return function budgeted(...args) {
    const start = now();
    const settle = (value) => {
      const elapsed = now() - start;
      if (elapsed > ms) {
        throw new Error(`${name} took ${elapsed.toFixed(1)}ms, over its ${ms}ms budget`);
      }
      return value;
    };
    const result = fn.apply(this, args);
    return result && typeof result.then === 'function' ? result.then(settle) : settle(result);
  };
}

function declare(register) {
  return function budgetedTest(name, options, fn) {
    if (typeof options === 'function') { fn = options; options = {}; }
    const ms = budgetOf(options);
    if (typeof fn !== 'function') return register(name, { ...options, timeout: ms }, fn);
    // (t, done) returns before the work it measures has finished, which is the
    // silent non-enforcement this module exists to remove.
    if (fn.length > 1) throw new Error(`${name}: take a budget from a returned promise, not a callback`);
    return register(name, { ...options, timeout: ms }, timed(fn, ms, name));
  };
}

// The real exports below are built from this, so nothing can be budgeted here
// and passed through unbudgeted there.
function budgetedApi(api) {
  const wrap = (register) => {
    const budgeted = declare((...args) => register(...args));
    for (const modifier of MODIFIERS) {
      if (typeof register[modifier] === 'function') {
        budgeted[modifier] = declare((...args) => register[modifier](...args));
      }
    }
    return budgeted;
  };
  return { test: wrap(api.test), it: wrap(api.it), describe: wrap(api.describe) };
}

module.exports = {
  DEFAULT_BUDGET_MS,
  budgetOf,
  timed,
  declare,
  budgetedApi,
  ...budgetedApi(nodeTest),
  // Hooks are not tests and carry no budget; the tests they set up have theirs.
  before: nodeTest.before,
  after: nodeTest.after,
  beforeEach: nodeTest.beforeEach,
  afterEach: nodeTest.afterEach,
};
