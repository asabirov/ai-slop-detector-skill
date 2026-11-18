'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('./budget');
const { parse } = require('./html');
const { growthLimit } = require('./timing');
const { detect } = require('../detect');

const fixture = (name) => fs.readFileSync(path.join(__dirname, '../../fixtures', name), 'utf8');
const rules = (source, ext) => detect(source, { ext, kind: 'artifact', level: 1 })
  .findings.map(({ rule }) => rule);

test('blank paragraphs end inline comment candidates', { timeout: 1000 }, () => {
  for (const [prefix, blank, continuation] of [['', '', ''], ['> ', '>', '> '],
    ['- ', '  ', '  '], ['- > ', '  >', '  > ']]) {
    const split = `${prefix}Read <!-- hidden\n${blank}\n${continuation}↗ -->`;
    assert.ok(parse(split, { ext: 'md' }).codeless.includes('↗'), split);
    assert.ok(rules(split, 'md').includes('external-link-arrow'), split);
    const joined = `${prefix}Read <!-- hidden\n${continuation}↗ -->`;
    assert.ok(!parse(joined, { ext: 'md' }).codeless.includes('↗'), joined);
    assert.ok(!rules(joined, 'md').includes('external-link-arrow'), joined);
  }
  assert.deepEqual(rules(fixture('slop-html-paragraph.md'), 'md'), ['external-link-arrow']);
  for (const tag of ['script', 'style', 'code', 'pre']) {
    const raw = `<${tag}>hidden\n\n↗</${tag}><p>shown</p>`;
    assert.ok(!parse(raw, { ext: 'md' }).codeless.includes('↗'), raw);
  }
});

test('non-void HTML ignores the self-closing flag', { timeout: 1000 }, () => {
  for (const ext of ['html', 'md']) {
    for (const prefix of ext === 'md' ? ['', 'Read ', '> ', '- > '] : ['']) {
      for (const tag of ['script', 'code', 'pre']) {
        const source = `${prefix}<${tag}/>hidden ↗</${tag}><p>shown</p>`;
        assert.ok(!parse(source, { ext }).codeless.includes('↗'), source);
        assert.ok(!rules(source, ext).includes('external-link-arrow'), source);
      }
      for (const opening of ['<style/>', '<style>']) {
        const source = `${prefix}${opening}p{font-family:monospace}</style><p>Hello</p>`;
        assert.ok(parse(source, { ext }).css.includes('font-family:monospace'), source);
        assert.ok(rules(source, ext).includes('mono-noncode'), source);
      }
    }
  }
  for (const ext of ['html', 'md']) {
    assert.deepEqual(rules(fixture(`slop-html-slash.${ext}`), ext), ['mono-noncode']);
  }
  const ctx = parse('<code/><span>hidden ↗</span></code><p>shown</p>', { ext: 'html' });
  assert.ok(ctx.elements.find(({ tag }) => tag === 'span').inCode);
  assert.ok(!ctx.elements.find(({ tag }) => tag === 'p').inCode);
  assert.equal(parse('<code data-path=/assets/ />shown', { ext: 'html' }).codeless, '');
  const component = parse('<Widget/><p>shown</p>', { ext: 'jsx' });
  assert.equal(component.elements.find(({ tag }) => tag === 'p').parent, -1);
  assert.equal(parse('<svg><script/></svg><p>shown ↗</p>', { ext: 'html' }).codeless, 'shown ↗');
  const foreign = parse('<svg><path/></svg><p>shown</p>', { ext: 'html' });
  assert.equal(foreign.elements.find(({ tag }) => tag === 'p').parent, -1);
});

test('equals inside an unquoted opening value stays data', { timeout: 1000 }, () => {
  assert.deepEqual(rules(fixture('slop-html-recovery.html'), 'html'), ['external-link-arrow']);
  for (const ext of ['html', 'md']) {
    for (const prefix of ext === 'md' ? ['', '> ', '- > '] : ['']) {
      for (const attribute of ['a=b="c', "a=b='c", 'a="b=c"']) {
        const source = `${prefix}<script ${attribute}>const label="x";</script><p>shown ↗</p>`;
        assert.ok(parse(source, { ext }).codeless.includes('shown ↗'), source);
        assert.ok(rules(source, ext).includes('external-link-arrow'), source);
      }
    }
  }
});

for (const opening of ['Read <!--', 'Read']) {
  test(`public parse bounds lazy list growth: ${opening}`, { timeout: 4000 }, () => {
    const source = (depth, lines) => '- '.repeat(depth) + opening + '\n' + 'lazy\n'.repeat(lines);
    const check = (depth, lines) => {
      const ctx = parse(source(depth, lines), { ext: 'md' });
      assert.ok(ctx.codeless.includes(opening));
      assert.equal(ctx.codeless.match(/lazy/g).length, lines);
      return ctx;
    };
    const small = source(2000, 2000);
    const deep = source(8000, 2000);
    const long = source(2000, 8000);
    const both = source(8000, 8000);
    check(2000, 2000);
    check(8000, 2000);
    check(2000, 8000);
    check(8000, 8000);
    const smallRun = () => parse(small, { ext: 'md' });
    const bothResult = growthLimit({ smallRun, largeRun: () => parse(both, { ext: 'md' }), floor: 20 });
    const deepResult = growthLimit({ smallRun, largeRun: () => parse(deep, { ext: 'md' }), floor: 20 });
    const longResult = growthLimit({ smallRun, largeRun: () => parse(long, { ext: 'md' }), floor: 20 });
    assert.ok(bothResult.large < 200, `56 KB of lazy list content took ${bothResult.large} ms`);
    assert.ok(bothResult.ok,
      `4x depth and lines grew ${bothResult.large / bothResult.small} times (${bothResult.small} ms to ${bothResult.large} ms)`);
    assert.ok(deepResult.ok, `depth took ${deepResult.large} ms`);
    assert.ok(longResult.ok, `lines took ${longResult.large} ms`);
  });
}

