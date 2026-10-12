'use strict';

const { test } = require('./lib/budget');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { performance } = require('node:perf_hooks');
const { detect, resolveLevel, kindForPath, SEVERITY, VERDICT_ICON, LEVELS } = require('./detect');
const { RULES } = require('./rules');
const { NAMED } = require('./lib/entities');
const {
  attrTextRuns,
  cssRules,
  plainText,
  paragraphs,
  visibleTextRuns,
  decodeEntities,
  parse,
  stripTags,
  markupTokens,
  markupElements,
  selectorApplies,
  selectorTargets,
} = require('./lib/html');

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

const SLOP_FIXTURES = ['slop.html', 'slop.md', 'slop-prose.txt', 'slop.js', 'slop-linked-css.html', 'slop-table-footnote.tsx', 'slop-entities.html', 'slop-entities.md', 'slop-html-ownership.md', ...fs.readdirSync(FIX).filter((f) => f.startsWith('slop-ui-'))];
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

// ── an entity is the text a reader meets ────────────────────────────────
// Six names decoded, and only inside an attribute. So a page could spell its
// dotted chain `&middot;` or pad the dots with `&nbsp;` and no text rule saw a
// dot at all. The reader sees one line either way.
test('decodes the named entities a reader meets, not only the numeric ones', { timeout: 1000 }, () => {
  assert.deepStrictEqual(
    visibleTextRuns(
      '<p>draft &middot; 2026 &middot; brainstorm</p>' +
        '<p>beta&nbsp;&middot;&nbsp;internal</p>' +
        '<p>Paris &rarr; Berlin &mdash; &euro;40</p>' +
        '<p>&quux; stays</p>'
    ),
    ['draft · 2026 · brainstorm', 'beta · internal', 'Paris → Berlin — €40', '&quux; stays']
  );
  assert.ok(plainText('<p>Total &euro;40 &hellip; done</p>', true).includes('€40 … done'));
  assert.ok(firedIds('slop-entities.html', 2).has('middot-chain'));
  // Markdown prints an entity too, so the prose streams decode as well.
  assert.strictEqual(plainText('a &middot; b &middot; c', false), 'a · b · c');
  assert.deepStrictEqual(paragraphs('a &middot; b', false), ['a · b']);
});

test('reads numeric HTML replacement glyphs in visible text and attributes', { timeout: 1000 }, () => {
  const page = '<p>Status &#149; 2026 &#x95; Active</p>' +
    '<p>It&#146;s important to note this.</p>' +
    '<span title="It&#x92;s crucial to remember the date.">Update</span>';
  const findings = detect(page, { level: 4, kind: 'artifact', ext: 'html' }).findings;
  assert.deepStrictEqual(visibleTextRuns(page).slice(0, 2), [
    'Status • 2026 • Active',
    'It’s important to note this.',
  ]);
  assert.deepStrictEqual(attrTextRuns(page), ['It’s crucial to remember the date.']);
  assert.strictEqual(findings.filter((f) => f.rule === 'middot-chain').length, 1);
  assert.strictEqual(findings.filter((f) => f.rule === 'hedge-opener').length, 2);
});

// One pass, and only a character a reader can be shown. Three passes let a
// produced ampersand be read again, so `&#38;middot;` — the text `&middot;` on
// the page — became a dot nobody sees. A code point past Unicode's last one threw
// out of the whole run, and a lone surrogate came back as half a character.
test('decodes once, and leaves what it cannot resolve as written', { timeout: 1000 }, () => {
  assert.deepStrictEqual(
    visibleTextRuns('<p>&#38;middot; and &#x26;lt;b&#x26;gt;</p>'),
    ['&middot; and &lt;b&gt;']
  );
  assert.strictEqual(decodeEntities('&#1114112; &#xD800; &#x26A;'), '&#1114112; &#xD800; ɪ');
  // The whole-page prose stream drops a name this engine cannot resolve, which it
  // did before. Done as a second pass it ate the name a numeric ampersand had
  // just produced, so the stream reported nothing where the page prints a name.
  assert.strictEqual(plainText('<p>&#38;middot;</p>', true), '&middot;');
  assert.strictEqual(plainText('<p>&quux; x</p>', true), 'x');
  // Decoding runs last, after the markdown syntax is stripped, so a character it
  // produces is never read as syntax. CommonMark resolves an entity after block
  // structure: `&#35; x` prints `# x` in a paragraph.
  assert.strictEqual(plainText('&#35; not a heading', false), '# not a heading');
  assert.deepStrictEqual(paragraphs('one&#10;&#10;two', false), ['one two']);
  assert.ok(firedIds('slop-entities.html').has('heading-period'));
});

// ── the table is the standard's, and names are case-sensitive ───────────
// Six names were hand-picked, so `&nearr;` and `&thinsp;` got silence. The whole
// HTML5 list decodes now, and a lower-cased lookup would have made `&Aacute;`
// and `&aacute;` the same letter.
test('decodes every HTML5 name, and reads its case', { timeout: 1000 }, () => {
  assert.strictEqual(Object.keys(NAMED).length, 2125);
  assert.strictEqual(decodeEntities('&nearr; &thinsp; &copy; &alpha;'), '↗ \u2009 © α');
  assert.strictEqual(decodeEntities('&Aacute; &aacute;'), 'Á á');
  assert.strictEqual(decodeEntities('&AACUTE;'), '&AACUTE;');
  assert.strictEqual(decodeEntities('&#X26;lt;'), '&lt;');
});

test('keeps escaped Markdown references literal with odd backslash counts', { timeout: 1000 }, () => {
  for (const reference of ['&nearr;', '&#8599;', '&#x2197;']) {
    for (const count of [1, 3]) {
      const source = `Write ${'\\'.repeat(count)}${reference} to spell the reference.`;
      assert.ok(plainText(source, false).includes(reference), source);
      assert.ok(paragraphs(source, false)[0].includes(reference), source);
      assert.ok(!detect(source, { level: 4, kind: 'artifact', ext: 'md' }).findings
        .some((finding) => finding.rule === 'external-link-arrow'), source);
    }
    for (const count of [0, 2]) {
      const source = `Write ${'\\'.repeat(count)}${reference} to spell the reference.`;
      assert.ok(plainText(source, false).includes('↗'), source);
      assert.ok(detect(source, { level: 4, kind: 'artifact', ext: 'md' }).findings
        .some((finding) => finding.rule === 'external-link-arrow'), source);
    }
  }
  assert.strictEqual(plainText('<p>Write &nearr; here.</p>', true), 'Write ↗ here.');
});

