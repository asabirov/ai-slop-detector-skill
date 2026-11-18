'use strict';

// Test-only. Timing noise adds time, and a short parse can slip through a
// busy scheduler before it is preempted, so the minimum of a few samples
// reads the noise in both directions. The median of several samples is the
// stable estimate. One round measures the small and the large input together,
// so a slow period hits both. A round over the limit retries a small fixed
// number of times; real growth fails every round, so one passing round is
// enough.
// why: wall-clock growth tests failed under CPU load and passed on rerun

const { performance } = require('node:perf_hooks');

function medianOf(run, samples, now) {
  const times = [];
  for (let i = 0; i < samples; i++) {
    const start = now();
    run();
    times.push(now() - start);
  }
  times.sort((a, b) => a - b);
  return times[(times.length - 1) >> 1];
}

function growthLimit({ smallRun, largeRun, rounds = 4, samples = 5, floor, ratio = 8,
  now = () => performance.now() }) {
  let small = 0;
  let large = 0;
  for (let round = 0; round < rounds; round++) {
    small = medianOf(smallRun, samples, now);
    large = medianOf(largeRun, samples, now);
    if (large < floor || large < small * ratio) {
      return { ok: true, small, large, rounds: round + 1 };
    }
  }
  return { ok: false, small, large, rounds };
}

module.exports = { medianOf, growthLimit };
