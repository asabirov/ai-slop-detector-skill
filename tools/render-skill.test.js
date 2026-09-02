'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { stamp, render, NOTE, PAGES, targets } = require('./render-skill');

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
                         targets('skill').map(t => t.to));
  for (const f of written) assert.ok(fs.readFileSync(f, 'utf8').includes('GENERATED'));
  assert.ok(fs.readFileSync(written[0], 'utf8')
              .startsWith('---\nname: ai-slop-detector\n---\n'));
});

test('whichever page ships, its name matches the directory it lands in', () => {
  // The plugin's CI fails a skill whose frontmatter name disagrees with its
  // directory. What ships is the renderer's output, so render the real pages and
  // read the name back out of what it wrote, taking the directory from the
  // target path rather than repeating it here.
  for (const page of Object.keys(PAGES)) {
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), `slop-${page}-`));
    const [skillOut] = render(path.join(__dirname, '..'), dst, SLUG, page);
    const dir = path.basename(path.dirname(path.relative(dst, skillOut)));
    const m = /^---\n([\s\S]*?)\n---\n/.exec(fs.readFileSync(skillOut, 'utf8'));
    assert.ok(m, `${page} renders without frontmatter`);
    assert.match(m[1], new RegExp(`^name: ${dir}$`, 'm'), `${page} declares the wrong name`);
    assert.match(m[1], /^description: \S/m, `${page} has no description`);
  }
});

test('the two pages are different pages, both landing at the same path', () => {
  const src = path.join(__dirname, '..');
  const read = page => {
    const dst = fs.mkdtempSync(path.join(os.tmpdir(), `slop-cmp-${page}-`));
    const [out] = render(src, dst, SLUG, page);
    return { rel: path.relative(dst, out), text: fs.readFileSync(out, 'utf8') };
  };
  const skill = read('skill');
  const stub = read('stub');
  assert.strictEqual(skill.rel, stub.rel, 'both pages ship to the same path');
  // ok(), not notStrictEqual(): these are 12K pages, and a failure that dumps
  // both of them buries the one line saying which assertion broke.
  assert.ok(skill.text !== stub.text, 'the stub must not be the skill');
  assert.match(stub.text, /Pointer, not the linter/);
});

test('an unknown page fails loudly instead of shipping nothing', () => {
  const dst = fs.mkdtempSync(path.join(os.tmpdir(), 'slop-bad-'));
  assert.throws(() => render(path.join(__dirname, '..'), dst, SLUG, 'stubb'),
                /unknown page stubb/);
});
