#!/usr/bin/env node
// Writes the plugin's copy of SKILL.md and the reference doc, stamped as
// generated. A person who opens the plugin's copy has to be told it is a build
// output before they edit it, and the top of the file is where they will look.
// The stamp goes under the YAML frontmatter, because a comment above it stops
// the skill loader parsing the block.
'use strict';

const fs = require('fs');
const path = require('path');

// The revision is what the plugin's CI checks. A change to a generated file
// that leaves this line alone is a hand-edit, and the next sync deletes it.
const NOTE = (slug, rev) =>
  `<!-- GENERATED from ${slug}@${rev} — do not edit here. Edit the same file in ` +
  `that repo; a GitHub Action regenerates this one. -->\n\n`;

// Exported so the test calls it directly rather than through a subprocess.
function stamp(text, note, keepFrontmatter) {
  if (keepFrontmatter) {
    const m = /^(---\n[\s\S]*?\n---\n)/.exec(text);
    if (m) return m[1] + '\n' + note + text.slice(m[0].length).replace(/^\n+/, '');
  }
  return note + text;
}

// Which page lands as the plugin's SKILL.md. `skill` is the real one, and the
// plugin ships the linter beside it. `stub` is the install pointer, for the day
// apliteni/claude-apliteni-plugin#82 stops shipping the source. Both land at the
// same path, so the sync picks one; sync-plugin.yml passes the choice and drops
// bin/, scripts/ and fixtures/ on the same word.
const PAGES = { skill: 'SKILL.md', stub: 'plugin-stub.md' };

const targets = page => [
  { from: PAGES[page], to: 'skills/ai-slop-detector/SKILL.md', frontmatter: true },
  { from: 'docs/ai-slop-detector.md', to: 'docs/ai-slop-detector.md', frontmatter: false },
];

function render(srcDir, dstDir, slug, rev, page = 'skill') {
  if (!PAGES[page]) {
    throw new Error(`unknown page ${page}; expected one of ${Object.keys(PAGES).join(', ')}`);
  }
  if (!rev) throw new Error('a source revision is required; the plugin\'s CI reads it');
  const note = NOTE(slug, rev);
  return targets(page).map(t => {
    const out = path.join(dstDir, t.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, stamp(fs.readFileSync(path.join(srcDir, t.from), 'utf8'),
                                note, t.frontmatter));
    return out;
  });
}

module.exports = { stamp, render, NOTE, PAGES, targets };

if (require.main === module) {
  const [src, dst, slug, rev, page = 'skill'] = process.argv.slice(2);
  if (!src || !dst || !slug || !rev) {
    process.stderr.write('usage: render-skill.js <detector-dir> <plugin-dir> <source-slug> ' +
                         `<source-rev> [${Object.keys(PAGES).join('|')}]\n`);
    process.exit(2);
  }
  let written;
  try {
    written = render(src, dst, slug, rev, page);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(2);
  }
  for (const f of written) process.stdout.write(`wrote ${f}\n`);
}
