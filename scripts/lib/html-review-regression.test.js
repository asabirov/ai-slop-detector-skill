'use strict';

const assert = require('node:assert/strict');
const { test } = require('./budget');
const { parse } = require('./html');
const { detect } = require('../detect');

function streams(source) {
  const { runs, attrs } = parse(source, { ext: 'md' });
  return { runs, attrs };
}

const cases = [
  ['ordered continuation code', 'Read `hidden\n2. ↗`', ['Read'], []],
  ['ordered 123 continuation code', 'Read `hidden\n123. ↗`', ['Read'], []],
  ['ordered one interruption', 'Read `hidden\n1. ↗`', ['Read `hidden', '1. ↗`'], []],
  ['lazy quote code', '> Read `hidden\n↗`', ['> Read'], []],
  ['explicit quote code', '> Read `hidden\n> ↗`', ['> Read'], []],
  ['lazy quote attribute', '> Read <span title="first\nsecond label">shown ↗</span>',
    ['> Read', 'shown ↗'], ['first second label']],
  ['explicit quote attribute continuation', '> Read <span title="first\n> second label">shown ↗</span>',
    ['> Read', 'shown ↗'], ['first second label']],
  ['ordered marker after quote ends', '> Read `hidden\n2. ↗`',
    ['> Read `hidden', '2. ↗`'], []],
  ['ordered continuation attribute', 'Read <span title="first\n2. second label">shown ↗</span>',
    ['Read', 'shown ↗'], ['first 2. second label']],
  ['nested quote and list code continuation', '> - > `\n>   visible ↗ `', ['> - >'], []],
  ['list and nested quote comment continuation', '- > > Read <!--\n  > visible ↗ -->',
    ['> > Read'], []],
  ['outer list ends before new quote', '- > Read <!-- hidden\n> ↗ -->',
    ['> Read <!-- hidden', '> ↗ -->'], []],
  ['atx heading comment end', '# Read <!-- hidden\nVisible ↗ -->',
    ['Read <!-- hidden', 'Visible ↗ -->'], []],
  ['atx heading attribute end', '# Read <span title="hidden\nVisible ↗">shown</span>',
    ['Read <span title="hidden', 'Visible ↗">shown'], []],
  ['setext heading comment end', 'Read <!--\n===\nvisible ↗ -->',
    ['Read <!--', 'visible ↗ -->'], []],
  ['quote shaped fence content', '~~~\n> ~~~\n↗\n~~~', [], []],
  ['quote shaped fence before heading', '~~~\n> ~~~\n# heading ↗\n~~~', [], []],
  ['quote shaped content in quoted fence', '> ~~~\n> > ~~~\n> ↗\n> ~~~', [], []],
  ['ordinary fence close', '~~~\n↗\n~~~\nvisible', ['visible'], []],
  ['escaped comment in script',
    'Read <script>\\<!-- ` -->hidden</script><span title="visible label">shown ↗</span> ` tail',
    ['Read'], []],
  ['escaped tag in script',
    'Read <script>\\<span title="tick ` here">start</span>hidden</script><span title="visible label">shown ↗</span> ` tail',
    ['Read'], []],
  ['quoted greater than in raw close', '<script>hidden</script x="a>↗b">visible', ['visible'], []],
  ['form feed in script close', 'Read <script>hidden</script\f>↗', ['Read ↗'], []],
  ['form feed in style close', 'Read <style>hidden</style\f>↗', ['Read ↗'], []],
  ['vertical tab is not a closing separator', 'Read <script>hidden</script\v>↗', ['Read'], []],
  ['vertical tab stays raw in an HTML block', '<div>\n<script>hidden</script\v>↗', [], []],
  ['nonbreaking space is not a closing separator', 'Read <script>hidden</script\u00a0>↗', ['Read'], []],
];

for (const [name, source, runs, attrs] of cases) {
  test(name, { timeout: 1000 }, () => {
    assert.deepEqual(streams(source), { runs, attrs });
    const hasArrow = detect(source, { ext: 'md', kind: 'artifact', level: 1 })
      .findings.some(({ rule }) => rule === 'external-link-arrow');
    assert.equal(hasArrow, runs.some((run) => run.includes('↗')) ||
      attrs.some((attr) => attr.includes('↗')));
  });
}
