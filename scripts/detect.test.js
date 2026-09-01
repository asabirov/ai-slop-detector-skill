'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { detect, resolveLevel, kindForPath, SEVERITY, VERDICT_ICON, LEVELS } = require('./detect');
const { RULES } = require('./rules');
const { attrTextRuns, markupTokens, selectorApplies } = require('./lib/html');

const FIX = path.join(__dirname, '..', 'fixtures');
const read = (f) => fs.readFileSync(path.join(FIX, f), 'utf8');

// Each fixture is scored the way the CLI would score it — by its extension.
const run = (f, level) =>
  detect(read(f), {
    level,
    kind: kindForPath(f),
    ext: path.extname(f).replace(/^\./, ''),
    // The CLI passes the path so linked stylesheets resolve; without it the
    // fixtures would be scored by a different loader than the one that ships.
    filePath: path.join(FIX, f),
  });

const SLOP_FIXTURES = ['slop.html', 'slop.md', 'slop-prose.txt', 'slop.js', 'slop-linked-css.html'];
const CLEAN_FIXTURES = ['clean.html', 'clean.md', 'clean.js'];

function firedIds(file, level = 4) {
  return new Set(run(file, level).findings.map((f) => f.rule));
}

// ── attribute prose is prose (lessly-landing#387) ──────────────────────
// Stripping tags with `<[^>]+>` took the tooltip out with the tag. On
// lessly.com/pricing that hid the whole compare table — 26 values, 324 words,
// a third of the page's prose — and the gate reported a clean page.
test('reads prose out of human-readable attributes, and only those', () => {
  const runs = attrTextRuns(
    '<a href="/a/very/long/slug-here" class="btn primary" title="The grant reference, named">x</a>' +
      '<img src="/x.png" alt="A named grant, expiring Friday">' +
      '<span data-tip="Our recommended tier: a plan.">t</span>' +
      '<button aria-label="Close">×</button>'
  );
  assert.deepStrictEqual(runs, [
    'The grant reference, named',
    'A named grant, expiring Friday',
    'Our recommended tier: a plan.',
  ]);
});

