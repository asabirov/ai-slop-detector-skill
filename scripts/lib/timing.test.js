'use strict';

const assert = require('node:assert/strict');
const { test } = require('./budget');
const { medianOf, growthLimit } = require('./timing');

// A clock that turns a list of durations into the start and end readings a
// timing loop sees, so each case costs nothing to run.
function clockFrom(durations) {
  let at = 0;
  const readings = [];
  for (const duration of durations) {
    readings.push(at);
    at += duration;
    readings.push(at);
  }
  let i = 0;
  return () => readings[i++];
}

test('medianOf keeps the middle sample and drops fast and slow outliers', { timeout: 1000 }, () => {
  const time = medianOf(() => {}, 5, clockFrom([5, 1, 3, 100, 4]));
  assert.equal(time, 4);
});

test('growthLimit passes a round whose large time is under the floor', { timeout: 1000 }, () => {
  const result = growthLimit({
    smallRun: () => {}, largeRun: () => {}, rounds: 2, samples: 3, floor: 10,
    now: clockFrom([1, 1, 1, 5, 6, 7]),
  });
  assert.deepEqual(result, { ok: true, small: 1, large: 6, rounds: 1 });
});

test('growthLimit retries a round over the limit and passes a later one', { timeout: 1000 }, () => {
  const result = growthLimit({
    smallRun: () => {}, largeRun: () => {}, rounds: 4, samples: 3, floor: 10,
    now: clockFrom([10, 10, 10, 90, 90, 90, 10, 10, 10, 70, 70, 70]),
  });
  assert.deepEqual(result, { ok: true, small: 10, large: 70, rounds: 2 });
});

test('growthLimit fails when every round is over the limit', { timeout: 1000 }, () => {
  const result = growthLimit({
    smallRun: () => {}, largeRun: () => {}, rounds: 2, samples: 3, floor: 10,
    now: clockFrom([10, 10, 10, 90, 90, 90, 10, 10, 10, 90, 90, 90]),
  });
  assert.deepEqual(result, { ok: false, small: 10, large: 90, rounds: 2 });
});
