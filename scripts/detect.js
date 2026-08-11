#!/usr/bin/env node
'use strict';

// The engine: pick the rules for this level and kind, run each against the
// parsed file, collect what fires. Levels, exit codes and usage: see README.md.

const fs = require('fs');
const path = require('path');
const { parse } = require('./lib/html');
const { parseSource, syntaxFor } = require('./lib/source');
const { RULES } = require('./rules');

const LEVELS = ['ban', 'recommended', 'strict', 'paranoid'];
const DEFAULT_LEVEL = 2;

// Which rule packs read this file. A .js file is scored by the comments pack
// only: the text rules measure register in published prose and would read a
// source file as a badly written essay.
function kindForPath(file) {
  const ext = path.extname(String(file)).replace(/^\./, '').toLowerCase();
  return syntaxFor(ext) ? 'source' : 'artifact';
}

function resolveLevel(value) {
  if (value == null) return DEFAULT_LEVEL;
  const asNum = Number(value);
  if (Number.isInteger(asNum) && asNum >= 1 && asNum <= LEVELS.length) return asNum;
  const idx = LEVELS.indexOf(String(value).toLowerCase());
  if (idx !== -1) return idx + 1;
  throw new Error(`unknown --level "${value}" (use 1..${LEVELS.length} or ${LEVELS.join('/')})`);
}

// Run the detector over one file's contents. `kind` selects the packs:
// 'artifact' for HTML/markdown/prose, 'source' for a code file.
function detect(source, { level = DEFAULT_LEVEL, kind = 'artifact', ext = 'js' } = {}) {
  const ctx = kind === 'source' ? parseSource(source, { ext }) : parse(source);
  const findings = [];
  for (const rule of RULES) {
    if (rule.level > level) continue;
    if (rule.kind !== kind) continue;
    let hits;
    try {
      hits = rule.test(ctx) || [];
    } catch (err) {
      hits = [`rule crashed: ${err.message}`];
    }
    for (const span of hits) {
      findings.push({
        rule: rule.id,
        level: rule.level,
        severity: rule.severity,
        span: String(span).slice(0, 120),
        why: rule.why,
        fix: rule.fix,
      });
    }
  }
  const errors = findings.filter((f) => f.severity === 'error').length;
  const warnings = findings.length - errors;
  const verdict = errors ? 'fail' : warnings ? 'warn' : 'pass';
  return { verdict, level: LEVELS[level - 1], findings, stats: { errors, warnings } };
}

function report(rep) {
  const icon = { pass: '✓', warn: '▲', fail: '✗' }[rep.verdict];
  const lines = [];
  lines.push(
    `${icon} ${rep.verdict.toUpperCase()}  ` +
      `[level ${rep.level}]  (${rep.stats.errors} errors, ${rep.stats.warnings} warnings)`
  );
  lines.push('');
  for (const f of rep.findings) {
    const mark = f.severity === 'error' ? '✗' : '▲';
    lines.push(`  ${mark} [${f.rule}] ${f.span}`);
    lines.push(`      ${f.why}`);
    lines.push(`      fix: ${f.fix}`);
    lines.push('');
  }
  if (rep.verdict === 'pass') lines.push('  No slop patterns found at this level.');
  return lines.join('\n');
}

function main(argv) {
  const args = argv.filter((a) => !a.startsWith('--'));
  const asJson = argv.includes('--json');
  let levelArg;
  const li = argv.indexOf('--level');
  if (li !== -1) levelArg = argv[li + 1];

  if (args.length === 0) {
    process.stderr.write('usage: detect.js <file> [--level N|name] [--json]\n');
    process.exit(2);
  }
  let level;
  try {
    level = resolveLevel(levelArg);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(2);
  }

  const file = path.resolve(args[0]);
  let source;
  try {
    source = fs.readFileSync(file, 'utf8');
  } catch (err) {
    process.stderr.write(`cannot read ${file}: ${err.message}\n`);
    process.exit(2);
  }

  const rep = detect(source, {
    level,
    kind: kindForPath(file),
    ext: path.extname(file).replace(/^\./, ''),
  });
  process.stdout.write((asJson ? JSON.stringify(rep, null, 2) : report(rep)) + '\n');
  // exitCode, not exit(): process.exit() drops output still draining into a pipe.
  process.exitCode = rep.verdict === 'fail' ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { detect, report, resolveLevel, kindForPath, LEVELS, DEFAULT_LEVEL };
