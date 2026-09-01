'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stamp, render, NOTE, TARGETS } = require('./render-skill');

const SLUG = 'owner/repo';

test('the stamp lands under the frontmatter, not above it', () => {
  const out = stamp('---\nname: x\n---\n\n# Title\n', NOTE(SLUG), true);
  assert.ok(out.startsWith('---\nname: x\n---\n'), 'frontmatter must stay first');
  assert.ok(out.includes('GENERATED from owner/repo'));
  assert.ok(out.indexOf('GENERATED') < out.indexOf('# Title'));
});

test('a file with no frontmatter takes the stamp at the top', () => {
  const out = stamp('# Title\n', NOTE(SLUG), false);
  assert.ok(out.startsWith('<!-- GENERATED from owner/repo'));
  assert.ok(out.endsWith('# Title\n'));
});

test('frontmatter is left alone when the file opens without it', () => {
  const out = stamp('# Title\n', NOTE(SLUG), true);
  assert.ok(out.startsWith('<!-- GENERATED'));
});

test('render writes both targets into the plugin tree', () => {
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-src-'));
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-dst-'));
  fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: ai-slop-detector\n---\n\nbody\n');
  fs.mkdirSync(path.join(src, 'docs'));
  fs.writeFileSync(path.join(src, 'docs/ai-slop-detector.md'), '# Reference\n');

  const written = render(src, dst, SLUG);

  assert.deepStrictEqual(written.map(p => path.relative(dst, p)),
                         TARGETS.map(t => t.to));
  for (const f of written) assert.ok(fs.readFileSync(f, 'utf8').includes('GENERATED'));
  assert.ok(fs.readFileSync(written[0], 'utf8')
              .startsWith('---\nname: ai-slop-detector\n---\n'));
});
