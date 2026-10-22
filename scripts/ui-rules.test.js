'use strict';

const { describe, it } = require('./lib/budget');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, kindForPath } = require('./detect');
const { parse } = require('./lib/html');
const { RULES } = require('./rules');

const fixtures = path.join(__dirname, '..', 'fixtures');
function scan(content, file = 'sample.html') {
  return detect(content, { level: 4, kind: kindForPath(file), ext: path.extname(file).slice(1) });
}
function ids(content, file) { return scan(content, file).findings.map((finding) => finding.rule); }
function has(content, rule, file) { assert.ok(ids(content, file).includes(rule), `Expected ${rule} in ${file || 'HTML'}`); }
function lacks(content, rule, file) { assert.ok(!ids(content, file).includes(rule), `Unexpected ${rule} in ${file || 'HTML'}`); }

const rules = [
  'gradient-text', 'ai-gradient', 'glow-shadow', 'glassmorphism', 'nested-cards',
  'bounce-easing', 'accent-bar', 'pill-radius', 'big-number-stat', 'emoji-icon',
  'family-ceiling', 'stock-display-face', 'mono-uppercase-label', 'accent-budget',
  'hairline-grid', 'double-edge', 'button-drift', 'everything-centred', 'stock-palette',
];

describe('redundant UI copy', { timeout: 1000 }, () => {
  const names = ['multiword-control', 'inset-accent-marker', 'repeated-field-caption',
    'restated-status-badge', 'marker-explainer', 'restated-control-period',
    'restated-table-count', 'context-noun-control'];
  const hits = (html, name) => RULES.find((rule) => rule.id === name).test(parse(html, { ext: 'html' }));
  for (const name of names) {
    it(`${name} flags its positive fixture and leaves its negative fixture silent`, { timeout: 1000 }, () => {
      assert.ok(hits(fs.readFileSync(path.join(fixtures, 'slop-ui-redundant-copy.html'), 'utf8'), name).length);
      assert.deepEqual(hits(fs.readFileSync(path.join(fixtures, 'near-miss-ui-redundant-copy.html'), 'utf8'), name), []);
    });
  }
  it('reports a sentence link once and leaves short controls silent', { timeout: 1000 }, () => {
    assert.equal(hits('<a role="button" href="/report">Open the payout report</a>', 'multiword-control').length, 1);
    assert.deepEqual(hits('<button>Save</button><button>Undo</button><button aria-label="Close"><svg></svg></button>', 'multiword-control'), []);
    assert.equal(hits('<button aria-label="Open settings"><svg aria-hidden="true"></svg></button>', 'multiword-control').length, 1);
    assert.deepEqual(hits('<button aria-label="Close"><svg aria-hidden="true"></svg></button>', 'multiword-control'), []);
    assert.equal(hits('<input type="submit" value="Send answer">', 'multiword-control').length, 1);
  });
  it('silences a verb followed only by "all" but keeps every other multi-word label flagged', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<button>Clear all</button>', 'multiword-control'), []);
    assert.deepEqual(hits('<div class="filter-bar"><button>Clear all</button></div>', 'multiword-control'), []);
    for (const label of ['Read records', 'Clear all filters', 'Send answer',
      'Open the newer question', 'Close without answering', 'Bring back now']) {
      assert.equal(hits(`<button>${label}</button>`, 'multiword-control').length, 1, label);
    }
  });
  it('flags a badge that repeats a field value', { timeout: 1000 }, () => {
    assert.equal(hits('<section><input value="Needs review"><span class="status-badge">Needs review</span></section>', 'restated-status-badge').length, 1);
    assert.deepEqual(hits('<section><input value="Draft"><span class="status-badge">Needs review</span></section>', 'restated-status-badge'), []);
  });
  it('counts table body rows without counting its header', { timeout: 1000 }, () => {
    assert.equal(hits('<section><p>3 of the 214 payouts this year</p><table><thead><tr><th>Payout</th></tr></thead><tbody><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></tbody></table></section>', 'restated-table-count').length, 1);
  });
  it('reads a selected period option', { timeout: 1000 }, () => {
    assert.equal(hits('<div><select><option selected>1Y</option></select><p>Change against the previous 12 months</p></div>', 'restated-control-period').length, 1);
    assert.deepEqual(hits('<div><select><option>1Y</option><option selected>6M</option></select><p>Change against the previous 12 months</p></div>', 'restated-control-period'), []);
  });
  it('uses the selected period and ignores other period controls', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<div><button aria-pressed="false">1Y</button><button aria-pressed="true">6M</button><p>Change against the previous 12 months</p></div>', 'restated-control-period'), []);
    assert.equal(hits('<div><button aria-pressed="true">6M</button><p>Change against the previous 6 months</p></div>', 'restated-control-period').length, 1);
    assert.equal(hits('<div><button aria-pressed="true">1Y</button><p>Compared with the last 12 months</p></div>', 'restated-control-period').length, 1);
  });
  it('keeps a count line that adds an approval deadline', { timeout: 1000 }, () => {
    const html = '<section><p>3 of the 214 payouts this year need approval by Friday.</p><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></section>';
    assert.deepEqual(hits(html, 'restated-table-count'), []);
  });
  it('keeps a count line with an inline approval deadline', { timeout: 1000 }, () => {
    const html = '<section><p>3 of the 214 payouts this year<strong> need approval by Friday.</strong></p><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></section>';
    assert.deepEqual(hits(html, 'restated-table-count'), []);
    assert.equal(hits(html.replace(' this year<strong> need approval by Friday.</strong>', ' this <strong>year</strong>'), 'restated-table-count').length, 1);
  });
  it('uses only the current option as field state', { timeout: 1000 }, () => {
    const select = '<select><option selected value="Draft">Draft</option><option value="Approved">Approved</option></select>';
    assert.deepEqual(hits(select + '<span class="badge">Approved</span>', 'restated-status-badge'), []);
    assert.equal(hits(select + '<span class="badge">Draft</span>', 'restated-status-badge').length, 1);
  });
  it('ignores an unchecked radio or checkbox value as a field state', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<input type="radio" value="Approved"><span class="badge">Approved</span>', 'restated-status-badge'), []);
    assert.deepEqual(hits('<input type="checkbox" value="Approved"><span class="badge">Approved</span>', 'restated-status-badge'), []);
    assert.equal(hits('<input type="radio" value="Approved" checked><span class="badge">Approved</span>', 'restated-status-badge').length, 1);
  });
  it('ignores a hidden input value as a field state', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<input type="hidden" value="Draft"><span class="badge">Draft</span>', 'restated-status-badge'), []);
  });
  it('counts one field through deeply nested caption spans', { timeout: 1000 }, () => {
    const html = '<div>' + '<span>'.repeat(1600) + '<input>As parsed' + '</span>'.repeat(1600) + '</div>';
    assert.deepEqual(hits(html, 'repeated-field-caption'), []);
  });
  it('rejects a long caption through nested spans within the budget', { timeout: 1000 }, () => {
    const html = '<div>' + '<span>'.repeat(3200) + '<input>This caption contains more than five words' + '</span>'.repeat(3200) + '</div>';
    assert.deepEqual(hits(html, 'repeated-field-caption'), []);
  });
  it('uses the filter noun from its container', { timeout: 1000 }, () => {
    assert.equal(hits('<div class="tag-bar"><button>Clear all tags</button></div>', 'context-noun-control').length, 1);
    assert.deepEqual(hits('<div class="tag-bar"><button>Clear all filters</button></div>', 'context-noun-control'), []);
    assert.deepEqual(hits('<div class="tag-bar"><button>Clear all tags</button></div>', 'multiword-control'), []);
  });
  it('scans many captions under one field without repeating the field search', { timeout: 1000 }, () => {
    const html = `<form><input>${'<p>As parsed</p>'.repeat(2400)}</form>`;
    assert.deepEqual(hits(html, 'repeated-field-caption'), []);
  });
  it('scans many period captions under one control', { timeout: 1000 }, () => {
    const html = `<section><button aria-pressed="true">1Y</button>${'<p>Change against the previous 12 months</p>'.repeat(2400)}</section>`;
    assert.equal(hits(html, 'restated-control-period').length, 2400);
  });
  it('scans many count lines and tables', { timeout: 1000 }, () => {
    const section = '<section><p>3 of the 214 payouts this year</p><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></section>';
    assert.equal(hits(section.repeat(1800), 'restated-table-count').length, 1800);
  });
});