test('a rule fires on prose that exists only in an attribute', () => {
  const page = '<html><body><p>Plans</p><p data-tip="Our recommended tier: a plan.">Scale</p></body></html>';
  const rules = detect(page, { level: 2, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('meta-label-opener'), `expected meta-label-opener, got: ${rules.join(', ')}`);
});

// ── a page is judged on the CSS it applies (lessly-hub/lessly-landing#390) ──
// One stylesheet serves every page that links it. lessly.com's home page failed
// the level-1 gate on `.font-mono`, which styles code blocks in blog posts, and
// on `.fig-mono`, which sets numerals inside diagrams. Neither class appears in
// its markup. Nobody could have fixed that from the home page.
test('mono on a class the page never uses is not that page\'s defect', () => {
  const page =
    '<html><body><style>.font-mono { font-family: Fira Mono, monospace }</style>' +
    '<p class="lede">A page that ships no code.</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(!rules.includes('mono-noncode'), `expected silence, got: ${rules.join(', ')}`);
});

test('mono on a class the page does use still fails', () => {
  const page =
    '<html><body><style>.label { font-family: Fira Mono, monospace }</style>' +
    '<p class="label">scoped to repo</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('selectorApplies is conservative — unknown means applied', () => {
  const tokens = markupTokens('<html><body><p class="a" id="main"><span></span></p></body></html>');
  // Named and present.
  assert.strictEqual(selectorApplies('.a', tokens), true);
  assert.strictEqual(selectorApplies('#main', tokens), true);
  assert.strictEqual(selectorApplies('.a span', tokens), true);
  // Named and absent.
  assert.strictEqual(selectorApplies('.b', tokens), false);
  assert.strictEqual(selectorApplies('#other', tokens), false);
  assert.strictEqual(selectorApplies('.a .b', tokens), false);
  // Nothing to go on: still judged.
  assert.strictEqual(selectorApplies('*', tokens), true);
  assert.strictEqual(selectorApplies(':root', tokens), true);
  assert.strictEqual(selectorApplies('[data-x]', tokens), true);
  assert.strictEqual(selectorApplies('p', tokens), true);
  // A tag the page does not have.
  assert.strictEqual(selectorApplies('textarea', tokens), false);
  // No markup to read at all (markdown, plain text).
  assert.strictEqual(selectorApplies('.anything', null), true);
});

// ── a kicker is where it sits, not what the sheet declares (apliteni#73) ──
// The rule read declaration blocks alone, so it reported a CSS signature for any
// uppercase rule in the sheet. Both pages below are the ones it got wrong.

// status.lessly.com. The page's one uppercase rule styles a status badge that
// sits beside its <h3>, never above it. An audit followed the finding to the
// point of writing the fix, which deletes the status from the status page.
const STATUS_PAGE =
  '<html><head><style>' +
  '.pill { font-size: 0.6875rem; letter-spacing: 0.02em; text-transform: uppercase; }' +
  '.component-head { display:flex; justify-content:space-between; }' +
  '</style></head><body>' +
  '<div class="component-head"><h3>API</h3><span class="pill">Operational</span></div>' +
  '<div class="component-head"><h3>Dashboard</h3><span class="pill">Operational</span></div>' +
  '</body></html>';

// lessly.com. Five kickers sharing one class, each directly above its <h2>,
// plus Tailwind's `.uppercase` utility on a button that sits above nothing.
const KICKER_PAGE =
  '<html><head><style>' +
  '.ta-pe { text-transform: uppercase; letter-spacing: .14em; }' +
  '.uppercase { text-transform: uppercase; }' +
  '</style></head><body>' +
  '<section><p class="ta-pe">COMPLY</p><h2>Keep it compliant while it runs</h2></section>' +
  '<section><p class="ta-pe">MEASURE</p><h2>Feel your product</h2></section>' +
  '<section><p class="ta-pe">ORGANIZE</p><h2>One account, every product</h2></section>' +
  '<section><p class="ta-pe">CONNECT</p><h2>Bring the tools you already use</h2></section>' +
  '<section><p class="ta-pe">AUTOMATE</p><h2>One surface, human or agent</h2></section>' +
  '<button class="uppercase">Get started</button>' +
  '</body></html>';

const kickers = (page) =>
  detect(page, { level: 2, kind: 'artifact', ext: 'html' }).findings.filter(
    (f) => f.rule === 'eyebrow-kicker'
  );

test('an uppercase label beside a heading is not a kicker', () => {
  const hits = kickers(STATUS_PAGE);
  assert.deepStrictEqual(hits.map((f) => f.span), [], 'the status page carries no kicker');
});

test('every kicker above a heading is reported, and none of the uppercase that is not', () => {
  const hits = kickers(KICKER_PAGE);
  assert.strictEqual(hits.length, 5, `expected 5, got: ${hits.map((f) => f.span).join(' | ')}`);
  for (const label of ['COMPLY', 'MEASURE', 'ORGANIZE', 'CONNECT', 'AUTOMATE']) {
    assert.ok(
      hits.some((f) => f.span.includes(`"${label}"`)),
      `${label} was not named in any finding`
    );
  }
  // The button is uppercase and sits above nothing.
  assert.ok(!hits.some((f) => f.span.includes('Get started')), 'a button is not a kicker');
});

test('a finding quotes the page, never a CSS signature', () => {
  for (const page of [KICKER_PAGE, read('slop.html')]) {
    for (const f of kickers(page)) {
      assert.ok(
        !/^text-transform/.test(f.span),
        `a reader cannot act on "${f.span}" — it names no element`
      );
      assert.ok(/ above /.test(f.span), `"${f.span}" does not say what it sits above`);
    }
  }
});

// The phrase in this rule's own `why` ships at .04em on a real hero, and
// status.lessly.com's badge tracks .02em. Any threshold between them hides the
// shape the rule is named after, so tracking is evidence and never a gate.
test('a kicker tracked as tight as a badge is still a kicker', () => {
  const page =
    '<html><head><style>.kicker { text-transform: uppercase; letter-spacing: .04em }</style>' +
    '</head><body><section><p class="kicker">What’s in the box</p>' +
    '<h2>What you get on day one</h2></section></body></html>';
  const hits = kickers(page);
  assert.strictEqual(hits.length, 1, `expected the hero kicker, got ${hits.length}`);
  assert.ok(hits[0].span.includes('What’s in the box'));
});

test('capitals typed into the markup need no stylesheet to count', () => {
  const hits = kickers('<html><body><section><p>WHY IT MATTERS</p><h2>Every product, one bill</h2></section></body></html>');
  assert.strictEqual(hits.length, 1, `expected 1, got ${hits.length}`);
  assert.ok(hits[0].span.includes('WHY IT MATTERS'));
});

test('a standfirst above a heading is not a micro-label', () => {
  const page =
    '<html><head><style>.lede { text-transform: uppercase }</style></head><body><section>' +
    '<p class="lede">A long introductory line that runs well past the width of any kicker</p>' +
    '<h2>Every product, one bill</h2></section></body></html>';
  assert.deepStrictEqual(kickers(page).map((f) => f.span), []);
});

// Issue #73: "WHAT'S IN THE BOX" in the `why` string was read as page text.
test('the rule never presents its own example as something it found', () => {
  const rule = RULES.find((r) => r.id === 'eyebrow-kicker');
  if (/WHAT/i.test(rule.why)) {
    assert.ok(
      /\bexample\b|\be\.g\./i.test(rule.why),
      'the example phrase must be marked as one, or it reads as evidence'
    );
  }
});

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

// ── medium is louder than a warning and still exits 0 (issue #59) ────────
test('a medium finding reports "review" and does not fail the run', () => {
  const src = ['const before = 1;']
    .concat(Array.from({ length: 14 }, (_, i) => `// a sentence about the ${i}th consideration here`))
    .concat(['const after = 2;'])
    .join('\n');
  const rep = detect(src, { level: 4, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-essay']);
  assert.strictEqual(rep.findings[0].severity, 'medium');
  assert.strictEqual(rep.stats.errors, 0);
  assert.strictEqual(rep.verdict, 'review', 'a medium must not read as a plain warning');
});

// The registry names the severities; the engine says what each one does. A new
// severity in one and not the other is the failure this catches.
test('every severity the registry declares is one the engine can render', () => {
  const { SEVERITIES } = require('./rules');
  for (const s of SEVERITIES) {
    const row = SEVERITY[s];
    assert.ok(row, `severity "${s}" has no row in detect.js SEVERITY`);
    for (const field of ['stat', 'verdict', 'mark']) {
      assert.ok(row[field], `severity "${s}" is missing "${field}"`);
    }
    assert.ok(VERDICT_ICON[row.verdict], `verdict "${row.verdict}" has no icon`);
  }
  assert.deepStrictEqual(Object.keys(SEVERITY).sort(), [...SEVERITIES].sort(), 'the two lists drifted');
});

// ── the length rule is one rule, from 12 up, with no ceiling ─────────────
test('comment-essay covers 12 prose lines and up, in one band', () => {
  const block = (n) =>
    ['const before = 1;']
      .concat(Array.from({ length: n }, (_, i) => `// a sentence about the ${i}th consideration here`))
      .concat(['const after = 2;'])
      .join('\n');
  const fired = (n) =>
    detect(block(n), { level: 4, kind: 'source', ext: 'js' }).findings.map((f) => f.rule);

  assert.deepStrictEqual(fired(11), [], '11 prose lines is under the rule');
  for (const n of [12, 17, 24, 25, 40]) {
    assert.deepStrictEqual(fired(n), ['comment-essay'], `${n} prose lines`);
  }
  assert.ok(!RULES.some((r) => r.id === 'comment-long'), 'comment-long was merged into comment-essay');
});

// ── length is no longer a merge gate; chaptering still is ────────────────
test('at level 1 the comments pack gates on chaptering, never on length', () => {
  const rep = detect(read('slop.js'), { level: 1, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered']);
  assert.strictEqual(rep.verdict, 'fail');
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

// ── issue #64 · two false positives that failed a level-1 gate ───────────

test('a dot leader in a comment table is not a chapter divider', () => {
  const src = [
    'const a = 1;',
    '/*',
    ' * Contrast ratios measured against the card background:',
    ' *',
    ' * | surface    | ratio  |',
    ' * | card edge ................ 3.02:1 |',
    ' * | body text ................ 8.14:1 |',
    ' *',
    ' * Both clear the threshold.',
    ' */',
    'const b = 2;',
  ].join('\n');
  const rep = detect(src, { level: 1, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a real divider inside a long comment still chapters it', () => {
  const src = [
    'const a = 1;',
    '// Why the cache is keyed on the tuple and not the id.',
    '// The id is reassigned by the importer, so two rows can share one.',
    '//',
    '// ─────────────────────────────',
    '//',
    '// The tuple survives the import because the importer never rewrites it,',
    '// which is the property the cache depends on.',
    '// It has held since the 4.0 migration.',
    'const b = 2;',
  ].join('\n');
  const rep = detect(src, { level: 1, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered']);
});

test('a real URI scheme quoted as code is not a fake URI', () => {
  const doc = [
    'The service reaches the graph over `neo4j://graph:7687`.',
    '',
    '```js',
    'const url = "neo4j+s://graph:7687";',
    '```',
  ].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a decorative URI in prose is still a fake URI', () => {
  const doc = 'See lessly://c4/goal for the goal model.';
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['fake-uri']);
});

// ── #631 · file:// is a registered scheme, not a costume ─────────────────

test('a file:// URL in prose is a real address, not a fake URI', () => {
  const doc = 'The browser resolves file:///Users/x/a.png to the file on disk.';
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a scheme no browser navigates is still a fake URI in prose', () => {
  for (const uri of ['ssh://git@github.com/a/b.git', 'git://host/r.git', 's3://bucket/key']) {
    const rep = detect(`The job reads ${uri} on every run.`, {
      level: 1, kind: 'artifact', ext: 'md',
    });
    assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['fake-uri'], uri);
  }
});

// ── #632 · a line break inside a paragraph is not a sentence start ───────

test('a wrapped line beginning "here is" is not a sycophancy opener', () => {
  const doc = [
    "    Derived from the cache's own path rather than resolved a second time. None",
    '    here is the "not mounted" case — CI, a container — and the caller treats it',
    '    the same way it treats a git directory that will not take the file.',
  ].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a real opener is still caught wherever a sentence or paragraph starts', () => {
  const cases = [
    "Certainly! Here's what I found.",
    'Sure, here is the summary you asked for.',
    "The run is green.\n\nHere's what I found in the logs.",
    'It failed twice. Certainly, here is why.',
  ];
  for (const doc of cases) {
    const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
    assert.deepStrictEqual([...new Set(rep.findings.map((f) => f.rule))], ['sycophancy-opener'], doc);
  }
});
