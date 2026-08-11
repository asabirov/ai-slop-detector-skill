'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detect, resolveLevel, kindForPath, LEVELS } = require('./detect');
const { RULES } = require('./rules');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// Each fixture is scored the way the CLI would score it — by its extension.
const run = (f, level) =>
  detect(read(f), {
    level,
    kind: kindForPath(f),
    ext: path.extname(f).replace(/^\./, ''),
  });

const SLOP_FIXTURES = ['slop.html', 'slop.md', 'slop-prose.txt', 'slop.js'];
const CLEAN_FIXTURES = ['clean.html', 'clean.md', 'clean.js'];

function firedIds(file, level = 4) {
  return new Set(run(file, level).findings.map((f) => f.rule));
}

// ── RED→GREEN: every rule must fire in at least one slop fixture ──────────
test('every rule fires in at least one slop fixture', () => {
  const covered = new Set();
  for (const f of SLOP_FIXTURES) for (const id of firedIds(f)) covered.add(id);
  const missing = RULES.map((r) => r.id).filter((id) => !covered.has(id));
  assert.deepStrictEqual(missing, [], `rules never triggered by any fixture: ${missing.join(', ')}`);
});

// ── the good page must stay silent at the most aggressive level ──────────
for (const f of CLEAN_FIXTURES) {
  test(`clean fixture "${f}" is silent at paranoid level`, () => {
    const rep = run(f, 4);
    assert.strictEqual(
      rep.findings.length,
      0,
      `expected 0 findings, got: ${rep.findings.map((x) => x.rule).join(', ')}`
    );
    assert.strictEqual(rep.verdict, 'pass');
  });
}

// ── levels of danger: a lower level never includes a higher-level rule ───
test('level filtering is monotonic and level-1 is errors-only', () => {
  const l1 = detect(read('slop.html'), { level: 1 });
  assert.ok(l1.findings.length > 0, 'level 1 should still catch hard bans');
  for (const f of l1.findings) {
    assert.strictEqual(f.level, 1, `${f.rule} leaked into level 1`);
    assert.strictEqual(f.severity, 'error', `${f.rule} is not an error`);
  }
  assert.strictEqual(l1.verdict, 'fail');

  const l2 = detect(read('slop.html'), { level: 2 });
  assert.ok(l2.findings.every((f) => f.level <= 2), 'level 3/4 rule leaked into level 2');
  assert.ok(l2.findings.length >= l1.findings.length, 'level 2 must be a superset of level 1');
});

// ── the error → non-zero-exit contract the launch gate relies on ─────────
test('any error-severity finding produces a fail verdict', () => {
  const rep = detect(read('slop.html'), { level: 1 });
  assert.strictEqual(rep.stats.errors > 0, true);
  assert.strictEqual(rep.verdict, 'fail');
});

// ── warnings alone never fail the run (so warn-only pages exit 0) ─────────
test('a warning-only page warns but does not fail', () => {
  // slop-prose.txt fires only warning-severity statistical rules (no hard bans).
  const rep = detect(read('slop-prose.txt'), { level: 4 });
  assert.ok(rep.stats.warnings > 0);
  assert.strictEqual(rep.stats.errors, 0);
  assert.strictEqual(rep.verdict, 'warn');
});

// ── packs stay on their own side of the routing ──────────────────────────
test('a source file is scored by the comments pack only', () => {
  const rep = run('slop.js', 4);
  assert.ok(rep.findings.length > 0);
  for (const f of rep.findings) {
    assert.ok(f.rule.startsWith('comment-'), `${f.rule} scored a source file`);
  }
});

test('an artifact is never scored by the comments pack', () => {
  for (const f of ['slop.html', 'slop.md', 'slop-prose.txt']) {
    for (const id of firedIds(f)) {
      assert.ok(!id.startsWith('comment-'), `${id} scored ${f}`);
    }
  }
});

test('kindForPath routes by extension', () => {
  assert.strictEqual(kindForPath('a/b/c.js'), 'source');
  assert.strictEqual(kindForPath('x.PY'), 'source');
  assert.strictEqual(kindForPath('page.html'), 'artifact');
  assert.strictEqual(kindForPath('notes.md'), 'artifact');
});

// ── what the comments pack must NOT punish ───────────────────────────────
test('API tag lines do not count toward comment length', () => {
  const doc = ['/**', ' * Fold a dimension.', ' *']
    .concat(Array.from({ length: 20 }, (_, i) => ` * @param {string} p${i} the ${i}th one`))
    .concat([' */', 'function fold(...p) { return p; }'])
    .join('\n');
  const rep = detect(doc, { level: 4, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a one-line divider between code sections is not a chaptered comment', () => {
  const src = ['// ─────────── helpers ───────────', 'const a = 1;', 'const b = 2;'].join('\n');
  const rep = detect(src, { level: 4, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a trailing comment and a URL in a string are not comment lines', () => {
  const src = ["const u = 'https://example.com'; // note", 'const v = 2;'].join('\n');
  const ctx = require('./lib/source').parseSource(src, { ext: 'js' });
  assert.strictEqual(ctx.commentLines, 0);
  assert.strictEqual(ctx.codeLines, 2);
});

test('the hash languages are parsed too', () => {
  const src = ['#!/usr/bin/env python3', '# a note about the thing', 'x = 1'].join('\n');
  const ctx = require('./lib/source').parseSource(src, { ext: 'py' });
  assert.strictEqual(ctx.commentLines, 1);
  assert.strictEqual(ctx.codeLines, 2);
});

// ── the CLI's path expansion ─────────────────────────────────────────────
test('globToRegExp: ** spans separators, * does not', () => {
  const { globToRegExp } = require('../bin/slop-detector');
  assert.ok(globToRegExp('src/**/*.js').test('src/a/b/c.js'));
  assert.ok(globToRegExp('src/*.js').test('src/a.js'));
  assert.ok(!globToRegExp('src/*.js').test('src/a/b.js'));
  assert.ok(globToRegExp('**/dist/**').test('packages/x/dist/y.js'));
  assert.ok(!globToRegExp('src/**/*.js').test('lib/a.js'));
});

test('walk skips build directories and minified files', () => {
  const { walk } = require('../bin/slop-detector');
  const found = walk(path.join(__dirname, '..', 'fixtures'));
  assert.ok(found.some((f) => f.endsWith('slop.js')));
  assert.ok(!found.some((f) => f.includes('node_modules')));
});

// ── level names resolve ──────────────────────────────────────────────────
test('resolveLevel accepts names and numbers', () => {
  assert.strictEqual(resolveLevel('ban'), 1);
  assert.strictEqual(resolveLevel('paranoid'), 4);
  assert.strictEqual(resolveLevel('2'), 2);
  assert.strictEqual(resolveLevel(undefined), 2);
  assert.throws(() => resolveLevel('nonsense'));
  assert.strictEqual(LEVELS.length, 4);
});