test('component source keeps self-closing native tags and names', { timeout: 1000 }, () => {
  for (const ext of ['jsx', 'tsx', 'vue', 'svelte', 'astro']) {
    for (const tag of ['code', 'Code', 'script', 'style', 'pre', 'textarea']) {
      const source = `<${tag}/><p style="font-family:monospace">shown ↗</p>`;
      const ctx = parse(source, { ext });
      assert.equal(ctx.html, source);
      assert.ok(ctx.codeless.includes('shown ↗'), `${ext}: ${source}`);
      assert.equal(ctx.elements.find(({ tag }) => tag === 'p').parent, -1);
      assert.ok(rules(source, ext).includes('external-link-arrow'));
      assert.ok(rules(source, ext).includes('mono-noncode'));
    }
  }
});

for (const balanced of [false, true]) {
  test(`public parse bounds foreign closing tags: balanced=${balanced}`, { timeout: 4000 }, () => {
    const source = (size) => '<svg>'.repeat(size) + (balanced ? '<g></g>' : '</g>').repeat(size) +
      (balanced ? '</svg>'.repeat(size) : '') + '<p>shown ↗</p>';
    const small = source(250);
    const large = source(1000);
    assert.ok(parse(small, { ext: 'html' }).codeless.includes('shown ↗'));
    assert.ok(parse(large, { ext: 'html' }).codeless.includes('shown ↗'));
    const result = growthLimit({
      smallRun: () => parse(small, { ext: 'html' }),
      largeRun: () => parse(large, { ext: 'html' }),
      floor: 20,
    });
    assert.ok(result.large < 200, `Foreign closing tags took ${result.large} ms`);
    assert.ok(result.ok,
      `4x foreign depth and closes grew ${result.large / result.small} times`);
  });
}

test('foreign integration points use their owning namespace', { timeout: 1000 }, () => {
  for (const source of ['<svg><mi><script/></svg><p>shown ↗</p>',
    '<math><title><script/></math><p>shown ↗</p>',
    '<math><desc><script/></math><p>shown ↗</p>']) {
    assert.ok(parse(source, { ext: 'html' }).codeless.includes('shown ↗'), source);
  }
  for (const source of ['<svg><foreignObject><script/>hidden ↗</script></foreignObject></svg>',
    '<math><mtext><script/>hidden ↗</script></mtext></math>']) {
    assert.ok(!parse(source, { ext: 'html' }).codeless.includes('↗'), source);
  }
});

test('blank Markdown paragraphs end their foreign context', { timeout: 1000 }, () => {
  const source = '<svg><g>\n\n<script/></svg><p>shown ↗</p>';
  assert.ok(!parse(source, { ext: 'md' }).codeless.includes('↗'));
  const control = '<svg><g>\n<script/></svg><p>shown ↗</p>';
  assert.ok(parse(control, { ext: 'md' }).codeless.includes('shown ↗'));
});

test('HTML transitions inside foreign content preserve Markdown exclusions', { timeout: 1000 }, () => {
  for (const ext of ['md', 'html']) {
    for (const source of ['<svg><p><script/></svg><p>shown ↗</p>',
      '<math><p><script/></math><p>shown ↗</p>',
      '<math><annotation-xml encoding="text/html"><script/></math><p>shown ↗</p>',
      '<math><annotation-xml encoding="APPLICATION/XHTML+XML"><script/></math><p>shown ↗</p>']) {
      assert.ok(!parse(source, { ext }).codeless.includes('↗'), `${ext}: ${source}`);
      assert.ok(!rules(source, ext).includes('external-link-arrow'), `${ext}: ${source}`);
    }
    const control = '<svg><script/></svg><p>shown ↗</p>';
    assert.ok(parse(control, { ext }).codeless.includes('shown ↗'));
  }
  const source = fixture('slop-html-namespace.md');
  assert.equal(parse(source, { ext: 'md' }).codeless, 'Visible ↗');
  assert.deepEqual(rules(source, 'md'), ['external-link-arrow']);
});

test('annotation integration uses the first encoding attribute', { timeout: 1000 }, () => {
  assert.equal(parse(fixture('slop-html-annotation.md'), { ext: 'md' }).codeless, 'shown ↗');
  for (const ext of ['md', 'html']) {
    for (const [attrs, visible] of [
      ['encoding="other" encoding="text/html"', true],
      ['encoding="text/html" encoding="other"', false],
    ]) {
      const source = `<math><annotation-xml ${attrs}><script/></math><p>shown ↗</p>`;
      assert.equal(parse(source, { ext }).codeless.includes('shown ↗'), visible, `${ext}: ${source}`);
    }
  }
});

test('annotation integration decodes its encoding value', { timeout: 1000 }, () => {
  for (const ext of ['md', 'html']) {
    for (const value of ['text&#47;html', 'text&sol;html', 'application/xhtml&plus;xml', 'text/html']) {
      const source = `<math><annotation-xml encoding="${value}"><script/></math><p>shown ↗</p>`;
      assert.ok(!parse(source, { ext }).codeless.includes('↗'), `${ext}: ${source}`);
    }
  }
});
