'use strict';
const { test } = require('./lib/budget');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BIN = path.join(__dirname, '..', 'bin', 'slop-detector.js');
const FIX = path.join(__dirname, '..', 'fixtures');

function cli(...args) {
  return spawnSync(process.execPath, [BIN, ...args], { encoding: 'utf8' });
}

test('the command line exits 0 on a clean file, 1 on an error and 2 on bad input, and --json prints the report', { timeout: 3000 }, () => {
  const clean = cli(path.join(FIX, 'clean.md'), '--no-git-ignore');
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);

  const slop = cli(path.join(FIX, 'slop.html'), '--no-git-ignore');
  assert.equal(slop.status, 1);

  assert.equal(cli(path.join(FIX, 'no-such-file.md')).status, 2);

  const json = cli(path.join(FIX, 'slop.html'), '--no-git-ignore', '--json');
  assert.equal(json.status, 1);
  const report = JSON.parse(json.stdout);
  assert.equal(report.verdict, 'fail');
  assert.ok(report.files[0].findings.length > 0);
  assert.ok(report.stats.errors > 0);
});
