'use strict';

const { describe, it, before } = require('./lib/budget');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
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
function spans(content, rule) { return scan(content).findings.filter((finding) => finding.rule === rule).map((finding) => finding.span); }

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
  it('limits the explainer sentence to a selection marker, not any colored line', { timeout: 1000 }, () => {
    assert.equal(hits('<p>An accent bar marks the selected option.</p>', 'marker-explainer').length, 1);
    assert.deepEqual(hits('<p>The dashed color line shows the target.</p>', 'marker-explainer'), []);
    assert.deepEqual(hits('<p>The red line shows the legal limit.</p>', 'marker-explainer'), []);
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
  it('ignores hidden text, including display:none and case-insensitive aria-hidden', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<button>Close<span hidden> dialog</span></button>', 'multiword-control'), []);
    assert.deepEqual(hits('<button>Close<span style="display:none"> dialog</span></button>', 'multiword-control'), []);
    assert.deepEqual(hits('<button>Close<span aria-hidden="TRUE"> dialog</span></button>', 'multiword-control'), []);
  });
  it('counts only words with a letter and leaves kbd text out of a control label', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<button>Inbox <span class="count">12</span></button>', 'multiword-control'), []);
    assert.deepEqual(hits('<button>Save <kbd>⌘S</kbd></button>', 'multiword-control'), []);
  });
  it('skips a live validation message as a repeated field caption', { timeout: 1000 }, () => {
    const alerts = '<form>' + '<label>Amount <input><span class="error" role="alert">This field is required</span></label>'.repeat(3) + '</form>';
    assert.deepEqual(hits(alerts, 'repeated-field-caption'), []);
    const smalls = '<form>' + '<label>Amount <input><small role="alert">Required</small></label>'.repeat(3) + '</form>';
    assert.deepEqual(hits(smalls, 'repeated-field-caption'), []);
  });
  it('scopes a badge to its own section', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<nav><span class="cart-badge">1</span></nav><main><input type="number" value="1"></main>', 'restated-status-badge'), []);
    assert.deepEqual(hits('<nav><a class="pill active">Settings</a></nav><main><h1>Settings</h1></main>', 'restated-status-badge'), []);
    assert.deepEqual(hits('<section><select><option selected>Paid</option></select><table><tbody><tr><td><span class="badge">Paid</span></td></tr></tbody></table></section>', 'restated-status-badge'), []);
    assert.equal(hits('<section><input value="Needs review"><span class="status-badge">Needs review</span></section>', 'restated-status-badge').length, 1);
  });
  it('requires a letter in the badge label', { timeout: 1000 }, () => {
    assert.deepEqual(hits('<section><input type="number" value="1"><span class="cart-badge">1</span></section>', 'restated-status-badge'), []);
  });
  it('requires the border or outline itself, not only the stripe, to carry an accent color', { timeout: 1000 }, () => {
    const nav = (style) => `<style>.nav-item.active { ${style} }</style><div class="nav-item active">Dashboard</div>`;
    assert.deepEqual(hits(nav('border: 1px solid #e5e7eb; box-shadow: inset 3px 0 0 #2563eb'), 'inset-accent-marker'), []);
    assert.equal(hits(nav('border: 1px solid #2563eb; box-shadow: inset 3px 0 0 #2563eb'), 'inset-accent-marker').length, 1);
  });
  it('matches a plural selection-marker sentence and reads a nested subtree', { timeout: 1000 }, () => {
    assert.equal(hits('<p>The accent bars mark fields that changed.</p>', 'marker-explainer').length, 1);
    assert.equal(hits('<p>An <strong>accent bar</strong> marks the selected option.</p>', 'marker-explainer').length, 1);
  });
  it('finds the first table inside a wrapper sibling, or beside its own heading row', { timeout: 1000 }, () => {
    assert.equal(hits('<section><p>3 of the 214 payouts this year</p><div class="wrap"><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></div></section>', 'restated-table-count').length, 1);
    assert.equal(hits('<section><header><h2>Totals</h2><p>3 of the 214 payouts this year</p></header><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></section>', 'restated-table-count').length, 1);
  });
  describe('restated-table-count stress', { timeout: 3000 }, () => {
    let ctx;
    before(() => {
      const section = '<section><p>3 of the 214 payouts this year</p><table><tr><td>A</td></tr><tr><td>B</td></tr><tr><td>C</td></tr></table></section>';
      ctx = parse(section.repeat(1800), { ext: 'html' });
    });
    it('times only the rule call, with the page already parsed', { timeout: 300 }, () => {
      const rule = RULES.find((r) => r.id === 'restated-table-count');
      assert.equal(rule.test(ctx).length, 1800);
    });
  });
  describe('nested-depth performance', { timeout: 10000 }, () => {
    it('reads a deeply nested role=button control without quadratic cost', { timeout: 2000 }, () => {
      const html = '<div role="button">'.repeat(6000) + 'Save' + '</div>'.repeat(6000);
      assert.deepEqual(hits(html, 'multiword-control'), []);
    });
    it('reads a deeply nested btn anchor without quadratic cost', { timeout: 2000 }, () => {
      const html = '<a class="btn">'.repeat(6000) + 'Save' + '</a>'.repeat(6000);
      assert.deepEqual(hits(html, 'multiword-control'), []);
    });
    it('reads deeply nested headings without quadratic cost', { timeout: 2000 }, () => {
      const html = '<h2>'.repeat(6000) + 'Title' + '</h2>'.repeat(6000);
      assert.deepEqual(hits(html, 'restated-status-badge'), []);
    });
    it('reads deeply nested selected options without quadratic cost', { timeout: 2000 }, () => {
      const html = '<select>' + '<option selected>'.repeat(6000) + 'Approved' + '</option>'.repeat(6000) + '</select>';
      assert.deepEqual(hits(html, 'restated-status-badge'), []);
    });
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
  // A live region reports what the reader just did. A sentence naming the
  // button's action is feedback when that button shares its block. Take the
  // button away and the same line is a footnote. A link is not a control.
  it("keeps a control's own feedback out of the table rules", { timeout: 1000 }, () => {
    const live =
      '<section><h2>Move booking</h2><p class="hint" role="status">The hall already holds a booking then.</p>' +
      '<table><tbody><tr><td>12.5</td></tr></tbody></table></section>';
    lacks(live, 'table-aside');
    has(live.replace(' role="status"', ''), 'table-aside');
    const beside =
      '<section><table><tbody><tr><td>12.5</td></tr></tbody></table>' +
      '<div class="note"><button>Save</button><p>Saving a new time notifies the observer.</p></div></section>';
    lacks(beside, 'table-footnote');
    has(beside.replace('<button>Save</button>', '<a href="/save">Save</a>'), 'table-footnote');
    // A basis stated in words is a footnote however it is set, so a card footer
    // holding a basis line and a Download button keeps reading on both rules.
    has(beside.replace('Saving a new time notifies the observer.', 'Amounts in EUR, VAT excluded.'), 'table-footnote');
    has(live.replace('The hall already holds a booking then.', 'Figures as of 1 April 2026.'), 'table-aside');
    // A marker on the line that holds the words still counts, control or not. A
    // card footer with a muted caption and an Export button is a footnote with a
    // button next to it, which is the commonest card a kit ships.
    has(
      '<section><h2>Spend</h2><table><tbody><tr><td>12.5</td></tr></tbody></table>' +
        '<div class="card-footer"><small class="text-muted">Updated nightly, so yesterday stays open.' +
        '</small><button>Export</button></div></section>',
      'table-footnote'
    );
    has(
      '<section><h2>Revenue per unit</h2><div class="toolbar"><p class="lede">Past due, or holding up a ' +
        'month close.</p><select><option>All</option></select></div>' +
        '<table><tbody><tr><td>12.5</td></tr></tbody></table></section>',
      'table-aside'
    );
    has(
      '<section><h2>Spend</h2><table><tbody><tr><td>12.5</td></tr></tbody></table>' +
        '<div class="wrap"><small class="text-muted"><span>Updated nightly, so yesterday stays open.' +
        '</span></small><button>Export</button></div></section>',
      'table-footnote'
    );
  });
  it('keeps unrelated controls and live siblings from hiding table notes', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const note = '<div class="text-muted"><p>Updated nightly, so yesterday stays open.</p>';
    for (const sibling of [
      '<button>Export</button>', '<input type="hidden" value="x">',
      '<p role="status">Export complete.</p>',
    ]) has(`<section>${row}${note}${sibling}</div></section>`, 'table-footnote');
    has(`<section>${row}<div class="note"><p>Saving the report notifies the observer.</p><button>Export</button></div></section>`, 'table-footnote');
    const lede = '<div class="lede"><p>Past due, or holding up a month close.</p>';
    for (const sibling of [
      '<select><option>All</option></select>', '<input type="hidden" value="x">',
      '<p role="status">Filter updated.</p>',
    ]) has(`<section><h2>Overdue</h2>${lede}${sibling}</div>${row}</section>`, 'table-aside');
  });
  it('keeps Move booking and Save feedback out of both table rules', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<div class="pay-foot"><button>Move booking</button><p>Saving a new room or time notifies the observer.</p></div>';
    lacks(`<section>${row}${line}</section>`, 'table-footnote');
    lacks(`<section><h2>Move booking</h2>${line}${row}</section>`, 'table-aside');
  });
  it('reads nested button text and submit input values as action labels', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    for (const control of ['<button><span>Save</span></button>', '<input type="submit" value="Save">']) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${control}</div>`;
      lacks(`<section>${row}${line}</section>`, 'table-footnote');
      lacks(`<section><h2>Times</h2>${line}${row}</section>`, 'table-aside');
    }
  });
  it('matches each supported action with its feedback verb', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    for (const [label, verb] of [
      ['Save', 'Saving'], ['Change', 'Changing'], ['Move', 'Moving'],
      ['Select', 'Selecting'], ['Choose', 'Choosing'], ['Submit', 'Submitting'],
      ['Send', 'Sending'], ['Filter', 'Filtering'], ['Search', 'Searching'],
    ]) {
      const line = `<div class="note"><p>${verb} the report notifies the observer.</p><button>${label}</button></div>`;
      lacks(`<section>${row}${line}</section>`, 'table-footnote');
      lacks(`<section><h2>Reports</h2>${line}${row}</section>`, 'table-aside');
    }
  });
  it('keeps a separate note in the same wrapper as matching feedback', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<div class="text-muted"><p>Saving a new time notifies the observer.</p>' +
      '<p>Updated nightly, so yesterday stays open.</p><button>Save</button></div>';
    has(`<section>${row}${line}</section>`, 'table-footnote');
    has(`<section><h2>Reports</h2>${line}${row}</section>`, 'table-aside');
  });
  it('keeps inline styling on a note beside matching action feedback', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<div><small class="text-muted">Saving a new time notifies the observer.</small><button>Save</button></div>';
    lacks(`<section>${row}${line}</section>`, 'table-footnote');
    lacks(`<section><h2>Reports</h2>${line}${row}</section>`, 'table-aside');
    const nestedFeedback = line.replace('Saving a new time notifies the observer.',
      '<span>Saving a new time notifies the observer.</span>');
    lacks(`<section>${row}${nestedFeedback}</section>`, 'table-footnote');
    lacks(`<section><h2>Reports</h2>${nestedFeedback}${row}</section>`, 'table-aside');
    const note = line.replace('Saving a new time notifies the observer.', 'Updated nightly, so yesterday stays open.');
    has(`<section>${row}${note}</section>`, 'table-footnote');
    has(`<section><h2>Reports</h2>${note}${row}</section>`, 'table-aside');
    const nestedNote = note.replace('Updated nightly, so yesterday stays open.',
      '<span>Updated nightly, so yesterday stays open.</span>');
    has(`<section>${row}${nestedNote}</section>`, 'table-footnote');
    has(`<section><h2>Reports</h2>${nestedNote}${row}</section>`, 'table-aside');
  });
  it('reads basis wording inside a live region with or without a wrapper', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<p role="status">Amounts in EUR, VAT excluded.</p>';
    for (const note of [line, `<div>${line}</div>`]) {
      has(`<section>${row}${note}</section>`, 'table-footnote');
      has(`<section><h2>Reports</h2>${note}${row}</section>`, 'table-aside');
    }
  });
  it('does not read quoted live-region text as an attribute', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = 'Updated nightly, so yesterday stays open.';
    has(`<section>${row}<p class="text-muted" title="Use role='status' for messages">${line}</p></section>`, 'table-footnote');
    has(`<section>${row}<p class="text-muted" title="Set aria-live='polite' for messages">${line}</p></section>`, 'table-footnote');
    lacks(`<section>${row}<p class="text-muted" role="status">${line}</p></section>`, 'table-footnote');
    lacks(`<section>${row}<p class="text-muted" aria-live="polite">${line}</p></section>`, 'table-footnote');
  });
  it('treats inline feedback as one line', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<div class="text-muted"><p>Saving <strong>a new time notifies the observer.</strong></p><button>Save</button></div>';
    lacks(`<section>${row}${line}</section>`, 'table-footnote');
    lacks(`<section><h2>Times</h2>${line}${row}</section>`, 'table-aside');
    const note = line.replace('Saving ', 'Updated ');
    has(`<section>${row}${note}</section>`, 'table-footnote');
    has(`<section><h2>Times</h2>${note}${row}</section>`, 'table-aside');
  });
  it('keeps an earlier note when the last child is short', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const line = '<div class="text-muted"><p>Updated nightly, so yesterday stays open.</p><p>Draft</p><button>Save</button></div>';
    has(`<section>${row}${line}</section>`, 'table-footnote');
    has(`<section><h2>Times</h2>${line}${row}</section>`, 'table-aside');
  });
  it('does not add button or live text to a note', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    for (const line of [
      '<div class="text-muted">Draft <button>Export all these rows to a file.</button></div>',
      '<div class="text-muted">Ready <p role="status">Export complete for all rows.</p></div>',
    ]) {
      lacks(`<section>${row}${line}</section>`, 'table-footnote');
      lacks(`<section><h2>Times</h2>${line}${row}</section>`, 'table-aside');
    }
  });
  it('reads only real input type and value attributes', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    const controls = [
      ['<input type="submit" title="Use value=\'Save\' for testing" value="Export">', true],
      ['<input title="Use type=\'hidden\' for testing" type="submit" value="Save">', false],
      ['<input type=submit value=Save>', false],
    ];
    for (const [control, flagged] of controls) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${control}</div>`;
      const below = `<section>${row}${line}</section>`;
      const above = `<section><h2>Times</h2>${line}${row}</section>`;
      if (flagged) {
        has(below, 'table-footnote');
        has(above, 'table-aside');
      } else {
        lacks(below, 'table-footnote');
        lacks(above, 'table-aside');
      }
    }
  });
  it('uses visible button text without hidden or SVG metadata', { timeout: 1000 }, () => {
    const row = '<table><tbody><tr><td>12.5</td></tr></tbody></table>';
    for (const [control, flagged] of [
      ['<button><svg><title>Disk icon</title></svg><span>Save</span></button>', false],
      ['<button><span hidden>Save</span><span>Export</span></button>', true],
      ['<button><span aria-hidden="true">Save</span>Export</button>', true],
      ['<button><span style="display:none">Save</span>Export</button>', true],
    ]) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${control}</div>`;
      const below = `<section>${row}${line}</section>`;
      const above = `<section><h2>Times</h2>${line}${row}</section>`;
      if (flagged) {
        has(below, 'table-footnote');
        has(above, 'table-aside');
      } else {
        lacks(below, 'table-footnote');
        lacks(above, 'table-aside');
      }
    }
  });
  it('keeps a note marker on an inline child after grouping its line', { timeout: 1000 }, () => {
    const line = '<div><p>Note: <small class="text-muted">Updated nightly, so yesterday stays open.</small></p><button>Export</button></div>';
    has(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
    has(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
  });
  it('groups inline siblings when their parent has no direct text', { timeout: 1000 }, () => {
    const feedback = '<div class="text-muted"><p><span>Saving </span><strong>a new time notifies the observer.</strong></p><button>Save</button></div>';
    const note = feedback.replace('<span>Saving </span><strong>a new time notifies the observer.</strong>',
      '<span>Updated nightly, so </span><strong>yesterday stays open.</strong>');
    for (const [line, flagged] of [[feedback, false], [note, true]]) {
      const check = flagged ? has : lacks;
      check(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
      check(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
    }
  });
  it('treats br as a boundary between feedback and a separate note', { timeout: 1000 }, () => {
    const line = '<div class="text-muted">Saving a new time notifies the observer.<br>Updated nightly, so yesterday stays open.<button>Save</button></div>';
    has(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
    has(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
  });
  it('does not match hidden controls or controls inside hidden ancestors', { timeout: 1000 }, () => {
    for (const control of ['<input hidden type="submit" value="Save">', '<span hidden><button>Save</button></span>']) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${control}<button>Export</button></div>`;
      has(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
      has(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
    }
  });
  it('does not match selected options or textarea data as actions', { timeout: 1000 }, () => {
    for (const control of ['<select><option>Save</option><option selected>Export</option></select>',
      '<textarea>Save this note</textarea>']) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${control}<button>Export</button></div>`;
      has(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
      has(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
    }
  });
  it('joins inline pieces of a visible button label without adding spaces', { timeout: 1000 }, () => {
    const line = '<div class="note"><p>Saving a new time notifies the observer.</p><button><b>Sa</b>ve</button></div>';
    lacks(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
    lacks(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
  });
  it('keeps line and block boundaries inside button labels', { timeout: 1000 }, () => {
    for (const button of ['<button>Save<br>Now</button>', '<button><div>Save</div><div>Now</div></button>']) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${button}</div>`;
      lacks(`<table><tr><td>12</td></tr></table>${line}`, 'table-footnote');
      lacks(`<h2>Totals</h2>${line}<table><tr><td>12</td></tr></table>`, 'table-aside');
    }
  });
  it('keeps a separate note inside a live status wrapper', { timeout: 1000 }, () => {
    const below = '<div class="text-muted" role="status"><p>Export complete.</p><p>Updated nightly, so yesterday stays open.</p></div>';
    const above = '<div class="lede" role="status"><p>Filter updated.</p><p>Past due, or holding up a month close.</p></div>';
    has(`<table><tr><td>12</td></tr></table>${below}`, 'table-footnote');
    has(`<h2>Totals</h2>${above}<table><tr><td>12</td></tr></table>`, 'table-aside');
    lacks(`<table><tr><td>12</td></tr></table><div class="text-muted" role="status"><p>The export completed for all selected rows.</p></div>`, 'table-footnote');
    lacks(`<h2>Totals</h2><div class="lede" role="status"><p>The filter completed for all selected rows.</p></div><table><tr><td>12</td></tr></table>`, 'table-aside');
  });
  it('keeps the data note after Save or Export feedback below a table', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = '<p>Saving a new time notifies the observer.</p>';
    const dataNote = '<p>Updated nightly, so yesterday stays open.</p>';
    for (const label of ['Save', 'Export']) {
      const wrapper = `<div class="text-muted" role="status">${feedback}${dataNote}<button>${label}</button></div>`;
      const spans = scan(table + wrapper).findings.filter((finding) => finding.rule === 'table-footnote')
        .map((finding) => finding.span);
      assert.deepEqual(spans, ['under <table>: Updated nightly, so yesterday stays open.']);
    }
    lacks(table + `<div class="text-muted" role="status">${feedback}<button>Save</button></div>`, 'table-footnote');
  });
  it('keeps the data note after Save or Export feedback above a table', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = '<p>Saving a new time notifies the observer.</p>';
    const dataNote = '<p>Updated nightly, so yesterday stays open.</p>';
    for (const label of ['Save', 'Export']) {
      const wrapper = `<div class="lede" role="status">${feedback}${dataNote}<button>${label}</button></div>`;
      const spans = scan(`<h2>Totals</h2>${wrapper}${table}`).findings
        .filter((finding) => finding.rule === 'table-aside').map((finding) => finding.span);
      assert.deepEqual(spans, ['beside <h2> "Totals" above <table>: Updated nightly, so yesterday stays open.']);
    }
    lacks(`<h2>Totals</h2><div class="lede" role="status">${feedback}<button>Save</button></div>${table}`, 'table-aside');
  });
  it('keeps one live identity when status text has an inline child', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const sentence of ['The export completed for all selected rows.',
      'The export completed for <span>all selected rows.</span>']) {
      const line = `<p class="text-muted" role="status">${sentence}</p>`;
      lacks(table + line, 'table-footnote');
      lacks(`<h2>Totals</h2>${line}${table}`, 'table-aside');
    }
  });
  it('finds a data note inside a nested live wrapper in either order', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const status = '<p>Export complete.</p>';
    const note = '<p>Updated nightly, so yesterday stays open.</p>';
    for (const lines of [status + note, note + status]) {
      for (const wrap of [(content) => content, (content) => `<div>${content}</div>`]) {
        const below = wrap(`<div class="text-muted" role="status">${lines}</div>`);
        const above = wrap(`<div class="lede" role="status">${lines}</div>`);
        has(table + below, 'table-footnote');
        has(`<h2>Totals</h2>${above}${table}`, 'table-aside');
      }
    }
  });
  it('does not give an empty or short inline marker surrounding prose', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const line of [
      '<div>Updated nightly, so yesterday stays open.</div>',
      '<div>Updated nightly, so yesterday stays open.<small></small></div>',
      '<div>Total revenue across all the selected rooms: <small>EUR.</small></div>',
    ]) {
      lacks(table + line, 'table-footnote');
      lacks(`<h2>Totals</h2>${line}${table}`, 'table-aside');
    }
  });
  it('splits prose before and after a block child', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const line of [
      '<div class="text-muted">Saving a new time notifies the observer.<div>Ready</div>Updated nightly, so yesterday stays open.<button>Save</button></div>',
      '<div class="text-muted">Saving a new time notifies the observer.<div>Ready</div>Updated <span>nightly, so yesterday stays open.</span><button>Save</button></div>',
      '<div class="text-muted"><p>Saving a new time notifies the observer.</p><div>Ready</div><p>Updated nightly, so yesterday stays open.</p><button>Save</button></div>',
    ]) {
      has(table + line, 'table-footnote');
      has(`<h2>Totals</h2>${line}${table}`, 'table-aside');
    }
  });
  it('keeps the closing block boundary in a button label', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const button of ['<button><div>Save</div>now</button>', '<button>Save<div>now</div></button>']) {
      const line = `<div class="note"><p>Saving a new time notifies the observer.</p>${button}</div>`;
      lacks(table + line, 'table-footnote');
      lacks(`<h2>Totals</h2>${line}${table}`, 'table-aside');
    }
  });
  it('groups ordinary inline tags into their complete prose line', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const tag of ['span', 'abbr', 'bdi']) {
      const feedback = `<div class="text-muted"><p><${tag}>Saving</${tag}> a new time notifies the observer.</p><button>Save</button></div>`;
      const note = `<div class="text-muted"><p><${tag}>Updated nightly, so </${tag}>yesterday stays open.</p><button>Export</button></div>`;
      lacks(table + feedback, 'table-footnote');
      lacks(`<h2>Totals</h2>${feedback}${table}`, 'table-aside');
      has(table + note, 'table-footnote');
      has(`<h2>Totals</h2>${note}${table}`, 'table-aside');
    }
  });
  it('ignores empty, numeric, and control-only table asides', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const candidate of ['<div></div>', '<div>123</div>', '<div><button>Export</button></div>']) {
      lacks(`<h2>Reports</h2>${candidate}${table}`, 'table-aside');
    }
  });
  it('keeps a note split across adjacent small elements', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const whole = '<div><small>Updated nightly, so yesterday stays open.</small><button>Export</button></div>';
    const split = '<div><small>Updated nightly, so </small><small>yesterday stays open.</small><button>Export</button></div>';
    for (const candidate of [whole, split]) has(table + candidate, 'table-footnote');
    lacks(table + '<div><small>Updated nightly, so </small>yesterday stays open.<button>Export</button></div>', 'table-footnote');
  });
  it('keeps a live span separate from neighboring ordinary text', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const [status, action] of [['Ready.', 'Export'],
      ['Saving a new time notifies the observer.', 'Save']]) {
      const candidate = `<div class="text-muted"><span role="status">${status}</span> Updated nightly, so yesterday stays open.<button>${action}</button></div>`;
      has(table + candidate, 'table-footnote');
      has(`<h2>Reports</h2>${candidate}${table}`, 'table-aside');
    }
    lacks(table + '<div class="text-muted" role="status">Ready.<button>Export</button></div>', 'table-footnote');
  });
  it('keeps whitespace between marked inline pieces', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const gap of [' ', '\n']) {
      const note = `<div><small>Updated nightly, so</small>${gap}<small>yesterday stays open.</small><button>Export</button></div>`;
      for (const [html, rule] of [[table + note, 'table-footnote'],
        [`<h2>Reports</h2>${note}${table}`, 'table-aside']]) {
        const spans = scan(html).findings.filter((finding) => finding.rule === rule).map((finding) => finding.span);
        assert.ok(spans.some((span) => span.includes('Updated nightly, so yesterday stays open.')));
      }
    }
  });
  it('groups marked spans through neutral inline wrappers', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const note of [
      '<div><span class="text-muted">Updated nightly, so </span><span class="text-muted">yesterday stays open.</span><button>Export</button></div>',
      '<div><span><small>Updated nightly, so </small></span><small>yesterday stays open.</small><button>Export</button></div>',
    ]) {
      has(table + note, 'table-footnote');
      has(`<h2>Reports</h2>${note}${table}`, 'table-aside');
    }
    lacks(table + '<div><small>Updated nightly, so </small>yesterday stays open.<button>Export</button></div>', 'table-footnote');
  });
  it('keeps action feedback split across marked inline pieces', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const note of [
      '<div><small>Saving </small><small>a new time notifies the observer.</small><button>Save</button></div>',
      '<div><span class="text-muted">Saving </span><span class="text-muted">a new time notifies the observer.</span><button>Save</button></div>',
    ]) {
      lacks(table + note, 'table-footnote');
      lacks(`<h2>Reports</h2>${note}${table}`, 'table-aside');
    }
  });
  it('does not join live text to a marked ordinary note', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const status = 'The export completed for all selected rows.';
    for (const live of ['role="status"', 'role="alert"', 'aria-live="polite"']) {
      const split = `<div><small>Draft </small><small ${live}>${status}</small></div>`;
      const nested = `<div><small>Draft <span ${live}>${status}</span></small></div>`;
      for (const note of [split, nested]) {
        lacks(table + note, 'table-footnote');
        lacks(`<h2>Reports</h2>${note}${table}`, 'table-aside');
      }
    }
  });
  it('keeps a mixed-marker Save sentence as feedback', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = '<div><p><span>Saving </span><small>a new booking notifies every room participant.</small></p><button>Save</button></div>';
    assert.deepEqual(spans(table + feedback, 'table-footnote'), []);
    assert.deepEqual(spans(`<h2>Reports</h2>${feedback}${table}`, 'table-aside'), []);
    const withNote = '<div><p><span>Saving </span><small>a new booking notifies every room participant.</small></p>' +
      '<p class="text-muted">Updated nightly, so yesterday stays open.</p><button>Save</button></div>';
    assert.deepEqual(spans(table + withNote, 'table-footnote'),
      ['under <table>: Updated nightly, so yesterday stays open.']);
    assert.deepEqual(spans(`<h2>Reports</h2>${withNote}${table}`, 'table-aside'),
      ['beside <h2> "Reports" above <table>: Updated nightly, so yesterday stays open.']);
  });
  it('reports the data note after Export completion in a live wrapper', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = '<p>The export completed for <strong>all selected bookings.</strong></p>';
    const note = '<p>Updated each morning, so late bookings appear tomorrow.</p>';
    const wrapper = `<div class="text-muted" role="status">${feedback}${note}<button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'),
      ['under <table>: Updated each morning, so late bookings appear tomorrow.']);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      ['beside <h2> "Reports" above <table>: Updated each morning, so late bookings appear tomorrow.']);
    const onlyFeedback = `<div class="text-muted" role="status">${feedback}<button>Export</button></div>`;
    assert.deepEqual(spans(table + onlyFeedback, 'table-footnote'), []);
    assert.deepEqual(spans(`<h2>Reports</h2>${onlyFeedback}${table}`, 'table-aside'), []);
  });
  it('keeps an earlier note when later groups share its marker', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Updated nightly, so yesterday stays open.';
    for (const first of [note, `<span class="text-muted">${note}</span>`]) {
      const line = `<div class="text-muted">${first} <span role="status">Ready.</span> Saving a new time notifies the observer.<button>Save</button></div>`;
      assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
    for (const tail of ['Draft', '12']) {
      const line = `<div class="text-muted">${note} <span role="status">Ready.</span> ${tail}</div>`;
      assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
    }
  });
  it('leaves unsupported Exporting prose visible to the table rules', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const line = '<div class="text-muted"><p><span>Exporting </span><strong>these bookings downloads a file to your device.</strong></p><button>Export</button></div>';
    const text = 'Exporting these bookings downloads a file to your device.';
    assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${text}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${text}`]);
  });
  it('reports a separate note after inline Export completion', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = 'The export completed for <strong>all selected bookings in the current month.</strong>';
    const note = 'Updated each morning, so late bookings appear tomorrow.';
    const wrapper = `<div class="text-muted" role="status">${feedback}<p>${note}</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
    const paragraph = wrapper.replace(feedback, `<p>${feedback}</p>`);
    assert.deepEqual(spans(table + paragraph, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${paragraph}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
  });
  it('keeps completion words inside data notes', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const [feedback, note] of [
      ['Export complete.', 'Export includes only completed bookings from yesterday.'],
      ['Ready.', 'Export rows show whether each booking is complete.'],
    ]) {
      const wrapper = `<div class="text-muted" role="status"><p>${feedback}</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('keeps a data sentence beside feedback in the same paragraph', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Updated each morning, so late bookings appear tomorrow.';
    const feedback = 'Saving a new booking notifies every room participant.';
    for (const text of [`${note} ${feedback}`, `${feedback} ${note}`]) {
      const wrapper = `<div><p class="text-muted">${text}</p><button>Save</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
    const live = `<div class="text-muted" role="status"><p>${note} The export completed for all selected bookings.</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + live, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${live}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
  });
  it('reads completion after an inline marked fragment', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const feedback = '<p>The export <small>for all bookings selected in this table</small> completed.</p>';
    const note = 'Updated each morning, so late bookings appear tomorrow.';
    const wrapper = `<div role="status">${feedback}<p class="text-muted">${note}</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
    const onlyFeedback = `<div role="status">${feedback}<p>Ready.</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + onlyFeedback, 'table-footnote'), []);
    assert.deepEqual(spans(`<h2>Reports</h2>${onlyFeedback}${table}`, 'table-aside'), []);
  });
  it('scans repeated table notes with bounded growth', { timeout: 2500 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const group = '<small>Updated nightly, so yesterday stays open.</small> Extra. ';
    const scanNotes = (count) => {
      const html = table + '<div>' + group.repeat(count) + '</div>';
      const start = performance.now();
      const findings = detect(html, { level: 1, kind: 'artifact', ext: 'html' }).findings;
      assert.ok(findings.some((finding) => finding.rule === 'table-footnote'));
      return performance.now() - start;
    };
    scanNotes(100);
    const sizes = [300, 600, 1200, 2400];
    const durations = sizes.map(scanNotes);
    assert.ok(durations.at(-1) <= durations[0] * 5 + 150,
      `Repeated table notes grew too fast: ${JSON.stringify({ sizes, durations })}`);
  });
  it('keeps a numeric sentence after Export completion', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = '24 hours can pass before late bookings appear.';
    const wrapper = `<div class="text-muted" role="status">The export completed for all selected bookings. ${note}<button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
  });
  it('keeps a quoted sentence after Export completion', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = '“Updated each morning, so late bookings appear tomorrow.”';
    const wrapper = `<div class="text-muted" role="status">The export completed for all selected bookings. ${note}<button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note}`]);
  });
  it('keeps completion words that describe data fields', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const notes = [
      'The export for this view lists only bookings marked complete.',
      'The export for this table lists bookings only when their status is complete.',
      'The export for this view shows which bookings have finished.',
      'The export for each booking shows whether payment is complete.',
    ];
    for (const note of notes) {
      const wrapper = `<div class="text-muted" role="status"><p>Ready.</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note.slice(0, 70)}`]);
    }
    const confirmed = notes[0].replace('complete', 'confirmed');
    const control = `<div class="text-muted" role="status"><p>Ready.</p><p>${confirmed}</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + control, 'table-footnote'), [`under <table>: ${confirmed}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${control}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${confirmed.slice(0, 70)}`]);
  });
  it('keeps qualified Export results silent beside a data note', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Updated each morning, so late bookings appear tomorrow.';
    for (const result of [
      'The export of all selected bookings completed.',
      'The export has now completed for all selected bookings.',
      'The export successfully completed for all selected bookings.',
      'The export has been completed for all selected bookings.',
    ]) {
      const pure = `<div class="text-muted" role="status"><p>${result}</p><p>Ready.</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + pure, 'table-footnote'), []);
      assert.deepEqual(spans(`<h2>Reports</h2>${pure}${table}`, 'table-aside'), []);
      const withNote = `<div class="text-muted" role="status"><p>${result}</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + withNote, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${withNote}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('reports data restrictions whose completed word describes records', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const note of [
      'The export for this view excludes bookings not yet completed.',
      'The export for this view omits bookings not completed.',
      'The export for this view counts only jobs completed.',
      'The export for this view covers only tasks already completed.',
    ]) {
      const line = `<div class="text-muted" role="status"><p>Ready.</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note.slice(0, 70)}`]);
    }
    const control = 'The export for this view excludes bookings not yet confirmed.';
    const line = `<div class="text-muted" role="status"><p>Ready.</p><p>${control}</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${control}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${control.slice(0, 70)}`]);
    const mixed = '<div class="text-muted" role="status">Ready. The export <strong>for this view</strong> excludes <em>bookings not yet completed.</em><button>Export</button></div>';
    assert.deepEqual(spans(table + mixed, 'table-footnote'),
      ['under <table>: The export for this view excludes bookings not yet completed.']);
    assert.deepEqual(spans(`<h2>Reports</h2>${mixed}${table}`, 'table-aside'),
      ['beside <h2> "Reports" above <table>: The export for this view excludes bookings not yet completed.']);
  });
  it('keeps affirmative Export results silent beside a freshness note', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Bookings refresh overnight, so late cancellations appear tomorrow.';
    for (const result of [
      'The export completed successfully for all selected bookings.',
      'The export completed without errors for all selected bookings.',
      'The export completed at noon for all selected bookings.',
      'The export for all selected bookings is complete.',
      'The export of all selected bookings has finished.',
    ]) {
      const line = `<div class="text-muted" role="status"><p>${result}</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
      const pure = line.replace(note, 'Ready.');
      assert.deepEqual(spans(table + pure, 'table-footnote'), []);
      assert.deepEqual(spans(`<h2>Reports</h2>${pure}${table}`, 'table-aside'), []);
    }
    const numeric = '24 hours can pass before late bookings appear.';
    const mixed = `<div class="text-muted" role="status">The export <strong>completed successfully</strong> for all selected bookings. ${numeric}<button>Export</button></div>`;
    assert.deepEqual(spans(table + mixed, 'table-footnote'), [`under <table>: ${numeric}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${mixed}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${numeric}`]);
  });
  it('starts a data sentence at quoted lowercase and nested labels', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const note of [
      '“cancelled” bookings remain visible until the next morning.',
      '“‘Cancelled’ bookings remain visible until the next morning.”',
    ]) {
      for (const body of [
        `The export completed for all selected bookings. ${note}`,
        `<p>The export completed for all selected bookings.</p><p>${note}</p>`,
        `The export completed for all selected bookings. <strong>${note}</strong>`,
      ]) {
        const line = `<div class="text-muted" role="status">${body}<button>Export</button></div>`;
        assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
        assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
          [`beside <h2> "Reports" above <table>: ${note.slice(0, 70)}`]);
      }
    }
  });
  it('keeps a data sentence after nested live feedback on the same line', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = '24 hours can pass before late bookings appear.';
    for (const [inner, outer] of [
      ['role="status"', 'role="status"'],
      ['role="status"', ''],
      ['', 'role="status"'],
    ]) {
      const line = `<div class="text-muted" ${outer}><span ${inner}>The export completed for all selected bookings.</span> ${note}<button>Export</button></div>`;
      assert.deepEqual(spans(table + line, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${line}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('keeps short data clauses with completion words', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const note of [
      'The export for June lists bookings completed.',
      'The export for today shows payments completed.',
      'The export for today lists bookings from stays completed.',
      'The export for June includes bookings from stays completed.',
      'The export for bookings not yet completed.',
      'The export for bookings marked completed.',
    ]) {
      const wrapper = `<div class="text-muted" role="status"><p>Ready.</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note.slice(0, 70)}`]);
      const confirmed = wrapper.replace('completed.', 'confirmed.');
      assert.deepEqual(spans(table + confirmed, 'table-footnote'), [`under <table>: ${note.replace('completed.', 'confirmed.')}`]);
    }
  });
  it('accepts numeric, quoted, and longer export objects', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = '“cancelled” bookings remain visible until the next morning.';
    for (const result of [
      'The export for 12 bookings completed.',
      'The export of 24 bookings completed.',
      'The export for “cancelled” bookings completed.',
      'The export for all four selected bookings completed.',
      'The export of all four selected bookings completed.',
      'The export for all marked bookings completed.',
      'The export for “only” bookings completed.',
      'The export for only active bookings completed.',
      'The export for already settled bookings completed.',
      'The export for not yet paid bookings completed.',
      'The export for bookings marked as cancelled completed.',
    ]) {
      for (const content of [`<p>${result}</p>`, result]) {
        const wrapper = `<div class="text-muted" role="status">${content}<p>${note}</p><button>Export</button></div>`;
        assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
        assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
          [`beside <h2> "Reports" above <table>: ${note}`]);
        const onlyResult = `<div class="text-muted" role="status">${content}<p>Ready.</p><button>Export</button></div>`;
        assert.deepEqual(spans(table + onlyResult, 'table-footnote'), []);
        assert.deepEqual(spans(`<h2>Reports</h2>${onlyResult}${table}`, 'table-aside'), []);
      }
    }
  });
  it('keeps a live control result exempt when nearby text is outside its owner', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const status = '<span class="text-muted" role="status">Your file is ready to download.</span>';
    for (const outside of ['Ready.', 'Updated nightly, so yesterday stays open.']) {
      const marker = outside === 'Ready.' ? '' : ' class="text-muted"';
      const wrapper = `<div>${status} <span${marker}>${outside}</span><button>Export</button></div>`;
      const expected = outside === 'Ready.' ? [] : [`under <table>: ${outside}`];
      assert.deepEqual(spans(`<section>${table}${wrapper}</section>`, 'table-footnote'), expected);
      const aside = outside === 'Ready.' ? [] : [`beside <h2> "Reports" above <table>: ${outside}`];
      assert.deepEqual(spans(`<section><h2>Reports</h2>${wrapper}${table}</section>`, 'table-aside'), aside);
    }
  });
  it('keeps a separate note inside nested live markup', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const [inner, note] of [
      ['role="status"', '“cancelled” bookings remain visible until the next morning.'],
      ['aria-live="polite"', '24 hours can pass before late bookings appear.'],
    ]) {
      const wrapper = `<div class="text-muted" role="status">The export completed for all selected bookings. <span ${inner}>${note}</span><button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('keeps the full numeric note across nested and adjacent live spans', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = '24 hours can pass before late bookings appear.';
    for (const body of [
      '<span role="status">24 hours</span> can pass before late bookings appear.',
      '24 hours can <span aria-live="polite">pass before late</span> bookings appear.',
      '<span role="status">24 hours</span> <span aria-live="polite">can pass before</span> late bookings appear.',
    ]) {
      const wrapper = `<div class="text-muted" role="status">The export completed. ${body}<button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
    for (const body of [
      '<span role="status">24 hours</span> can pass before late bookings appear.',
      '24 hours can <span aria-live="polite">pass before late</span> bookings appear.',
      '<span role="status">24 hours</span> <span aria-live="polite">can pass before</span> late bookings appear.',
    ]) {
      const wrapper = `<div class="text-muted">${body}<button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('treats completion object nouns as nouns in both table positions', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Updated each morning, so late bookings appear tomorrow.';
    for (const result of [
      'The export of all booking counts completed.',
      'The export of 12 reports completed.',
      'The export of three lists completed.',
      'The export of three shows completed.',
      'The export for booking Will completed.',
      'The export of all booking reports about June completed.',
      'The export of all booking counts across teams completed.',
      'The export of all booking reports covering June completed.',
      'The export of all booking reports on bookings completed.',
      'The export of all booking reports covering bookings completed.',
      'The export of all booking reports detailed for June completed.',
    ]) {
      for (const text of ['Ready.', note]) {
        const wrapper = `<div class="text-muted" role="status"><p>${result}</p><p>${text}</p><button>Export</button></div>`;
        const expected = text === note ? [`under <table>: ${note}`] : [];
        assert.deepEqual(spans(table + wrapper, 'table-footnote'), expected);
        assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
          text === note ? [`beside <h2> "Reports" above <table>: ${note}`] : []);
      }
    }
  });
  it('reports record clauses with listed and alternate verbs', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    for (const verb of ['lists', 'counts', 'reports', 'shows', 'summarizes', 'records', 'details', 'groups', 'identifies', 'highlights']) {
      for (const ending of ['completed', 'confirmed']) {
        const note = `The export for June ${verb} all bookings ${ending}.`;
        const wrapper = `<div class="text-muted" role="status"><p>Ready.</p><p>${note}</p><button>Export</button></div>`;
        assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
        assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
          [`beside <h2> "Reports" above <table>: ${note}`]);
      }
    }
    for (const note of [
      'The export for June lists completed bookings completed.',
      'The export for June highlights cancelled bookings completed.',
      'The export for June reports on all bookings completed.',
      'The export for June reports on bookings completed.',
      'The export for June 2026 reports on all bookings completed.',
      'The export for June and July reports on all bookings completed.',
      'The export for Q2 reports on all bookings completed.',
      'The export for June detailed all bookings completed.',
      'The export for June lists pending bookings completed.',
    ]) {
      const wrapper = `<div class="text-muted" role="status"><p>Ready.</p><p>${note}</p><button>Export</button></div>`;
      assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
      assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
        [`beside <h2> "Reports" above <table>: ${note}`]);
    }
  });
  it('keeps abbreviations and decimals inside one note', { timeout: 1000 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const note = 'Updated nightly, e.g. 3.14 hours after close, so yesterday stays open.';
    const wrapper = `<div class="text-muted"><p>${note}</p><button>Export</button></div>`;
    assert.deepEqual(spans(table + wrapper, 'table-footnote'), [`under <table>: ${note}`]);
    assert.deepEqual(spans(`<h2>Reports</h2>${wrapper}${table}`, 'table-aside'),
      [`beside <h2> "Reports" above <table>: ${note.slice(0, 70)}`]);
  });
  it('scans repeated groups in one live sentence with bounded growth', { timeout: 2500 }, () => {
    const table = '<table><tr><td>12</td></tr></table>';
    const group = '<small>all bookings selected in this table every morning</small> and ';
    const scanGroups = (count, live = true) => {
      const wrapper = `<div${live ? ' role="status"' : ''}>Export for ${group.repeat(count)}records remain pending.<p>Ready.</p><button>Export</button></div>`;
      const start = performance.now();
      const findings = detect(table + wrapper, { level: 1, kind: 'artifact', ext: 'html' }).findings;
      assert.ok(findings.some((finding) => finding.rule === 'table-footnote'));
      return performance.now() - start;
    };
    scanGroups(100);
    const sizes = [500, 1000, 2000, 4000];
    const durations = sizes.map((size) => scanGroups(size));
    scanGroups(4000, false);
    assert.ok(durations.at(-1) <= durations[0] * 12 + 120,
      `Repeated live groups grew too fast: ${JSON.stringify({ sizes, durations })}`);
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
    const source = '<button>' + '<div>'.repeat(18000) + 'Open settings' + '</div>'.repeat(18000) + '</button>';
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
