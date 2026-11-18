'use strict';

// Test-only. A wall clock counts time the scheduler gives to other processes,
// so CPU load inflates the samples and a slow small input can hide real
// growth. CPU time counts only the work this process does: a process that
// waits for a CPU uses none. Each size runs a few times untimed first, so
// JIT compilation does not land inside a sample and skew the ratio. Then one
// decision comes from the minimum of a fixed number of samples of each size,
// alternated so a slow period hits both sizes alike; a fixed sample count has
// no retry for one passing round to satisfy.
// why: wall-clock growth tests failed under CPU load and passed on rerun

function cpuMillis() {
  const usage = process.cpuUsage();
  return (usage.user + usage.system) / 1000;
}

function timeOf(run, now) {
  const start = now();
  run();
  return now() - start;
}

function growthLimit({ smallRun, largeRun, samples = 5, warmup = 3, floor, ratio = 8,
  now = cpuMillis }) {
  for (let i = 0; i < warmup; i++) {
    smallRun();
    largeRun();
  }
  let small = Infinity;
  let large = Infinity;
  for (let i = 0; i < samples; i++) {
    const smallTime = timeOf(smallRun, now);
    const largeTime = timeOf(largeRun, now);
    if (smallTime < small) small = smallTime;
    if (largeTime < large) large = largeTime;
  }
  return { ok: large < floor || large < small * ratio, small, large, samples };
}

module.exports = { growthLimit };