describe('UI heuristics', { timeout: 1000 }, () => {
  for (const rule of rules) {
    it(`${rule} catches its fixture`, { timeout: 1000 }, () => {
      const fixture = rule === 'nested-cards' ? 'slop-ui-nested-cards-painted.html' : `slop-ui-${rule}.html`;
      has(fs.readFileSync(path.join(fixtures, fixture), 'utf8'), rule);
    });
  }
  it('the original unpainted nested card fixture stays silent at paranoid', { timeout: 1000 }, () => {
    assert.deepEqual(scan(fs.readFileSync(path.join(fixtures, 'slop-ui-nested-cards.html'), 'utf8')).findings, []);
  });
  for (const file of fs.readdirSync(fixtures).filter((name) => name.startsWith('clean.'))) {
    it(`${file} stays silent at paranoid`, { timeout: 1000 }, () => {
      assert.deepEqual(scan(fs.readFileSync(path.join(fixtures, file), 'utf8'), file).findings, []);
    });
  }

  it('does not count unpainted card, panel, or tile wrappers as cards', { timeout: 1000 }, () => {
    for (const name of ['card', 'panel', 'tile']) {
      lacks(`<section class="${name}"><div class="${name}">Field notes</div></section>`, 'nested-cards');
      lacks(`<section class="${name}"><div class="card" style="background:white">Field notes</div></section>`, 'nested-cards');
    }
    lacks('<section class="card" style="background:transparent;border:none;box-shadow:none"><div class="card" style="background:white">Field notes</div></section>', 'nested-cards');
    for (const style of [
      'border:0 solid red', 'background:rgba(0,0,0,0)', 'box-shadow:0 0 0 transparent',
      'background:#0000', 'background:hsla(0,0%,0%,0)', 'background:rgb(0 0 0 / 0)',
      'border:1px solid #0000', 'box-shadow:0 2px 4px #0000',
    ]) {
      lacks(`<section class="tile" style="${style}"><div class="card" style="background:white">Field notes</div></section>`, 'nested-cards');
    }
  });
  it('counts nested cards with painted CSS, inline styles, or utility classes', { timeout: 1000 }, () => {
    has('<style>.card { background:white; border:1px solid #ddd }</style><section class="card"><div class="card">Field notes</div></section>', 'nested-cards');
    has('<section class="card" style="border:1px solid #ddd"><div class="card" style="box-shadow:0 2px 6px #777">Field notes</div></section>', 'nested-cards');
    has('<section class="card border"><div class="card bg-white">Field notes</div></section>', 'nested-cards');
    has('<style>.card { background:none; background-color:white }</style><section class="card"><div class="card">Field notes</div></section>', 'nested-cards');
    has('<section class="card" style="background:linear-gradient(white, transparent)"><div class="card" style="background:white">Field notes</div></section>', 'nested-cards');
    has('<style>.card { border-width:1px; border-style:solid; border-color:#ddd }</style><section class="card"><div class="card">Field notes</div></section>', 'nested-cards');
    has('<section style="background:white;border-radius:8px"><div style="border:1px solid #ddd;border-radius:8px">Field notes</div></section>', 'nested-cards');
  });

  const nested = (style) => `<section class="card" style="${style}"><div class="card" style="background:white">Field notes</div></section>`;
  it('counts painted sides when other border widths are zero', { timeout: 1000 }, () => {
    has(nested('border-width:0 3px;border-style:solid;border-color:navy'), 'nested-cards');
    has(nested('border-width:0 0 0 3px;border-style:solid;border-color:navy'), 'nested-cards');
    lacks(nested('border-width:0;border-style:solid;border-color:navy'), 'nested-cards');
  });
  it('checks longhand border color before counting paint', { timeout: 1000 }, () => {
    lacks(nested('border-width:3px;border-style:solid;border-color:transparent'), 'nested-cards');
    has(nested('border-width:3px;border-style:solid;border-color:navy'), 'nested-cards');
  });
  it('recognizes zero alpha in both rgb and rgba separator forms', { timeout: 1000 }, () => {
    for (const name of ['rgb', 'rgba']) {
      lacks(nested(`background:${name}(0 0 0 / 0)`), 'nested-cards');
      lacks(nested(`background:${name}(0,0,0,0)`), 'nested-cards');
      lacks(nested(`background:${name}(0 0 0 / .0)`), 'nested-cards');
      lacks(nested(`background:${name}(0,0,0,.0)`), 'nested-cards');
      has(nested(`background:${name}(0 0 0 / 1)`), 'nested-cards');
      has(nested(`background:${name}(0,0,0,1)`), 'nested-cards');
    }
    has(nested('background:rgb(255,0,0)'), 'nested-cards');
    has(nested('background:hsl(0,0%,0%)'), 'nested-cards');
    has(nested('border:3px solid rgb(255,0,0)'), 'nested-cards');
  });
  it('ignores zero-geometry shadows with a color token', { timeout: 1000 }, () => {
    lacks(nested('box-shadow:0 0 0 0 navy'), 'nested-cards');
    lacks(nested('box-shadow:navy 0 0 0 0'), 'nested-cards');
    lacks(nested('box-shadow:0 0 0 0 color(srgb 1 0 0)'), 'nested-cards');
    has(nested('box-shadow:0 2px 0 0 navy'), 'nested-cards');
    has(nested('box-shadow:0 2px 0 0 rgb(255,0,0)'), 'nested-cards');
  });
  it('splits border sides at CSS whitespace outside color functions', { timeout: 1000 }, () => {
    for (const space of [' ', '\n', '\t']) {
      has(nested(`border-width:3px;border-style:solid;border-color:transparent${space}navy`), 'nested-cards');
      lacks(nested(`border-width:3px;border-style:solid;border-color:transparent${space}transparent`), 'nested-cards');
    }
    has(fs.readFileSync(path.join(fixtures, 'slop-ui-nested-cards-css-values.html'), 'utf8'), 'nested-cards');
  });
  it('keeps transparent color arguments inside visible expressions', { timeout: 1000 }, () => {
    for (const mix of ['color-mix(in srgb, transparent 50%, navy)', 'color-mix(in srgb, rgb(0 0 0 / 0) 50%, navy)']) {
      has(nested(`border:3px solid ${mix}`), 'nested-cards');
      has(nested(`box-shadow:0 3px 0 ${mix}`), 'nested-cards');
    }
    has(nested('background:rgb(from transparent r g b / 1)'), 'nested-cards');
    lacks(nested('background:transparent'), 'nested-cards');
  });
  it('ignores explicit zero alpha in supported modern color forms', { timeout: 1000 }, () => {
    for (const color of ['color(srgb 1 0 0 / 0)', 'hwb(0 0% 0% / 0)', 'lab(50 40 20 / 0)',
      'lch(50 40 20 / 0)', 'oklab(0.5 0.1 0.1 / 0)', 'oklch(0.5 0.2 30 / 0)']) {
      lacks(nested(`background:${color}`), 'nested-cards');
      lacks(nested(`border:3px solid ${color}`), 'nested-cards');
      lacks(nested(`box-shadow:0 3px 0 ${color}`), 'nested-cards');
      const visible = color.replace(/\/ 0\)$/, '/ 1)');
      has(nested(`background:${visible}`), 'nested-cards');
      has(nested(`border:3px solid ${visible}`), 'nested-cards');
      has(nested(`box-shadow:0 3px 0 ${visible}`), 'nested-cards');
    }
  });
  it('reads shadow geometry after balanced color functions', { timeout: 1000 }, () => {
    for (const color of ['rgb(calc(255) 0 0)', 'color-mix(in srgb, navy, white)']) {
      lacks(nested(`box-shadow:0 0 ${color}`), 'nested-cards');
      has(nested(`box-shadow:0 3px ${color}`), 'nested-cards');
    }
  });
  it('keeps a solid border when its color has a missing channel', { timeout: 1000 }, () => {
    lacks(nested('border:3px none navy'), 'nested-cards');
    lacks(nested('border:3px hidden navy'), 'nested-cards');
    has(nested('border:3px solid rgb(0 0 0 / 1)'), 'nested-cards');
    for (const color of ['rgb(none 0 0 / 1)', 'lab(50 none none)', 'color-mix(in srgb, rgb(none 0 0), navy)']) {
      has(nested(`border:3px solid ${color}`), 'nested-cards');
    }
  });
  it('uses the initial border width when a visible style omits it', { timeout: 1000 }, () => {
    lacks(nested('border-style:none;border-color:navy'), 'nested-cards');
    lacks(nested('border-width:0;border-style:solid;border-color:navy'), 'nested-cards');
    has(nested('border-width:3px;border-style:solid;border-color:navy'), 'nested-cards');
    has(nested('border-style:solid;border-color:navy'), 'nested-cards');
    has(fs.readFileSync(path.join(fixtures, 'slop-ui-nested-cards-initial-border.html'), 'utf8'), 'nested-cards');
  });
  it('ignores background shorthand tokens that do not paint', { timeout: 1000 }, () => {
    has(nested('background:none white'), 'nested-cards');
    lacks(nested('background:transparent'), 'nested-cards');
    lacks(nested('background:none transparent'), 'nested-cards');
    lacks(nested('background:transparent center'), 'nested-cards');
  });
  it('ignores numeric background positions when the color is transparent', { timeout: 1000 }, () => {
    has(fs.readFileSync(path.join(fixtures, 'slop-ui-nested-cards-background-layers.html'), 'utf8'), 'nested-cards');
    for (const position of ['50% 50%', '0 0', '8px 12px', 'calc(50% - 1px) center']) {
      lacks(nested(`background:${position} transparent`), 'nested-cards');
      has(nested(`background:${position} white`), 'nested-cards');
    }
  });
  it('ignores background sizes without an image or painted color', { timeout: 1000 }, () => {
    for (const size of ['100% 100%', 'auto', 'calc(100% - 1px) 2rem']) {
      lacks(nested(`background:center / ${size} transparent`), 'nested-cards');
      has(nested(`background:center / ${size} white`), 'nested-cards');
    }
    has(nested('background:linear-gradient(navy, white) center / 100% 100% transparent'), 'nested-cards');
  });
  it('ignores empty background layers and preserves painted layers', { timeout: 1000 }, () => {
    for (const value of ['none, none transparent', 'none,none transparent']) {
      lacks(nested(`background:${value}`), 'nested-cards');
    }
    lacks(nested('background-image:none, none'), 'nested-cards');
    lacks(nested('background-image:none,none'), 'nested-cards');
    has(nested('background:none, none white'), 'nested-cards');
    has(nested('background-image:none, linear-gradient(navy, white)'), 'nested-cards');
  });
  it('keeps painted colors with CSS line breaks', { timeout: 1000 }, () => {
    for (const space of [' ', '\t', '\n', '\r']) {
      has(nested(`background:rgb(0${space}0 128)`), 'nested-cards');
      has(nested(`background:color-mix(in srgb,${space}navy, white)`), 'nested-cards');
      lacks(nested(`background:rgb(0${space}0 128 / 0)`), 'nested-cards');
    }
  });
  it('keeps painted images with CSS line breaks', { timeout: 1000 }, () => {
    for (const space of [' ', '\t', '\n', '\r']) {
      has(nested(`background:linear-gradient(navy,${space}white)`), 'nested-cards');
      has(nested(`background-image:none, linear-gradient(navy,${space}white)`), 'nested-cards');
    }
    lacks(nested('background:none, none transparent'), 'nested-cards');
    lacks(nested('background:center / 100% 100% transparent'), 'nested-cards');
  });

  it('reads gradient clipping and glass from inline styles', { timeout: 1000 }, () => {
    const source = '<h1 style="background:linear-gradient(90deg, purple, pink);background-clip:text">Notes</h1><section style="backdrop-filter:blur(8px)">Records</section>';
    has(source, 'gradient-text');
    has(source, 'ai-gradient');
    has(source, 'glassmorphism');
  });
  it('reads standalone CSS', { timeout: 1000 }, () => {
    has('.glass { backdrop-filter: blur(8px); }', 'glassmorphism', 'sample.css');
    has('.title { background: linear-gradient(90deg, red, orange); -webkit-background-clip: text; }', 'gradient-text', 'sample.css');
  });
  for (const ext of ['html', 'jsx', 'tsx', 'vue', 'svelte', 'astro']) {
    it(`reads utility classes in ${ext}`, { timeout: 1000 }, () => {
      const attr = ['jsx', 'tsx'].includes(ext) ? 'className' : 'class';
      const markup = `<section ${attr}="bg-gradient-to-r from-purple-600 to-blue-500 backdrop-blur"><button ${attr}="rounded-full">Read notes</button></section>`;
      const source = ['jsx', 'tsx'].includes(ext) ? `export default function Page() { return (${markup}); }` : markup;
      for (const rule of ['purple-blue-hero', 'glassmorphism', 'pill-radius']) has(source, rule, `sample.${ext}`);
    });
  }
  it('ignores data attributes that resemble style or class attributes', { timeout: 1000 }, () => {
    const source = '<button data-class="rounded-full backdrop-blur" data-style="backdrop-filter:blur(8px);border-radius:9999px">Read notes</button>';
    lacks(source, 'pill-radius');
    lacks(source, 'glassmorphism');
  });
  it('lets inline radius override rounded-full', { timeout: 1000 }, () => {
    lacks('<button class="rounded-full" style="border-radius:4px">Read notes</button>', 'pill-radius');
  });
  it('reads colored side-border utilities', { timeout: 1000 }, () => {
    has('<section class="border-l-4 border-purple-500">Notes</section>', 'accent-bar');
  });
  it('reads arbitrary utility values', { timeout: 1000 }, () => {
    has('<button class="ease-[cubic-bezier(.3,1.5,.4,1)]">Read notes</button>', 'bounce-easing');
    has('<div class="shadow-[0_0_24px_#a855f7]">Notes</div>', 'glow-shadow');
  });
  it('reads text clipping, stat sizes and bounce utilities', { timeout: 1000 }, () => {
    has('<h1 class="bg-gradient-to-r from-pink-500 to-purple-600 bg-clip-text">Notes</h1>', 'gradient-text');
    has('<strong class="text-6xl">99%</strong>', 'big-number-stat');
    has('<span class="animate-bounce">Notes</span>', 'bounce-easing');
  });
  it('reads color-first glow shadows', { timeout: 1000 }, () => {
    has('<section style="box-shadow:rgba(168,85,247,.5) 0 0 30px">Notes</section>', 'glow-shadow');
  });
  it('reads the serif cream and terracotta palette', { timeout: 1000 }, () => {
    has('<body style="font-family:Georgia,serif;background:#faf7f0;color:#c1653f">Notes</body>', 'stock-palette');
  });
  it('recognizes bounce and elastic animation names', { timeout: 1000 }, () => {
    for (const name of ['bounce', 'elastic', 'easeOutBack']) has(`<style>.item { animation: ${name} 1s; }</style><div class="item">Notes</div>`, 'bounce-easing');
  });

  const nearMisses = [
    ['gradient-text', '<style>h1 { background: linear-gradient(90deg, red, orange); }</style><h1>Notes</h1>'],
    ['ai-gradient', '<div style="background:linear-gradient(90deg, #555, #ddd)">Notes</div>'],
    ['glow-shadow', '<div style="box-shadow:0 0 24px #777">Notes</div>'],
    ['glow-shadow', '<div style="box-shadow:0 4px 24px purple">Notes</div>'],
    ['glow-shadow', '<div style="box-shadow:0 0 10px #777, 0 5px 10px #a855f7">Notes</div>'],
    ['glassmorphism', '<div style="filter:blur(4px)">Notes</div>'],
    ['nested-cards', '<div class="card">North</div><div class="card">South</div>'],
    ['bounce-easing', '<div style="transition:opacity 200ms cubic-bezier(.2,0,.8,1)">Notes</div>'],
    ['accent-bar', '<section class="card" style="border-left:4px solid #aaa">Notes</section>'],
    ['pill-radius', '<img class="avatar" style="border-radius:50%" src="a.png" alt="Portrait">'],
    ['big-number-stat', '<strong style="font-size:24px">99%</strong>'],
    ['big-number-stat', '<h1 style="font-size:64px">Station records</h1>'],
    ['big-number-stat', '<table><tr><td><span style="font-size:64px">99</span></td></tr></table>'],
    ['emoji-icon', '<p>She sent a 🚀 after the launch.</p>'],
    ['emoji-icon', '<code>🚀</code>'],
    ['emoji-icon', '<h2><span>🚀</span> Records</h2>'],
    ['family-ceiling', '<p style="font-family:Arial, Helvetica, Verdana, Tahoma, sans-serif">Notes</p>'],
    ['stock-display-face', '<p style="font-family:Inter,sans-serif;font-size:16px">Notes</p>'],
    ['mono-uppercase-label', '<code style="font-family:monospace;text-transform:uppercase;letter-spacing:.1em">GET</code>'],
    ['accent-budget', '<style>.a { color:#2563eb } .b { color:#e11d48 } .c { background:#eff6ff } .d { background:#fef2f2 }</style>'],
    ['hairline-grid', '<section style="display:grid"><div style="border:1px solid #ddd">North</div><div style="border:1px solid #ddd">South</div></section>'],
    ['double-edge', '<section style="border:1px solid #ddd;background:white">Notes</section>'],
    ['button-drift', '<button style="height:32px">Read</button><button style="height:40px">Save</button>'],
    ['everything-centred', '<p style="text-align:center">North station</p><p>Records</p>'],
    ['everything-centred', '<style>body { text-align:center } p { text-align:left }</style><p>Records</p>'],
    ['stock-palette', '<body style="background:white;color:#ccff00">Records</body>'],
  ];
  for (const [index, [rule, source]] of nearMisses.entries()) {
    it(`${rule} leaves near miss ${index + 1} alone`, { timeout: 1000 }, () => lacks(source, rule));
  }
});


