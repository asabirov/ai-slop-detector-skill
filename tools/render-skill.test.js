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

test('both front pages declare the name the plugin directory uses', () => {
  // The plugin's CI fails a skill whose frontmatter name disagrees with its
  // directory, and skills/ai-slop-detector is the directory either of these
  // lands in. The stub is the one at risk: it is a separate file that nothing
  // else reads until the day the sync switches to it.
  for (const f of ['SKILL.md', 'plugin-stub.md']) {
    const text = fs.readFileSync(path.join(__dirname, '..', f), 'utf8');
    const m = /^---\n([\s\S]*?)\n---\n/.exec(text);
    assert.ok(m, `${f} has no frontmatter`);
    assert.match(m[1], /^name: ai-slop-detector$/m, `${f} declares the wrong name`);
    assert.match(m[1], /^description: \S/m, `${f} has no description`);
  }
});
