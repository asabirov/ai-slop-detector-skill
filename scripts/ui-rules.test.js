'use strict';

const { describe, it } = require('./lib/budget');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { detect, kindForPath } = require('./detect');

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
    assert.ok(durations.at(-1) <= durations[0] * 5 + 120,
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
});