test('keeps Markdown escapes when prose shares a file with raw HTML', { timeout: 1000 }, () => {
  for (const html of ['<span>text</span>', '\n\n<div>text</div>']) {
    for (const count of [1, 2, 3, 4]) {
      const source = `Write ${'\\'.repeat(count)}&nearr; here. ${html}`;
      const ctx = parse(source, { ext: 'md' });
      assert.strictEqual(ctx.isHtml, false, source);
      assert.strictEqual(ctx.codeless.includes('↗'), count % 2 === 0, source);
      assert.strictEqual(ctx.paragraphs[0].includes('↗'), count % 2 === 0, source);
      assert.strictEqual(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
        .some((finding) => finding.rule === 'external-link-arrow'), count % 2 === 0, source);
    }
  }
  assert.strictEqual(parse('<p>Write &nearr; here.</p>', { ext: 'html' }).codeless, 'Write ↗ here.');
});

test('limits Markdown numeric reference digits without limiting HTML', { timeout: 1000 }, () => {
  for (const [reference, decodes] of [
    ['&#8599;', true], ['&#0008599;', true], ['&#00008599;', false],
    ['&#x2197;', true], ['&#x002197;', true], ['&#x00002197;', false],
  ]) {
    const source = `Write ${reference} here.`;
    const expected = decodes ? '↗' : reference;
    assert.ok(plainText(source, false).includes(expected), source);
    assert.ok(paragraphs(source, false)[0].includes(expected), source);
    assert.strictEqual(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), decodes, source);
    assert.ok(plainText(`<p>${source}</p>`, true).includes('↗'), source);
  }
  const mixed = 'Write &#00008599; with <span>text</span>.';
  assert.ok(parse(mixed, { ext: 'markdown' }).codeless.includes('&#00008599;'));
  assert.ok(!detect(mixed, { level: 1, kind: 'artifact', ext: 'markdown' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(firedIds('slop-entities.md', 1).has('external-link-arrow'));
});

test('hides raw HTML script, style, and code contents in Markdown', { timeout: 1000 }, () => {
  for (const tag of ['script', 'style', 'code', 'pre']) {
    const source = `<${tag}>const value = "↗";</${tag}>\n\nHello.`;
    const ctx = parse(source, { ext: 'md' });
    assert.ok(!ctx.codeless.includes('↗'), tag);
    assert.ok(!ctx.text.includes('↗'), tag);
    assert.ok(!ctx.paragraphs.some((p) => p.includes('↗')), tag);
    assert.ok(!detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), tag);
  }
  const comment = '<!-- ↗ <span title="Visit the site &nearr;"> -->\n\nHello.';
  const ctx = parse(comment, { ext: 'md' });
  assert.ok(!ctx.codeless.includes('↗'));
  assert.deepStrictEqual(ctx.attrs, []);
});

test('reads human-readable raw HTML attributes in Markdown', { timeout: 1000 }, () => {
  const arrow = '<span title="Visit the site &nearr;">Update</span>';
  const hedge = '<span title="It&rsquo;s important to note this.">Update</span>';
  assert.deepStrictEqual(parse(arrow, { ext: 'md' }).attrs, ['Visit the site ↗']);
  assert.ok(detect(arrow, { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(detect(hedge, { level: 4, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'hedge-opener'));
  assert.deepStrictEqual(parse('title="Visit the site &nearr;"', { ext: 'md' }).attrs, []);
});

test('uses HTML reference rules inside Markdown raw HTML blocks', { timeout: 1000 }, () => {
  for (const reference of ['\\&nearr;', '&#00008599;', '&#x00002197;']) {
    const block = `<div>Write ${reference} here.</div>`;
    const prose = `Write ${reference} here.\n\n<span>Update</span>`;
    assert.ok(parse(block, { ext: 'md' }).codeless.includes('↗'), reference);
    assert.ok(detect(block, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), reference);
    assert.ok(!detect(prose, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), reference);
  }
  const spanBlock = '<span>\nWrite \\&nearr; here.\n</span>';
  assert.ok(parse(spanBlock, { ext: 'md' }).codeless.includes('↗'));
  assert.ok(detect(spanBlock, { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  const inlineSpan = 'Write \\&nearr; with <span>text</span>.';
  assert.ok(!parse(inlineSpan, { ext: 'md' }).codeless.includes('↗'));
  const spanInParagraph = 'Write here.\n<span>\n\\&nearr; stays literal.\n</span>';
  assert.ok(!parse(spanInParagraph, { ext: 'md' }).codeless.includes('↗'));
});

test('keeps visible angle text and Markdown autolink labels', { timeout: 1000 }, () => {
  for (const source of ['Show <↗> here.', 'Show \\<↗\\> here.',
    '<https://example.com/↗>', '[https://example.com/↗](https://example.com/arrow)']) {
    const ctx = parse(source, { ext: 'md' });
    assert.ok(ctx.codeless.includes('↗'), source);
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
});

test('keeps backticks and fence text visible inside raw HTML', { timeout: 1000 }, () => {
  for (const source of [
    '<div>Read `&nearr;` here.</div>',
    '<div>\n```\n&nearr;\n```\n</div>',
    '<span title="Read `&nearr;` here.">Update</span>',
  ]) {
    assert.ok(parse(source, { ext: 'md' }).codeless.includes('↗'), source);
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  const inline = '`value` <div>\\&nearr;</div>';
  assert.ok(!detect(inline, { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('keeps escaped hidden HTML openers visible in Markdown', { timeout: 1000 }, () => {
  for (const tag of ['script', 'style', 'code', 'pre']) {
    const escaped = `Write \\<${tag}>↗\\</${tag}> here.`;
    const raw = `<div><${tag}>↗</${tag}></div>`;
    assert.ok(detect(escaped, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), escaped);
    assert.ok(!detect(raw, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), raw);
  }
  const comment = 'Write \\<!-- ↗ --> here.';
  assert.ok(detect(comment, { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('keeps text after an HTML comment ending with --!>', { timeout: 1000 }, () => {
  for (const source of [
    'Write <!-- hidden --!> ↗ here.',
    '<div><!-- hidden --!> ↗ here.</div>',
    '<div><!-->↗</div>',
    '<div><!--->↗</div>',
    '<!-- hidden --!>\n\nWrite \\&nearr; here.',
  ]) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(!detect('<!-- ↗ -->', { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('uses HTML references only inside valid raw HTML blocks', { timeout: 1000 }, () => {
  for (const source of [
    '> <div>Write \\&nearr; here.</div>',
    '- <div>Write \\&nearr; here.</div>',
    '</div>Write \\&nearr; here.',
    '<textarea>\n\nWrite \\&nearr; here.\n</textarea>',
  ]) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  for (const source of [
    '<output>Write \\&nearr; here.</output>',
    '<custom-tag @bad>\nWrite \\&nearr; here.\n</custom-tag>',
  ]) {
    assert.ok(!detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
});

test('preserves angle text with invalid HTML tag grammar', { timeout: 1000 }, () => {
  for (const source of ['Show <x @↗> here.', 'Show <x ↗> here.', 'Show </x ↗> here.',
    'Show <span @↗> here.']) {
    assert.ok(parse(source, { ext: 'md' }).codeless.includes('↗'), source);
    assert.ok(parse(source, { ext: 'md' }).runs.some((run) => run.includes('↗')), source);
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(!detect('<div>Show <span @↗> here.</div>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('lets a Markdown code span close inside tag-shaped text', { timeout: 1000 }, () => {
  for (const source of ['`text\n<span title="`↗">', '`text\n<span title="`">↗`']) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(!detect('`text <span title="↗">`',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('keeps escaped backticks visible and hides quoted fences', { timeout: 1000 }, () => {
  assert.ok(detect('Read \\`↗\\` here.',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(!detect('Read \\\\`↗` here.',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(!detect('> ~~~\n> ↗\n> ~~~',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('uses HTML syntax within a raw HTML block', { timeout: 1000 }, () => {
  for (const source of ['<div>\n\\<script>↗</script>\n</div>',
    '<div>\n\\<code>↗</code>\n</div>', '<div>\n\\<!-- ↗ -->\n</div>',
    '<div>\n<span @↗>\n</span>\n</div>']) {
    assert.ok(!detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(detect('Text \\<script>↗\\</script>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('starts complete-tag HTML blocks after completed Markdown blocks', { timeout: 1000 }, () => {
  for (const source of ['# Heading\n<span>\n\\&nearr;\n</span>',
    '# Heading\n</span>\n\\&nearr;', '```\nvalue\n```\n<span>\n\\&nearr;\n</span>',
    '---\n<span>\n\\&nearr;\n</span>', 'Heading\n===\n<span>\n\\&nearr;\n</span>',
    'Text\n> <span>\n> \\&nearr;\n> </span>']) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(!detect('Text\n<span>\n\\&nearr;\n</span>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('ends raw HTML when its Markdown list container ends', { timeout: 1000 }, () => {
  assert.ok(!detect('- <div>\n  Text\n\\&nearr;',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(detect('- <div>\n  \\&nearr;\n  </div>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('keeps comments inside HTML attribute values from hiding text', { timeout: 1000 }, () => {
  for (const source of ['<div data-x="<!--">↗</div>',
    '<div title="A <!-- marker">↗</div>']) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
  assert.ok(!detect('<div><!-- ↗ --></div>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

test('preserves literal markup and comments in textarea text', { timeout: 1000 }, () => {
  for (const source of ['<textarea><code>↗</code></textarea>',
    '<textarea><!-- ↗ --></textarea>', '<textarea>\n\n<script>↗</script>\n</textarea>']) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
});

test('keeps HTML code hidden across a Markdown blank line', { timeout: 1000 }, () => {
  assert.ok(!detect('<div><code>\n\n↗\n</code></div>',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.strictEqual(markdownArrow('<div><code>\n\n↗\n</code>\nWrite \\&nearr; here.'), false);
});

test('accepts type 6 HTML names and multiline opening prefixes', { timeout: 1000 }, () => {
  for (const source of ['<search>\\&nearr;</search>', '<div\n>\\&nearr;</div>',
    '<textarea\n>\\&nearr;\n</textarea>']) {
    assert.ok(detect(source, { level: 1, kind: 'artifact', ext: 'md' }).findings
      .some((finding) => finding.rule === 'external-link-arrow'), source);
  }
});

test('limits Markdown tags to paragraphs and accepts CRLF whitespace', { timeout: 1000 }, () => {
  assert.ok(detect('Read <x\n\ndata-x="↗"> text.',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
  assert.ok(!detect('Read <x\r\ndata-x="↗"> text.',
    { level: 1, kind: 'artifact', ext: 'md' }).findings
    .some((finding) => finding.rule === 'external-link-arrow'));
});

const markdownArrow = (source) => detect(source,
  { level: 1, kind: 'artifact', ext: 'md' }).findings
  .some((finding) => finding.rule === 'external-link-arrow');

test('reads code span closing backticks inside code without Markdown escapes', { timeout: 1000 }, () => {
  for (const source of ['Read `↗\\` here.', 'Read ``↗\\`` here.']) {
    assert.strictEqual(markdownArrow(source), false, source);
  }
  assert.strictEqual(markdownArrow('Read `code\\` ↗ `tail` here.'), true);
  assert.strictEqual(markdownArrow('Read \\`↗\\` here.'), true);
  assert.strictEqual(markdownArrow('Read `text <span title="\\`">↗ here.'), true);
});

test('keeps raw HTML script and style text in one lexical state', { timeout: 1000 }, () => {
  for (const source of ['<div><script>const x="<!--";</script>↗</div>',
    '<div><style>/* <!-- */</style>↗</div>',
    '<div><script>const x="<span title=\'";</script>↗</div>']) {
    assert.strictEqual(markdownArrow(source), true, source);
  }
  assert.strictEqual(markdownArrow('<div><script>↗</script></div>'), false);
});

test('keeps later comments hidden after earlier comments are removed', { timeout: 1000 }, () => {
  for (const source of ['Text <!-- first --> <span>x</span> <!-- ↗ --> tail',
    'Text <!-- a longer first comment --> <span>x</span> <!-- ↗ --> tail',
    '<div><!-- first --> x <!-- ↗ --> tail</div>']) {
    assert.strictEqual(markdownArrow(source), false, source);
  }
  assert.strictEqual(markdownArrow('Text <!-- first --> <span>↗</span> tail'), true);
});

test('keeps attribute data separate from tags and comments', { timeout: 1000 }, () => {
  for (const source of ['<div title="Read <script>↗</script> now.">text</div>',
    '<div title="Read <code>↗</code> now.">text</div>',
    '<div title="Read\n<!-- ↗ --> now.">text</div>',
    '<div title=\'Read &nearr; now.\'>text</div>',
    'A <!-- x --> <span title="Read <!-- ↗ --> now.">text</span>.']) {
    assert.strictEqual(markdownArrow(source), true, source);
  }
  assert.strictEqual(markdownArrow('<div title="\n<code>\n">\n\n\\&nearr;'), false);
  assert.strictEqual(markdownArrow('<div data-x=a"b>↗</div>'), true);
});

test('keeps inline textarea tag spellings as text', { timeout: 1000 }, () => {
  assert.strictEqual(markdownArrow('Read <textarea><code>↗</code></textarea> here.'), true);
  assert.strictEqual(markdownArrow('Read <textarea><!-- ↗ --></textarea> here.'), true);
});

test('ends raw HTML and fences with their list or quote containers', { timeout: 1000 }, () => {
  for (const source of ['- item\n\n  <div>\n  text\n\\&nearr;',
    '- item\n  - <div>\n    text\n  \\&nearr;',
    '10. <div>\n    text\n\\&nearr;',
    '> - <div>\n>   text\n> \\&nearr;']) {
    assert.strictEqual(markdownArrow(source), false, source);
  }
  assert.strictEqual(markdownArrow('- ~~~\n  ↗\n  ~~~'), false);
  for (const source of ['> ~~~\n> code\n<span>\n\\&nearr;\n</span>',
    '- ~~~\n  code\n<span>\n\\&nearr;\n</span>']) {
    assert.strictEqual(markdownArrow(source), true, source);
  }
  assert.strictEqual(markdownArrow('- > <div>\n  > \\&nearr;\n  > </div>'), true);
});

test('scans many unfinished HTML prefixes within its budget', { timeout: 1000 }, () => {
  const ctx = parse('<div>\n' + '<a '.repeat(3000), { ext: 'md' });
  assert.ok(ctx.isHtml === false);
});

test('keeps inline comments and raw text owners separate', { timeout: 1000 }, () => {
  const script = parse('Read <script>const x="<textarea>";</script>↗ here.', { ext: 'md' });
  assert.deepStrictEqual(script.runs, ['Read ↗ here.']);
  assert.deepStrictEqual(script.attrs, []);
  for (const source of ['Text <!-- <textarea> --> <code>↗</code> tail',
    'Text <!-- <textarea> --> <!-- ↗ --> tail']) {
    const ctx = parse(source, { ext: 'md' });
    assert.deepStrictEqual(ctx.runs, ['Text tail'], source);
    assert.deepStrictEqual(ctx.attrs, [], source);
  }
  for (const name of ['script', 'style']) {
    assert.strictEqual(markdownArrow(`<div><${name}>\n\n<!-- </${name}> -->\n↗`), true, name);
  }
});

test('resolves comment and textarea ownership before Markdown code', { timeout: 1000 }, () => {
  assert.strictEqual(markdownArrow('Text <!-- ` --> ↗ ` tail'), true);
  assert.strictEqual(markdownArrow('Read <textarea>`↗`</textarea> here.'), true);
  assert.strictEqual(markdownArrow('<div><textarea>\n\n<code>↗</code>\n</textarea></div>'), true);
  assert.strictEqual(markdownArrow('Read <textarea>`&nearr;`</textarea> here.'), false);
});

test('keeps source offsets while it separates readable attributes', { timeout: 1000 }, () => {
  const ctx = parse('<div><!-- hidden --><span title="Visit the site ↗">text</span></div>',
    { ext: 'md' });
  assert.deepStrictEqual(ctx.runs, ['text']);
  assert.deepStrictEqual(ctx.attrs, ['Visit the site ↗']);
  assert.deepStrictEqual(ctx.paragraphs, ['text', 'Visit the site ↗']);
});

test('keeps alternate comment endings in their HTML or Markdown context', { timeout: 1000 }, () => {
  const escaped = parse('<div><!--\n\n--!> plain visible?\n\n' +
    '<span title="Visit ↗ now">text</span>', { ext: 'md' });
  assert.deepStrictEqual(escaped.runs, []);
  assert.deepStrictEqual(escaped.attrs, []);
  const raw = parse('<div><!-- hidden --!><span title="Visit ↗ now">text</span></div>',
    { ext: 'md' });
  assert.deepStrictEqual(raw.runs, ['text']);
  assert.deepStrictEqual(raw.attrs, ['Visit ↗ now']);
  const inline = parse('Text <!-- hidden --!> <span title="Visit ↗ now">text</span>',
    { ext: 'md' });
  assert.deepStrictEqual(inline.runs, ['Text <!-- hidden --!>', 'text']);
  assert.deepStrictEqual(inline.attrs, ['Visit ↗ now']);
});

test('removes ordered-list continuation indentation before block checks', { timeout: 1000 }, () => {
  assert.strictEqual(markdownArrow('10. item\n\n    ~~~\n    ↗\n    ~~~'), false);
  assert.strictEqual(markdownArrow('10. item\n\n    <div>\n    \\&nearr;\n    </div>'), true);
  assert.strictEqual(markdownArrow('1. item\n\n   ~~~\n   ↗\n   ~~~'), false);
  assert.strictEqual(markdownArrow('> ~~~\n> - ↗\n> ~~~'), false);
  assert.strictEqual(markdownArrow('- <div>\n  - text\n  \\&nearr;\n  </div>'), true);
  assert.strictEqual(markdownArrow('- <textarea>\n  - text\n  \\&nearr;\n  </textarea>'), true);
});

test('scans unfinished comments and many raw lines with bounded growth', { timeout: 2000 }, () => {
  const median = (source) => {
    parse(source, { ext: 'md' });
    const times = [];
    for (let i = 0; i < 5; i++) {
      const start = performance.now();
      parse(source, { ext: 'md' });
      times.push(performance.now() - start);
    }
    return times.sort((a, b) => a - b)[2];
  };
  const commentSmall = median('Read ' + '<!-- '.repeat(16000));
  const commentLarge = median('Read ' + '<!-- '.repeat(32000));
  const lineSmall = median('<div>\n' + 'a\n'.repeat(16000));
  const lineLarge = median('<div>\n' + 'a\n'.repeat(32000));
  assert.ok(commentLarge < commentSmall * 2.8,
    `unfinished comments grew ${commentLarge / commentSmall} times`);
  assert.ok(lineLarge < lineSmall * 2.8,
    `short raw lines grew ${lineLarge / lineSmall} times`);
});

test('scans multiline unfinished raw tokens with bounded growth', { timeout: 2000 }, () => {
  const median = (values) => values.sort((a, b) => a - b)[3];
  const measure = (source) => {
    const start = performance.now();
    parse(source, { ext: 'md' });
    return performance.now() - start;
  };
  for (const opener of ['<!--\n', '<a title="']) {
    const sources = [6000, 24000].map((count) => '<div>\n' + opener + 'abc\n'.repeat(count));
    for (let round = 0; round < 2; round++) {
      for (const source of sources) measure(source);
    }
    const times = [[], []];
    for (let round = 0; round < 7; round++) {
      for (const index of round % 2 ? [1, 0] : [0, 1]) {
        times[index].push(measure(sources[index]));
      }
    }
    const small = median(times[0]);
    const large = median(times[1]);
    console.log(JSON.stringify({ opener, small, large, ratio: large / small, times }));
    assert.ok(large < small * 8,
      `${JSON.stringify(opener)} grew ${large / small} times for four times the input`);
  }
});

test('keeps boundary-prefix custom elements inside a visible run', { timeout: 1000 }, () => {
  for (const tag of ['dt-label', 'dd-value', 'dl-label', 'br-icon']) {
    const page = `<p>draft · <${tag}>2026</${tag}> · brainstorm</p>`;
    assert.deepStrictEqual(visibleTextRuns(page), ['draft · 2026 · brainstorm'], tag);
    assert.ok(detect(page, { level: 4, kind: 'artifact', ext: 'html' }).findings
      .some((finding) => finding.rule === 'middot-chain'), tag);
  }
  assert.deepStrictEqual(visibleTextRuns('<dl><dt>Release</dt><dd>2026</dd></dl><p>a<br>b</p>'),
    ['Release', '2026', 'a', 'b']);
  assert.ok(run('slop-entities.html', 4).findings.some((finding) =>
    finding.rule === 'middot-chain' && finding.span === 'alpha · custom · omega'));
});

test('keeps inline SVG and label text in a visible chain', { timeout: 1000 }, () => {
  for (const page of [
    '<p>draft · <svg><use href="#icon"/></svg>2026 · brainstorm</p>',
    '<p>draft · <label>2026</label> · brainstorm</p>',
  ]) {
    assert.deepStrictEqual(visibleTextRuns(page), ['draft · 2026 · brainstorm']);
    const findings = detect(page, { level: 4, kind: 'artifact', ext: 'html' }).findings;
    assert.ok(findings.some((finding) => finding.rule === 'middot-chain' &&
      finding.span === 'draft · 2026 · brainstorm'), JSON.stringify(findings));
  }
  assert.deepStrictEqual(visibleTextRuns('<dl><dt>Release</dt><dd>draft · 2026 · brainstorm</dd><dd>beta · internal · preview</dd></dl>'), [
    'Release', 'draft · 2026 · brainstorm', 'beta · internal · preview',
  ]);
});

// Definition labels and values are separate runs. Inline markup stays in its
// surrounding run so text rules can still read the complete line.
test('separates definition values while preserving inline text', { timeout: 1000 }, () => {
  const dl = '<dl><dt>Bookings this year</dt><dd>14 &middot; 1 no-show</dd></dl>';
  assert.deepStrictEqual(visibleTextRuns(dl), ['Bookings this year', '14 · 1 no-show']);
  assert.deepStrictEqual(visibleTextRuns(dl, { markup: false }), ['Bookings this year 14 · 1 no-show']);
  // A phrasing element marks up words inside a line, so it does not end one. An
  // inline icon is the same shape.
  assert.deepStrictEqual(visibleTextRuns('<p>draft · <strong>2026</strong> · brainstorm</p>'), [
    'draft · 2026 · brainstorm',
  ]);
  assert.deepStrictEqual(visibleTextRuns('<p>draft · <img src="i.png" alt=""> 2026 · x</p>'), [
    'draft · 2026 · x',
  ]);
  assert.deepStrictEqual(visibleTextRuns('<p>draft · <time-ago>2026</time-ago> · x</p>'), [
    'draft · 2026 · x',
  ]);
  assert.deepStrictEqual(visibleTextRuns('<p>one<svg><text>label</text></svg>two</p>'), [
    'one',
    'label',
    'two',
  ]);
  assert.deepStrictEqual(visibleTextRuns('<p>a · <svg><use href="#d"/></svg> b · c</p>'), [
    'a · b · c',
  ]);
  // A <br> does end one, and a <span> around a value still sets it apart.
  assert.deepStrictEqual(visibleTextRuns('<p>a · b<br>c · d</p>'), ['a · b', 'c · d']);
  assert.deepStrictEqual(visibleTextRuns('<div><span>Due</span><span>4 April</span></div>'), [
    'Due',
    '4 April',
  ]);
  // A markdown page's angle-bracket placeholder is not an element, and splitting
  // on it would stop this line being read at all.
  const markdown = 'Due: <date> · Priority: <none|low> · Notes: <preview>';
  assert.deepStrictEqual(
    detect(markdown, { level: 2, ext: 'md' }).findings.map((finding) => finding.rule),
    ['middot-chain']
  );
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

// ── mono is judged by what the selector lands on (lessly-landing#405) ──
// The rule used to read the selector's spelling: any selector with `code`,
// `pre`, `kbd`, `samp` or `tt` in its text was exempt, every other one failed.
// So `.font-mono`, which lands on nothing but <code> spans, failed on three
// shipped pages, and `.al-pre` on a <div> passed. Both are backwards.

test('a mono class that lands only on <code> is clean', () => {
  const page =
    '<html><body><style>.font-mono { font-family: Fira Mono, monospace }</style>' +
    '<p>Set <code class="font-mono">lessly_consent</code> to opt out.</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(!rules.includes('mono-noncode'), `expected silence, got: ${rules.join(', ')}`);
});

test('the same mono class on a <span> still fails', () => {
  const page =
    '<html><body><style>.font-mono { font-family: Fira Mono, monospace }</style>' +
    '<p><span class="font-mono">draft build</span></p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('mono on an element nested inside <code> is clean — font-family inherits', () => {
  const page =
    '<html><body><style>.token { font-family: SF Mono, monospace }</style>' +
    '<code><input class="token" value="lessly_consent"></code></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(!rules.includes('mono-noncode'), `expected silence, got: ${rules.join(', ')}`);
});

test('one non-code landing among many code ones is enough to fire', () => {
  const page =
    '<html><body><style>.font-mono { font-family: Fira Mono, monospace }</style>' +
    '<code class="font-mono">a</code><code class="font-mono">b</code>' +
    '<span class="font-mono">draft · 2026</span></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

// The hole the spelling check left open: `\bpre\b` matches inside `.al-pre`,
// so a class named after code but landing on a plain <div> was exempt.
test('a code-sounding class name on a plain <div> fires', () => {
  const page =
    '<html><body><style>.al-pre { font-family: SF Mono, monospace }</style>' +
    '<div class="al-pre">Deployment ready</div></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('a selector list is judged per selector, not on its last line', () => {
  // `.meta-label` is the slop. It used to ride in free because the rule read
  // only the last line of the list and found `.snip`, which is a <code>.
  const page =
    '<html><body><style>.meta-label,\n.snip { font-family: SF Mono, monospace }</style>' +
    '<span class="meta-label">scoped to repo</span><code class="snip">npm i</code></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('one absent class in a list does not excuse its neighbours', () => {
  // `.never-used` is on no element here. Asking selectorApplies about the whole
  // list answered "does not apply" and took the real `.meta-label` with it.
  const page =
    '<html><body><style>.meta-label, .never-used { font-family: SF Mono, monospace }</style>' +
    '<span class="meta-label">scoped to repo</span></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('a selector that resolves to no element falls back to its spelling', () => {
  // `:root` names no element this parser can point at. The fallback is the old
  // spelling check, so the rule guesses rather than going quiet.
  const noisy =
    '<html><body><style>:root { font-family: SF Mono, monospace }</style><p>Text</p></body></html>';
  const quiet =
    '<html><body><style>:root code { font-family: SF Mono, monospace }</style><p>Text</p></body></html>';
  const rules = (p) => detect(p, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules(noisy).includes('mono-noncode'), 'expected mono-noncode on :root');
  assert.ok(!rules(quiet).includes('mono-noncode'), 'expected silence on a selector spelled for code');
});

// A custom property declares a value; it does not apply one. Tailwind v4 emits
// `--default-mono-font-family`, whose *name* contains `font-family`, so a rule
// with no left boundary read the theme block as a font applied to :root and
// failed every Tailwind v4 site at level 1 (asabirov/ai-slop-detector-skill#9).

test('a custom property whose name contains font-family is not a font-family declaration', () => {
  const page =
    '<html><body><style>:root, :host { --font-mono: "Fira Mono", monospace;' +
    ' --default-mono-font-family: var(--font-mono) }</style>' +
    '<p>Run <code>npm test</code> first.</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(!rules.includes('mono-noncode'), `expected silence, got: ${rules.join(', ')}`);
});

test('a non-ASCII ident character is part of the boundary too', () => {
  // `\\w` is ASCII, so a boundary of `[\\w-]` alone left the same hole open one
  // character over: an ident may legally hold non-ASCII, and `--<CJK>font-family`
  // is still a custom property name rather than a declaration.
  const cjk = String.fromCharCode(0x5b57);
  const page =
    `<html><body><style>:root { --${cjk}font-family: var(--font-mono) }</style>` +
    '<p>Text</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(!rules.includes('mono-noncode'), `expected silence, got: ${rules.join(', ')}`);
});

test('the real property still fires when it is the one on :root', () => {
  // The boundary must not buy silence for an actual declaration. Same theme
  // block, same var, but applied rather than merely named.
  const page =
    '<html><body><style>:root { --font-mono: "Fira Mono", monospace;' +
    ' font-family: var(--font-mono) }</style><p>Text</p></body></html>';
  const rules = detect(page, { level: 1, kind: 'artifact', ext: 'html' }).findings.map((f) => f.rule);
  assert.ok(rules.includes('mono-noncode'), `expected mono-noncode, got: ${rules.join(', ')}`);
});

test('selectorTargets resolves a selector to the elements it lands on', () => {
  const els = markupElements(
    '<html><body><pre class="block"><code><span class="tok">x</span></code></pre>' +
      '<div class="block">y</div></body></html>'
  );
  const tags = (sel) => (selectorTargets(sel, els) || []).map((e) => e.tag);
  assert.deepStrictEqual(tags('.block'), ['pre', 'div']);
  assert.deepStrictEqual(tags('.tok'), ['span']);
  assert.deepStrictEqual(tags('pre .tok'), ['span']);
  // Nested inside <code>, so mono on it is inherited mono on code.
  assert.strictEqual(selectorTargets('.tok', els)[0].inCode, true);
  assert.strictEqual(selectorTargets('.block', els)[1].inCode, false);
  // Nothing to point at: the caller must fall back rather than judge.
  assert.strictEqual(selectorTargets(':root', els), null);
  assert.strictEqual(selectorTargets('.absent', els), null);
  assert.strictEqual(selectorTargets('.tok', null), null);
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

// ── the kicker scan must stay linear in page size ────────────────────────
// Unbounded, `([\s\S]*?)</\1>` expands each label body to every later closing
// tag in the document before giving up on a start position. Bounded, this page
// takes 25-27ms; the regex that shipped in 4.1.8 takes 5,207ms on the same
// machine. The budget sits between them at ~38x the bounded time and ~5x under
// the regression, so it fails on the quadratic shape and not on a slow machine.
test('a large page of short paragraphs does not blow up the kicker scan', () => {
  const page = '<html><body>' + ('<p>a</p>' + ' '.repeat(50)).repeat(6400) + '</body></html>';
  const started = Date.now();
  detect(page, { level: 2, kind: 'artifact', ext: 'html' });
  const ms = Date.now() - started;
  assert.ok(ms < 1000, `363KB of paragraphs took ${ms}ms — the scan is not linear`);
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
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered', 'comment-chaptered']);
  assert.strictEqual(rep.verdict, 'fail');
});

test('blank-line-separated chapters reproduce marketplace issue 18', () => {
  const src = [
    '// WHAT THIS DOES',
    '// Three lines of prose.',
    '// Three more.',
    '',
    '// WHY IT IS HERE',
    '// Three lines of prose.',
    '// Three more.',
    '',
    '// WHAT TO DO INSTEAD',
    '// Three lines of prose.',
    '// Three more.',
  ].join('\n');
  const rep = detect(src, { level: 1, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered']);
  assert.strictEqual(rep.verdict, 'fail');
});

test('a license followed by one titled note stays silent at level 1', () => {
  const license = [
    'Copyright (c) 2026 Example contributors.',
    'Permission is hereby granted, free of charge, to any person obtaining',
    'a copy of this software and associated documentation files, to deal',
    'in the Software without restriction, including without limitation',
    'the rights to use, copy, modify, merge, publish, distribute, sublicense,',
    'and/or sell copies of the Software, and to permit persons to whom',
    'the Software is furnished to do so, subject to the following conditions:',
  ];
  for (const ext of ['js', 'py', 'css']) {
    const comment = (line) => ext === 'css' ? `/* ${line} */` : `${ext === 'py' ? '#' : '//'} ${line}`;
    for (const title of ['CONFIG', 'CONFIG FOR CLIENT']) {
      const src = [...license.map(comment), '', comment(title), comment('Read settings from the environment.')].join('\n');
      const rep = detect(src, { level: 1, kind: 'source', ext });
      assert.deepStrictEqual(rep.findings, [], `${ext}: ${title}`);
    }
  }
});

test('two sections separated by one blank line still fail level 1', () => {
  const section = ['// WHAT THIS DOES', '// Read settings from disk.', '// Apply the configured defaults.', '// Return the resulting settings.'];
  const src = [...section, '', ...section].join('\n');
  const rep = detect(src, { level: 1, kind: 'source', ext: 'js' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered']);
  assert.strictEqual(rep.verdict, 'fail');
});

test('joining a short note cannot silence an independently chaptered block', () => {
  const block = ['// WHAT THIS DOES', ...Array(33).fill('// Read settings from the environment.')].join('\n');
  const note = Array(3).fill('// Apply the configured defaults.').join('\n');
  for (const src of [block, `${block}\n\n${note}`, `${note}\n\n${block}`]) {
    const rep = detect(src, { level: 1, kind: 'source', ext: 'js' });
    assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['comment-chaptered']);
  }
});

test('chapter runs preserve thresholds, code boundaries, frames and other rules', () => {
  const { parseSource } = require('./lib/source');
  const chaptered = RULES.find((r) => r.id === 'comment-chaptered');
  const essay = RULES.find((r) => r.id === 'comment-essay');
  const ratio = RULES.find((r) => r.id === 'comment-ratio');
  const section = ['// WHAT THIS DOES', '// A useful prose line.', '// Another prose line.', '// One more prose line.'].join('\n');
  const joined = `${section}\n \t\n${section}`;
  assert.strictEqual(chaptered.test(parseSource(joined)).length, 1);
  assert.strictEqual(chaptered.test(parseSource(joined.replace('// One more prose line.\n', ''))).length, 0);
  for (const gap of ['\n\n\n', '\nconst x = 1;\n']) {
    assert.deepStrictEqual(chaptered.test(parseSource(section + gap + section)), []);
  }
  for (const [ext, src] of [['py', joined.replaceAll('//', '#')],
    ['css', joined.replaceAll('// ', '/* ').split('\n').map((line) => line.startsWith('/*') ? line + ' */' : line).join('\n')]]) {
    assert.strictEqual(chaptered.test(parseSource(src, { ext })).length, 1);
  }
  const frame = '// --------------------\n// A framed note.\n// --------------------';
  const prose = Array(6).fill('// A useful prose line.').join('\n');
  assert.deepStrictEqual(chaptered.test(parseSource(`${prose}\n\n${frame}\n\n${prose}`)), []);
  const ctx = parseSource(`${prose}\n\n${prose}\n${'const x = 1;\n'.repeat(20)}`);
  const before = JSON.stringify(ctx);
  chaptered.test(ctx);
  assert.strictEqual(JSON.stringify(ctx), before);
  assert.deepStrictEqual(essay.test(ctx), []);
  assert.deepStrictEqual(ratio.test(ctx), ['12 prose lines to 20 code lines (0.60:1)']);
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

// ── issue #78 · the code-span exemption reached only part of the file ────

test('a stray backtick does not disable the code-span exemption after it', () => {
  const doc = ['A stray backtick ` here.', '', 'A fake `app://` URI is banned.'].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a code span does not reach across a blank line to swallow prose', () => {
  const doc = [
    'A stray backtick ` here.',
    '',
    'See lessly://c4/goal for the goal model.',
    '',
    'Another stray ` there.',
  ].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['fake-uri']);
});

test('a double-backtick span holds a backtick, and closes only on its own length', () => {
  const doc = 'Write `` `app://` `` to quote it, and app://x stays banned.';
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['fake-uri']);
});

test('an unclosed fence hides the block that follows it, not the prose before', () => {
  const doc = ['See lessly://c4/goal first.', '', '```js', 'const u = "app://x";'].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['fake-uri']);
});

test('markdown that quotes an HTML tag in a code span is still markdown', () => {
  const doc = [
    'Reading only `<style>` blocks missed the sheet a page links.',
    '',
    'A fake `app://` URI is banned.',
  ].join('\n');
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a page that really is HTML is still read as HTML', () => {
  const page = [
    '<html><head><style>body { font-family: system-ui; }</style></head>',
    '<body><p>Run `npm test` and `npm run lint` before you push.</p></body></html>',
  ].join('\n');
  const rep = detect(page, { level: 1, kind: 'artifact', ext: 'html' });
  assert.deepStrictEqual(rep.findings, []);
  assert.equal(require('./lib/html').parse(page).isHtml, true);
});

test('a decorative arrow quoted as a value is not decoration', () => {
  const doc = 'The `external-link-arrow` rule bans a diagonal `↗` on a link.';
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'md' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), []);
});

test('a decorative arrow on a link is still decoration', () => {
  const doc = '<p><a href="https://x.test">Open on GitHub ↗</a></p>';
  const rep = detect(doc, { level: 1, kind: 'artifact', ext: 'html' });
  assert.deepStrictEqual(rep.findings.map((f) => f.rule), ['external-link-arrow']);
});

// This repo's own prose, which is the prose most likely to trip these rules: a
// rule is explained by quoting what it catches. Found by walking rather than
// listed, so a document added later is covered without anybody remembering to
// add it here. `tests.yml` points at this test instead of carrying its own copy
// of the list.
//
const ROOT = path.join(__dirname, '..');

function shippedProse(root) {
  const docs = path.join(root, 'docs');
  return [
    ...fs.readdirSync(root).filter((f) => f.endsWith('.md')),
    ...(fs.existsSync(docs)
      ? fs.readdirSync(docs).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`)
      : []),
  ].sort();
}

test('every document this repo ships passes its own level-1 gate', () => {
  const docs = shippedProse(ROOT);
  assert.ok(docs.includes('SKILL.md'), `expected SKILL.md, found ${docs.join(', ')}`);
  assert.ok(docs.includes('docs/ai-slop-detector.md'), 'expected the bundled CLI reference');
  const failed = docs.flatMap((doc) =>
    detect(fs.readFileSync(path.join(ROOT, doc), 'utf8'), {
      level: 1,
      kind: 'artifact',
      ext: 'md',
    }).findings.map((f) => `${doc}: ${f.rule}: ${f.span}`)
  );
  assert.deepStrictEqual(failed, [], 'a document fails the gate it documents');
});

// Unpaired backticks are the shape that makes span-matching quadratic: each one
// is an opener that has to give up somewhere, and a naive search restarts at the
// head of the candidate list every time. One cursor per delimiter length, moving
// forward only, keeps it linear.
//
// 3.1MB of them: 19ms linear on an idle machine, 293-600ms on the one this was
// last measured on, which was carrying a load average of 413. Drop the cursors
// and the same input takes 107,785ms there and ~7,500ms idle. The budget sits
// eight times above the loaded linear time and comfortably under the regression
// at either load, so it fails on the shape and not on a busy machine.
test('a document of unpaired backticks does not blow up the code-span scan', () => {
  const doc = '` ' + Array.from({ length: 240000 }, (_, i) => `word${i} \`\``).join(' ');
  const started = Date.now();
  plainText(doc, false);
  const ms = Date.now() - started;
  assert.ok(ms < 5000, `3.1MB of unpaired backticks took ${ms}ms — the scan is not linear`);
});

// ── apliteni#79 · what CodeQL found, and what it cost somebody ───────────
//
// Four alerts on main, all high: three `js/incomplete-multi-character-sanitization`
// in rules/visual.js and one `js/polynomial-redos` in lib/html.js. The fifth the
// issue reports went with the function that held it.

test('cssRules reads every stylesheet here exactly as the regex did', () => {
  const asRegex = (css) => {
    const out = [];
    const re = /([^{}]+)\{([^{}]*)\}/g;
    let m;
    while ((m = re.exec(css)) !== null) out.push([m[1].trim(), m[2]]);
    return out;
  };
  const cases = [
    ...fs.readdirSync(FIX).filter((f) => f.endsWith('.css') || f.endsWith('.html'))
      .map((f) => read(f)),
    'a{b}',
    'a{b}c{d}',
    '@media (min-width: 40em) { .a { color: red } }',
    '@supports (d:g) { @media x { a { b: c } } }',
    '{}',
    '{b}',
    'a{}',
    'no braces at all',
    'a{b',
    'b}c{d}',
    '.a,\n.b {\n  color: red;\n}\n.c { color: blue }',
    'a { b: url("}") }',
  ];
  for (const css of cases) {
    assert.deepStrictEqual(cssRules(css), asRegex(css), JSON.stringify(css.slice(0, 60)));
  }
});

// The regex it replaced is `js/polynomial-redos`: `[^{}]+` gives up one character
// at a time at every start position. Brace-free input, measured on this machine:
// 20KB took 6,940ms and 39KB took 26,303ms, growing as the square. 156KB had not
// returned after two minutes, which is why the guard uses it.
test('a stylesheet with no braces in it does not hang the CSS scan', () => {
  const started = Date.now();
  cssRules('a'.repeat(160 * 1024));
  const ms = Date.now() - started;
  assert.ok(ms < 1000, `156KB of brace-free CSS took ${ms}ms — the scan is not linear`);
});

// `js/incomplete-multi-character-sanitization`. Removing a tag to the empty
// string lets the characters either side close back up into a tag that was never
// in the source; a space between them cannot.
test('stripping a tag cannot build a new one out of what is left', () => {
  assert.ok(!/<[a-z]/i.test(stripTags('<<a>script>alert(1)<<a>/script>')));
  assert.strictEqual(stripTags('<b>x</b>').replace(/\s+/g, ' ').trim(), 'x');
});

test('a heading rule still reads the words and not the markup', () => {
  const page = '<html><body><h1>\u{1F680} Ship <em>it</em>.</h1></body></html>';
  const rules = detect(page, { level: 3, kind: 'artifact', ext: 'html' }).findings;
  const ids = new Set(rules.map((f) => f.rule));
  assert.ok(ids.has('emoji-heading'), `expected emoji-heading, got ${[...ids].join(', ')}`);
  assert.ok(ids.has('heading-italic'), `expected heading-italic, got ${[...ids].join(', ')}`);
});

// Review cases for Markdown and raw HTML token ownership.
const reviewRead = (source) => parse(source, { ext: 'md' });
const reviewArrow = (source) => detect(source, { ext: 'md', kind: 'artifact', level: 1 })
  .findings.some((finding) => finding.rule === 'external-link-arrow');

for (const [name, source, expected] of [
  ['short comment', 'Read <!--> ` -->↗ `', false],
  ['short comment with extra dash', 'Read <!---> ` -->↗ `', false],
  ['comment before heading', 'Read <!-- hidden\n# Heading ↗\n-->', true],
  ['comment before list', 'Read <!-- hidden\n- item ↗\n-->', true],
  ['comment before quote', 'Read <!-- hidden\n> quoted ↗\n-->', true],
  ['quoted tag before heading', 'Read <x a="\n# ↗\n">', true],
  ['code span before heading', '`hidden\n# ↗\n`', true],
  ['script slash close', '<script>hidden</script/>↗', true],
  ['script attributed close', '<script>hidden</script x>↗', true],
  ['style attributed close', '<style>hidden</style x>↗', true],
  ['ordinary comment control', 'Read <!-- hidden --> ` -->↗ `', false],
  ['ordinary script control', '<script>hidden</script>↗', true],
  ['same paragraph comment control', 'Read <!-- hidden\nordinary ↗\n-->', false],
  ['same paragraph attribute control', 'Read <x a="\nordinary ↗\n">', false],
]) test(name, { timeout: 1000 }, () => assert.equal(reviewArrow(source), expected));

for (const [name, source, runs, attrs] of [
  ['attribute tick before script', 'Read <span title="tick ` here">start</span><script>hidden</script> visible ↗ ` tail',
    ['Read', 'start', 'visible ↗ ` tail'], ['tick ` here']],
  ['attribute tick before textarea', 'Read <span title="tick ` here">start</span><textarea>value</textarea><span title="readable label">↗</span> ` tail',
    ['Read', 'start', 'value', '↗', '` tail'], ['tick ` here', 'readable label']],
  ['comment tick before script', 'Read <!-- ` --> <script>hidden</script> visible ↗ ` tail',
    ['Read visible ↗ ` tail'], []],
  ['comment tick before textarea', 'Read <!-- ` --> <textarea>value</textarea><span title="readable label">↗</span> ` tail',
    ['Read value', '↗', '` tail'], ['readable label']],
  ['inline script content tick', 'Print <script>const x = `value</script> visible ↗ ` tail',
    ['Print'], []],
  ['inline malformed script close', 'Read <script>hidden</script foo>↗', ['Read'], []],
  ['inline malformed style close', 'Read <style>hidden</style/>↗', ['Read'], []],
  ['later script after attribute tick', 'Read <script>one</script><span title="tick ` here">start</span><script>two</script> visible ↗ ` tail',
    ['Read', 'start', 'visible ↗ ` tail'], ['tick ` here']],
  ['nested tag tick in inline script', 'Read <script><span title="tick ` here"></span></script> visible ↗ ` tail',
    ['Read visible ↗ ` tail'], []],
  ['nested comment tick in inline script', 'Read <script><!-- ` --></script> visible ↗ ` tail',
    ['Read visible ↗ ` tail'], []],
  ['invalid angle text tick in inline script', 'Read <script><bad ` text</script> visible ↗ ` tail',
    ['Read'], []],
  ['unfinished comment tick in inline script', 'Read <script><!-- bad `</script> visible ↗ ` tail',
    ['Read'], []],
  ['raw script close keeps Markdown heading literal', '<script>hidden</script x>\n# Heading ↗',
    ['# Heading ↗'], []],
  ['raw style close keeps Markdown list literal', '<style>hidden</style/>\n- item ↗',
    ['- item ↗'], []],
  ['marker shaped fence close', '> ~~~\n> - ~~~\n> ↗\n> ~~~', [], []],
  ['marker shaped raw text', '- <div>\n  - <span title="readable label">shown</span>\n  </div>',
    ['-', 'shown'], ['readable label']],
]) test(name, { timeout: 1000 }, () => {
  const result = reviewRead(source);
  assert.deepEqual(result.runs, runs);
  assert.deepEqual(result.attrs, attrs);
});

test('unfinished script closes scale within a geometric budget', { timeout: 1400 }, () => {
  const sizes = [2000, 4000, 8000];
  const times = [];
  for (const size of sizes) {
    const source = 'Read <script>' + '</script x=" '.repeat(size);
    assert.equal(reviewRead(source).codeless, 'Read');
    const samples = [];
    for (let i = 0; i < 3; i++) {
      const start = performance.now();
      assert.equal(reviewRead(source).codeless, 'Read');
      samples.push(performance.now() - start);
    }
    times.push(samples.sort((a, b) => a - b)[1]);
  }
  assert.ok(times[2] < 800, `largest sample took ${times[2].toFixed(1)} ms`);
  assert.ok(times[2] < 5 * Math.max(times[1], 1), `geometric samples: ${times}`);
});
