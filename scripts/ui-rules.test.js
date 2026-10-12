'use strict';

const { describe, it } = require('./lib/budget');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { detect, kindForPath } = require('./detect');

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
});
