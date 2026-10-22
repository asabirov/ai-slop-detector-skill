#!/usr/bin/env node
'use strict';

// Usage: node scripts/bench.js [--mb N] [--fixture slop.html] [--runs 5] [--update]
// Builds an N MB page from a fixture body, times the parse step and the whole
// detect run, and prints CPU ms per MB. It warns when a figure is twice the
// stored one. Time is CPU time, so a busy host moves it less than wall time.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { detect } = require('./detect');
const { parse } = require('./lib/html');

const ROOT = path.join(__dirname, '..');
const BASELINE = path.join(__dirname, 'bench-baseline.json');
const WARN_RATIO = 2;

function pageOf(fixture, mb) {
  const source = fs.readFileSync(path.join(ROOT, 'fixtures', fixture), 'utf8');
  const open = /<body[^>]*>/i.exec(source);
  const close = source.search(/<\/body>/i);
  if (!open || close < 0) throw new Error(`${fixture} has no <body>`);
  const body = source.slice(open.index + open[0].length, close);
  const copies = Math.ceil((mb * 1024 * 1024) / body.length);
  return source.slice(0, open.index + open[0].length) + body.repeat(copies) + source.slice(close);
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

function cpuMs() {
  const { user, system } = process.cpuUsage();
  return (user + system) / 1000;
}

function timeOf(fn, runs) {
  fn();
  const times = [];
  for (let i = 0; i < runs; i++) {
    const start = cpuMs();
    fn();
    times.push(cpuMs() - start);
  }
  return median(times);
}

function measure({ fixture, mb, runs }) {
  const source = pageOf(fixture, mb);
  const size = source.length / (1024 * 1024);
  const parseMs = timeOf(() => parse(source, { ext: 'html' }), runs);
  const detectMs = timeOf(() => detect(source, { level: 4, kind: 'artifact', ext: 'html' }), runs);
  return { parse: parseMs / size, detect: detectMs / size };
}

function hostNote() {
  return { host: os.hostname(), node: process.version, cores: os.cpus().length, load: Number(os.loadavg()[0].toFixed(1)) };
}

function main(argv) {
  const flag = (name, fallback) => {
    const at = argv.indexOf(`--${name}`);
    return at >= 0 ? argv[at + 1] : fallback;
  };
  const options = { fixture: flag('fixture', 'slop.html'), mb: Number(flag('mb', 2)), runs: Number(flag('runs', 3)) };
  const figures = measure(options);
  console.log(`${options.fixture} at ${options.mb} MB, median of ${options.runs} runs`);
  console.log(`parse  ${figures.parse.toFixed(1)} ms/MB`);
  console.log(`detect ${figures.detect.toFixed(1)} ms/MB, parse included`);
  const where = hostNote();
  console.log(`host ${where.host}, node ${where.node}, load ${where.load} on ${where.cores} cores`);
  if (where.load > where.cores) console.log('load is above the core count, so treat these figures as slow');

  const stored = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : {};
  if (argv.includes('--update')) {
    stored[options.fixture] = { parse: Math.round(figures.parse), detect: Math.round(figures.detect), node: where.node, cores: where.cores, load: where.load };
    fs.writeFileSync(BASELINE, JSON.stringify(stored, null, 2) + '\n');
    console.log(`stored in ${path.relative(ROOT, BASELINE)}`);
    return 0;
  }
  const base = stored[options.fixture];
  if (!base) {
    console.log('no stored figure for this fixture. Run with --update to store one.');
    return 0;
  }
  let warned = false;
  for (const step of ['parse', 'detect']) {
    if (figures[step] > base[step] * WARN_RATIO) {
      warned = true;
      console.warn(`WARNING: ${step} is ${figures[step].toFixed(1)} ms/MB, more than ${WARN_RATIO} times the stored ${base[step]} ms/MB`);
    }
  }
  if (!warned) console.log(`within ${WARN_RATIO} times the stored figures (parse ${base.parse}, detect ${base.detect})`);
  return 0;
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { pageOf, measure };
