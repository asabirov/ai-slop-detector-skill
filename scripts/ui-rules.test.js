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
      has(fs.readFileSync(path.join(fixtures, `slop-ui-${rule}.html`), 'utf8'), rule);
    });
  }
  for (const file of fs.readdirSync(fixtures).filter((name) => name.startsWith('clean.'))) {
    it(`${file} stays silent at paranoid`, { timeout: 1000 }, () => {
      assert.deepEqual(scan(fs.readFileSync(path.join(fixtures, file), 'utf8'), file).findings, []);
    });
  }

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


// Each case is markup that shipped. The two that fire are finance2's at
// `0d21703c`, the screens #52 names; the silent ones are what a draft reading any
// short subordinate line reported over 2,285 real HTML files, and why the rule
// needs a sentence on that path.
describe('table-aside', { timeout: 1000 }, () => {
  const table = '<div class="ui-table-scroll"><table><tbody><tr><td>12</td></tr></tbody></table></div>';

  it('fires on a basis-named line beside the heading', { timeout: 500 }, () => {
    has(`<section><div class="fin-section__head"><h2>Revenue per unit</h2><span class="fin-basis">charge month</span></div>${table}</section>`, 'table-aside');
  });
  it('fires on a group subtitle beside the heading', { timeout: 500 }, () => {
    has(`<section><div class="fin-tasks__head"><h2>Overdue or blocking</h2><p class="fin-small">Past due, or holding up a month close.</p></div>${table}</section>`, 'table-aside');
  });
  it('stays silent on a count or a unit beside the heading', { timeout: 500 }, () => {
    lacks(`<section><h2 class="panel-title">Service inventory</h2><span class="panel-meta">11 services · 5 regions</span>${table}</section>`, 'table-aside');
    lacks(`<section><h2 class="panel-title">Throughput by service</h2><span class="panel-meta">req/s · 15m avg</span>${table}</section>`, 'table-aside');
  });
  it('stays silent under an h1, which names the page', { timeout: 500 }, () => {
    lacks(`<body><h1>More work. Less waste.</h1><p class="subtitle">August cloud spend fell 6.4% while completed jobs grew 12%.</p>${table}</body>`, 'table-aside');
  });
  it('stays silent on a link beside the heading', { timeout: 500 }, () => {
    lacks(`<section><div class="head"><h2>Sources</h2><a class="meta-link" href="/sources">See every source and when it was read.</a></div>${table}</section>`, 'table-aside');
  });
  it('fires on an "as of" line with no marker on it', { timeout: 500 }, () => {
    has(`<section><h2>Spend per unit</h2><p>Figures as of the last completed month close.</p>${table}</section>`, 'table-aside');
  });
  it('stays silent on a unit or a status in a <small>', { timeout: 500 }, () => {
    lacks(`<section><div class="head"><h2>Spend</h2><span class="total">12,400 <small>EUR</small></span></div>${table}</section>`, 'table-aside');
    lacks(`<section><h2>Latency</h2><small>ms, p95</small><div class="chart"><svg></svg></div></section>`, 'table-aside');
  });
  it('stays inside its own grid column or table cell', { timeout: 500 }, () => {
    lacks(`<div class="row"><div class="col-md-4"><h2>About the club</h2><p class="lead">We have met every Tuesday since 1987.</p></div><div class="col-md-8">${table}</div></div>`, 'table-aside');
    lacks(`<table role="presentation"><tr><td><h2>Your order</h2><p class="small">Thanks for shopping with us.</p></td><td>${table}</td></tr></table>`, 'table-aside');
  });
  it('stays silent on a count line, a caption and a byline', { timeout: 500 }, () => {
    lacks(`<section><h2>Entries</h2><p class="meta">Showing 1 to 10 of 57 entries.</p>${table}</section>`, 'table-aside');
    lacks('<section><h2>Rainfall</h2><p class="caption">Figure 3. Rainfall by station, 2025.</p><div class="chart"><svg></svg></div></section>', 'table-aside');
    lacks(`<article><h2 class="entry-title">Results of the 2026 survey</h2><div class="entry-meta">Posted by Dana on 1 Oct 2026.</div><div class="entry-content">${table}</div></article>`, 'table-aside');
  });
  it('stays silent on a list, which is content', { timeout: 500 }, () => {
    lacks(`<section><h2>Changelog</h2><ul class="release-notes"><li>Fixed export</li><li>Added filters</li></ul>${table}</section>`, 'table-aside');
  });
  it('stays silent on prose the design did not set subordinate', { timeout: 500 }, () => {
    lacks(`<section><h2>Rainfall by month</h2><p>The observer recorded a clear morning.</p>${table}</section>`, 'table-aside');
  });
  it('stays silent when the data is not the next thing', { timeout: 500 }, () => {
    lacks('<section><div class="head"><h2>Payouts</h2><p class="sub">Reconciled to bank transactions.</p></div><div class="body"><div class="seg"><button>All</button></div>' + table + '</div></section>', 'table-aside');
  });
});

describe('UI scan bounds', { timeout: 3000 }, () => {
  it('scans 2500 nodes with inline styles within the budget', { timeout: 2500 }, () => {
    const source = '<main>' + '<p style="color:#333">Station record</p>'.repeat(2500) + '</main>';
    assert.deepEqual(scan(source).findings, []);
  });
  it('scans 200KB brace-free CSS within the budget', { timeout: 2500 }, () => {
    assert.deepEqual(scan('.unclosed-selector '.repeat(11000), 'sample.css').findings, []);
  });
  // A note wrapped in 15,000 divs is not a line. `table-aside` reads each of a
  // candidate's lines separately, which is quadratic in its subtree, so the bound
  // that keeps this silent is the same bound that keeps it inside the budget.
  it('treats a deeply wrapped line beside a heading as content, inside the budget', { timeout: 2500 }, () => {
    const deep = '<div>'.repeat(15000) + 'Nested note here.' + '</div>'.repeat(15000);
    const source = `<section><div class="head"><h2>Deep</h2><div class="sub">${deep}</div></div><table><tbody><tr><td>1</td></tr></tbody></table></section>`;
    assert.deepEqual(scan(source).findings.map((f) => f.rule), []);
  });
});