describe('UI scan bounds', { timeout: 3000 }, () => {
  it('scans 2500 nodes with inline styles within the budget', { timeout: 2500 }, () => {
    const source = '<main>' + '<p style="color:#333">Station record</p>'.repeat(2500) + '</main>';
    assert.deepEqual(scan(source).findings, []);
  });
  it('scans 200KB brace-free CSS within the budget', { timeout: 2500 }, () => {
    assert.deepEqual(scan('.unclosed-selector '.repeat(11000), 'sample.css').findings, []);
  });
  it('scans a deeply nested button within the budget', { timeout: 2500 }, () => {
    const source = '<button>' + '<div>'.repeat(30000) + 'Open settings' + '</div>'.repeat(30000) + '</button>';
    assert.equal(scan(source).findings.filter((finding) => finding.rule === 'multiword-control').length, 1);
  });
  it('scans deeply nested status badges within the budget', { timeout: 1500 }, () => {
    const source = '<main>' + '<div class="status-badge">'.repeat(6000) + 'Active' + '</div>'.repeat(6000) + '</main>';
    assert.deepEqual(scan(source).findings.filter((finding) => finding.rule === 'restated-status-badge'), []);
  });
  it('scans deeply nested count paragraphs within the budget', { timeout: 1500 }, () => {
    const source = '<main>' + '<p>'.repeat(6000) + '25 of 214 results' + '</p>'.repeat(6000) + '</main>';
    assert.deepEqual(scan(source).findings.filter((finding) => finding.rule === 'restated-table-count'), []);
  });
});
