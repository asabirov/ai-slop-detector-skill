#!/usr/bin/env node
// Writes the plugin's copy of SKILL.md and the reference doc, stamped as
// generated. A person who opens the plugin's copy has to be told it is a build
// output before they edit it, and the top of the file is where they will look.
// The stamp goes under the YAML frontmatter, because a comment above it stops
// the skill loader parsing the block.
'use strict';

const fs = require('fs');
const path = require('path');

const NOTE = slug =>
  `<!-- GENERATED from ${slug} — do not edit here. Edit the same file in that ` +
  `repo; a GitHub Action regenerates this one. -->\n\n`;

// Exported so the test calls it directly rather than through a subprocess.
function stamp(text, note, keepFrontmatter) {
  if (keepFrontmatter) {
    const m = /^(---\n[\s\S]*?\n---\n)/.exec(text);
    if (m) return m[1] + '\n' + note + text.slice(m[0].length).replace(/^\n+/, '');
  }
  return note + text;
}

const TARGETS = [
  { from: 'SKILL.md', to: 'skills/ai-slop-detector/SKILL.md', frontmatter: true },
  { from: 'docs/ai-slop-detector.md', to: 'docs/ai-slop-detector.md', frontmatter: false },
];

function render(srcDir, dstDir, slug) {
  const note = NOTE(slug);
  return TARGETS.map(t => {
    const out = path.join(dstDir, t.to);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, stamp(fs.readFileSync(path.join(srcDir, t.from), 'utf8'),
                                note, t.frontmatter));
    return out;
  });
}

module.exports = { stamp, render, NOTE, TARGETS };

if (require.main === module) {
  const [src, dst, slug] = process.argv.slice(2);
  if (!src || !dst || !slug) {
    process.stderr.write('usage: render-skill.js <detector-dir> <plugin-dir> <source-slug>\n');
    process.exit(2);
  }
  for (const f of render(src, dst, slug)) process.stdout.write(`wrote ${f}\n`);
}
