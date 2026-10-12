'use strict';

// Dependency-free HTML/CSS parsing helpers for the slop detector.
// This is not a DOM. The checks are heuristic tells, and the linter runs
// without a browser or package installation.

// A quoted closing spelling is attribute data. Only complete tag tokens can
// end a hidden range, and an unfinished hidden element runs to the file end.
function stripBetween(html, tag) {
  const ranges = [];
  let depth = 0;
  let start = 0;
  for (const token of rawHtmlTokens(html)) {
    if (token.type !== 'tag' || token.name !== tag) continue;
    if (token.closing) {
      if (depth && --depth === 0) ranges.push({ start, end: token.end });
    } else if (!token.selfClosing) {
      if (!depth) start = token.index;
      depth++;
    }
  }
  if (depth) ranges.push({ start, end: html.length });
  const pieces = [];
  let copied = 0;
  for (const range of ranges) {
    pieces.push(html.slice(copied, range.start), ' ');
    copied = range.end;
  }
  pieces.push(html.slice(copied));
  return pieces.join('');
}

// Visible text as it roughly renders, one run per element-ish boundary.
// Tags out, one space in. The space is the whole point: replacing a tag with the
// empty string lets `<<a>b>` close back up into `<b>`, which is
// `js/incomplete-multi-character-sanitization` and was raised three times against
// `scripts/rules/visual.js` (apliteni/claude-apliteni-plugin#79). A space between
// the halves cannot be reconstructed into a tag by anything that is left.
//
// Eight places did this by hand, five with a space and three with the empty
// string, which is exactly the split CodeQL flagged. One function now.
function stripTags(html) {
  const pieces = [];
  let copied = 0;
  for (const token of rawHtmlTokens(html)) {
    pieces.push(html.slice(copied, token.index), ' ');
    copied = token.end;
  }
  pieces.push(html.slice(copied));
  return pieces.join('');
}

// Every stream a rule reads as text decodes its character entities, because a
// name is a spelling and the reader is shown a glyph. The table is the standard's
// own, in `./entities`.
const { NAMED } = require('./entities');

// Case matters: `&Aacute;` and `&aacute;` are different letters, so the name is
// looked up exactly as written. The hex digits of a numeric reference do not,
// and neither does its `x`.
const ENTITY = /&(?:#[xX]([0-9a-fA-F]+)|#(\d+)|([A-Za-z][A-Za-z0-9]*));/g;

// Past the last code point Unicode has, `String.fromCodePoint` throws; inside the
// surrogate range it returns half a character, which breaks the next thing that
// reads the string. Neither is a character a reader sees, so both stay written.
const decodable = (code) => code >= 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);

// HTML replaces these numeric C1 references with the glyphs a browser shows.
// Zero means the control has no replacement in the HTML numeric-reference table.
const C1_REPLACEMENTS = [
  0x20ac, 0, 0x201a, 0x0192, 0x201e, 0x2026, 0x2020, 0x2021,
  0x02c6, 0x2030, 0x0160, 0x2039, 0x0152, 0, 0x017d, 0,
  0, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x02dc, 0x2122, 0x0161, 0x203a, 0x0153, 0, 0x017e, 0x0178,
];

// Called only on text whose tags, or whose markdown syntax, are already gone, and
// it runs last, so nothing reads what it produced. That order is the point twice
// over: a `&lt;` decoded while tags are still being matched would hand the next
// pass a `<` it could close into a tag, and a `&#35;` decoded before the markdown
// syntax is stripped would be read as a heading marker.
//
// `blankUnknown` is the whole-page prose stream's old behaviour, folded in rather
// than run as a second pass over the result. As a second pass it ate the name a
// numeric ampersand had just produced: `&#38;middot;` is the text `&middot;` on
// the page, and the stream reported nothing at all.
function decodeEntities(text, { blankUnknown = false, markdownEscapes = false } = {}) {
  return text.replace(ENTITY, (whole, hex, dec, name, offset) => {
    if (markdownEscapes) {
      let slashes = 0;
      while (text[offset - slashes - 1] === '\\') slashes++;
      if (slashes % 2) return whole;
      // CommonMark limits decimal references to seven digits and hex to six.
      if ((hex !== undefined && hex.length > 6) || (dec !== undefined && dec.length > 7)) return whole;
    }
    if (name !== undefined) {
      const glyph = NAMED[name];
      if (glyph !== undefined) return glyph;
      return blankUnknown ? ' ' : whole;
    }
    const code = hex !== undefined ? parseInt(hex, 16) : Number(dec);
    if (!decodable(code)) return whole;
    return String.fromCodePoint(C1_REPLACEMENTS[code - 0x80] || code);
  });
}

// Keep inline markup inside a text run. Split definition labels and values, and
// split at a line break. The earlier broad split hid chains containing SVG icons
// and labels. This is a text approximation, not a DOM or CSS layout calculation.
const BLOCK_ELEMENT = /^<\/?(?:p|div|h[1-6]|span|li|td|th|section|header|footer|text|a|dl|dt|dd|br)(?=[\s/>])/i;
const NON_MARKUP_BOUNDARY = /^<\/?(?:p|div|h[1-6]|span|li|td|th|section|header|footer|text|a)(?=[\s/>])/i;

function visibleTextRuns(html, { markup = true } = {}) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const boundary = markup ? BLOCK_ELEMENT : NON_MARKUP_BOUNDARY;
  const out = [];
  let copied = 0;
  const addRun = (end) => {
    const t = decodeEntities(stripTags(body.slice(copied, end)), { markdownEscapes: !markup })
      .replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  };
  for (const token of rawHtmlTokens(body)) {
    if (token.type !== 'tag' || !boundary.test(token.text)) continue;
    addRun(token.index);
    copied = token.end;
  }
  addRun(body.length);
  return out;
}

// Prose a reader meets that is not between tags: tooltips, labels, alt text,
// the meta description. Stripping tags with `<[^>]+>` deletes these along with
// the tag, so every text rule was blind to them — on lessly.com/pricing that
// was 274 of the page's 934 words, the whole compare table's prose, sitting
// inside `data-tip` (lessly-landing#387).
//
// Only attributes whose value is written for a person. `href`, `class`, `src`,
// `id` and friends are addresses and identifiers; reading them as prose would
// hand every rule a stream of slugs.
const PROSE_ATTRS = new Set(['title', 'alt', 'placeholder', 'aria-label',
  'aria-description', 'aria-placeholder', 'aria-roledescription',
  'data-tip', 'data-tooltip', 'data-title']);

function tagAttributes(tag) {
  const attrs = [];
  let offset = 1;
  if (tag[offset] === '/') return attrs;
  while (offset < tag.length && !/[\s/>]/.test(tag[offset])) offset++;
  while (offset < tag.length) {
    while (/[\s/]/.test(tag[offset] || '')) offset++;
    if (!tag[offset] || tag[offset] === '>') break;
    const start = offset;
    while (offset < tag.length && !/[\s=/>]/.test(tag[offset])) offset++;
    if (offset === start) { offset++; continue; }
    const name = tag.slice(start, offset).toLowerCase();
    while (/\s/.test(tag[offset] || '')) offset++;
    if (tag[offset] !== '=') { attrs.push([name, null]); continue; }
    offset++;
    while (/\s/.test(tag[offset] || '')) offset++;
    let value = '';
    const quote = tag[offset] === '"' || tag[offset] === "'" ? tag[offset++] : null;
    if (quote) {
      const end = tag.indexOf(quote, offset);
      value = tag.slice(offset, end === -1 ? tag.length : end);
      offset = end === -1 ? tag.length : end + 1;
    } else {
      const startValue = offset;
      while (offset < tag.length && !/[\s>]/.test(tag[offset])) offset++;
      value = tag.slice(startValue, offset);
    }
    attrs.push([name, value]);
  }
  return attrs;
}

// One run per human-readable attribute value, longest first is not needed —
// order follows the document, same as visibleTextRuns.
function attrTextRuns(html, tokens = rawHtmlTokens(html)) {
  const out = [];
  for (const token of tokens) {
    if (token.type !== 'tag' || /^<\/(?:script|style|code|pre)\b/i.test(token.text)) continue;
    const tag = /^<([a-z][a-z0-9-]*)/i.exec(token.text)?.[1].toLowerCase();
    if (!tag || ['script', 'style', 'code', 'pre'].includes(tag)) continue;
    const attrs = tagAttributes(token.text);
    const metaName = tag === 'meta' ? attrs.find(([name]) => name === 'name')?.[1] : null;
    for (const [name, value] of attrs) {
      if (!PROSE_ATTRS.has(name) && !(tag === 'meta' && name === 'content' &&
        ['description', 'og:description', 'twitter:description'].includes(metaName))) continue;
      const text = decodeEntities(value || '').replace(/\s+/g, ' ').trim();
      // A one-word label ("Close", "Menu") is a control name, not prose.
      if (text && /\s/.test(text)) out.push(text);
    }
  }
  return out;
}

// Which classes, ids and tags the markup actually carries. A stylesheet is
// shared by every page that links it, so a rule naming a selector no page
// element matches is not that page's defect. lessly.com's home page failed the
// level-1 gate on `.font-mono` (markdown code blocks) and `.fig-mono` (numerals
// inside diagrams): neither appears in its markup, both live in the one
// stylesheet (lessly-hub/lessly-landing#390).
function markupTokens(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const classes = new Set();
  const ids = new Set();
  const tags = new Set();
  for (const token of rawHtmlTokens(body)) {
    if (token.type !== 'tag' || token.closing) continue;
    tags.add(token.name);
    for (const [name, value] of tagAttributes(token.text)) {
      if (name === 'class' || name === 'classname') {
        for (const c of (value || '').split(/\s+/)) if (c) classes.add(c);
      }
      if (name === 'id' && value?.trim()) ids.add(value.trim());
    }
  }
  return { classes, ids, tags };
}

// Elements whose font is code's font by right: mono on them, or on anything
// they contain, is typography doing its job rather than costume.
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'tt']);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Every element the page carries, each with the tag chain above it. This is
// not a DOM, but a stack of tokenized tags is enough to answer the one
// question the mono rule needs: what does this selector land on, and does that
// element sit inside a <code>. `inCode` is true for the code elements
// themselves and for everything nested in one, because font-family inherits:
// <code><input></code> puts mono on the input, legitimately.
//
// Mis-nested markup (an unclosed <code>) inflates the chain. That errs toward
// calling something code, which is the quiet direction; a page whose <code>
// never closes has a bigger problem than this rule.
function markupElements(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const out = [];
  const stack = []; // open elements, innermost last
  const openDepths = new Map();
  let previousEnd = 0;
  const appendRun = (end) => {
    if (stack.length) {
      const run = body.slice(previousEnd, end);
      out[stack[stack.length - 1]].text += run;
      out[stack[stack.length - 1]].chunks.push([previousEnd, run]);
    }
  };
  for (const token of rawHtmlTokens(body)) {
    appendRun(token.index);
    previousEnd = token.end;
    if (token.type !== 'tag') continue;
    const tag = token.name;
    if (token.closing) {
      const depth = openDepths.get(tag)?.at(-1);
      if (depth !== undefined) {
        while (stack.length > depth) {
          const opened = out[stack.pop()].tag;
          openDepths.get(opened).pop();
        }
      }
      continue;
    }
    const attrs = tagAttributes(token.text);
    const attribute = (name) => attrs.find(([key]) => key === name)?.[1] || '';
    const classValue = attribute('class') || attribute('classname');
    const parent = stack.length ? stack[stack.length - 1] : -1;
    const el = {
      tag,
      classes: new Set(classValue.trim().split(/\s+/).filter(Boolean)),
      id: attribute('id').trim() || null,
      parent,
      text: '',
      // `text` loses order: a run belongs to the innermost open element, so
      // `<p><strong>Amounts</strong> in EUR.</p>` gives the <p> " in EUR." and
      // the <strong> "Amounts", and joining parent before child reads them
      // backwards. `chunks` keeps each run's position in the document so a
      // subtree can be read in the order a person reads it.
      chunks: [],
      style: decodeEntities(attribute('style')),
      inTable: tag === 'td' || tag === 'th' || (parent >= 0 && out[parent].inTable),
      inCode: CODE_TAGS.has(tag) || (parent >= 0 && out[parent].inCode),
    };
    out.push(el);
    if (!VOID_TAGS.has(tag) && !token.selfClosing) {
      if (!openDepths.has(tag)) openDepths.set(tag, []);
      openDepths.get(tag).push(stack.length);
      stack.push(out.length - 1);
    }
  }
  appendRun(body.length);
  for (const el of out) {
    el.text = decodeEntities(el.text);
    for (const chunk of el.chunks) chunk[1] = decodeEntities(chunk[1]);
    el.numericData = /^[\s\d.,+−–—%$€£¥()/: -]*$/.test(el.text);
    el.hasDigit = /\d/.test(el.text);
  }
  for (let i = out.length - 1; i >= 0; i--) {
    const el = out[i];
    if (el.parent >= 0) {
      out[el.parent].numericData &&= el.numericData;
      out[el.parent].hasDigit ||= el.hasDigit;
    }
  }
  return out;
}

// One compound of a selector — `div.a#b` — reduced to what we can check.
function parseCompound(part) {
  const tag = /^[a-z][a-z0-9-]*/i.exec(part);
  return {
    tag: tag ? tag[0].toLowerCase() : null,
    classes: (part.match(/\.[-_a-z0-9]+/gi) || []).map((c) => c.slice(1)),
    id: (/#([-_a-z0-9]+)/i.exec(part) || [])[1] || null,
  };
}

function compoundMatches(c, el) {
  if (c.tag && c.tag !== '*' && c.tag !== el.tag) return false;
  for (const cls of c.classes) if (!el.classes.has(cls)) return false;
  if (c.id && c.id !== el.id) return false;
  return true;
}

// Which elements does this selector land on? Returns null — not [] — when the
// selector cannot be resolved: it names nothing this parser can point at
// (`*`, `:root`, a bare attribute selector), or it matches no element on the
// page. Null means "cannot see", and the caller must fall back rather than
// treat silence as a verdict.
//
// Combinators are all read as "descendant". `>` is a descendant, so that is
// only loose; `+` and `~` are not, so a sibling selector resolves to fewer
// elements than it really matches, or to none at all — and none means the
// caller falls back. Erring toward too few keeps this from inventing hits.
function selectorTargets(selector, elements) {
  if (!elements || !elements.length) return null;
  const hits = [];
  const seen = new Set();
  let resolvable = false;

  for (const one of selector.split(',')) {
    const clean = one
      .replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ') // pseudo-classes and elements
      .replace(/\[[^\]]*\]/g, ' ') // attribute selectors
      .replace(/[>+~]/g, ' ')
      .trim();
    if (!clean) continue;
    const compounds = clean.split(/\s+/).map(parseCompound);
    const key = compounds[compounds.length - 1];
    if (!key.tag && !key.classes.length && !key.id) continue; // nothing to point at
    resolvable = true;
    const ancestors = compounds.slice(0, -1);

    for (let i = 0; i < elements.length; i++) {
      if (!compoundMatches(key, elements[i])) continue;
      // Walk up once, consuming the ancestor compounds innermost-first.
      let need = ancestors.length - 1;
      for (let p = elements[i].parent; p >= 0 && need >= 0; p = elements[p].parent) {
        if (compoundMatches(ancestors[need], elements[p])) need--;
      }
      if (need >= 0) continue;
      if (seen.has(i)) continue;
      seen.add(i);
      hits.push(elements[i]);
    }
  }
  if (!resolvable || !hits.length) return null;
  return hits;
}

// Does this page apply this selector? Conservative on purpose: unknown means
// yes. A selector naming no class, id or tag we can read (`*`, `:root`, an
// attribute selector) is treated as applied, so a rule keeps firing wherever
// this cannot answer.
function selectorApplies(selector, tokens) {
  if (!tokens) return true;
  const clean = selector
    .replace(/::?[a-z-]+(\([^)]*\))?/gi, ' ') // pseudo-classes and elements
    .replace(/\[[^\]]*\]/g, ' '); // attribute selectors
  const classes = clean.match(/\.[-_a-z0-9]+/gi) || [];
  const ids = clean.match(/#[-_a-z0-9]+/gi) || [];
  for (const c of classes) if (!tokens.classes.has(c.slice(1))) return false;
  for (const i of ids) if (!tokens.ids.has(i.slice(1))) return false;
  // A bare tag name only counts when the selector names nothing else.
  if (!classes.length && !ids.length) {
    const tags = clean.match(/(^|[\s>+~])([a-z][a-z0-9-]*)/gi) || [];
    const named = tags.map((t) => t.trim().replace(/^[>+~]\s*/, '').toLowerCase()).filter(Boolean);
    if (named.length && named.every((t) => !tokens.tags.has(t))) return false;
  }
  return true;
}

// Elements whose next sibling is a heading — the shape of a kicker. Regex, not
// a DOM: an element, then whitespace or a comment, then an <h1>-<h6>.
//
// `eyebrow-kicker` used to read declaration blocks alone, so it reported a CSS
// signature for any uppercase rule in the sheet. That cleared lessly.com, which
// carries five kickers, and flagged status.lessly.com, whose only uppercase rule
// styles the status badge sitting *beside* each <h3> (apliteni#73). A kicker is
// defined by where it sits, so the rule has to look at the page.
const LABEL_TAGS = 'p|span|div|small|strong|em|b|a|figcaption';

// Every `[\s\S]*?` here is bounded, and that is not tidiness. Unbounded, the
// engine expands each label body to every later closing tag in the document
// before giving up on a start position: 181KB of short paragraphs went from 8ms
// to 4,980ms. A kicker's text is capped at KICKER_MAX_CHARS once tags are
// stripped, so 300 raw characters is already generous for either end.
const SPAN_MAX = 300;
const COMMENT_MAX = 500;

function labelsAboveHeadings(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const out = [];
  const re = new RegExp(
    `<(${LABEL_TAGS})\\b([^>]*)>([\\s\\S]{0,${SPAN_MAX}}?)</\\1>` +
      `\\s*(?:<!--[\\s\\S]{0,${COMMENT_MAX}}?-->\\s*){0,5}` +
      `<(h[1-6])\\b[^>]*>([\\s\\S]{0,${SPAN_MAX}}?)</\\4>`,
    'gi'
  );
  let m;
  while ((m = re.exec(body)) !== null) {
    const attrs = m[2];
    const cls = (/\bclass\s*=\s*"([^"]*)"/i.exec(attrs) || [, ''])[1].split(/\s+/).filter(Boolean);
    const style = (/\bstyle\s*=\s*"([^"]*)"/i.exec(attrs) || [, ''])[1];
    out.push({
      tag: m[1].toLowerCase(),
      classes: cls,
      style,
      text: decodeEntities(stripTags(m[3])).replace(/\s+/g, ' ').trim(),
      heading: decodeEntities(stripTags(m[5])).replace(/\s+/g, ' ').trim(),
    });
  }
  return out;
}

// A footnote is defined by where it sits, so the rule that judges one has to
// read the page, the way `labelsAboveHeadings` does for kickers. Document order
// plus each element's parent is enough: every element between one child and the
// next is the first one's subtree, so the block above an element is the run
// from its previous sibling up to it.

// A table by tag, and a chart by tag or by a class that says so. The tag is
// matched as a word ending because a screen ships a component, not a <table>:
// finance2 renders <DataTable/> and the draft of this rule that could only see
// `table` missed the one line #40 was filed about.
//
// `table` is deliberately absent from the class test. `.table-wrap` and
// `.table-note` would both match it, and the note is the thing being judged.
const DATA_TAG = /(?:table|chart|graph|plot|sparkline)s?$/i;
const CHART_CLASS = /(?:^|[-_])(?:chart|graph|plot|sparkline)s?(?:$|[-_\d])/i;

// Text a reader operates rather than reads. Their words come out before the
// candidate is measured, so a pager reading "Previous Page 2 of 5 Next Export"
// is four words of prose and a note beside an Export button is still a note.
const MUTE_TAGS = new Set(['button', 'input', 'select', 'textarea', 'a']);

// A wrapper that is a section of the page is not the data: what follows it
// starts something new rather than annotating it.
const SECTION_TAGS = new Set(['section', 'nav', 'article', 'aside', 'main', 'header', 'footer', 'form']);

function isDataBlock(el) {
  return DATA_TAG.test(el.tag) || [...el.classes].some((c) => CHART_CLASS.test(c));
}

// The data an element sits under: the previous sibling, or a plain wrapper whose
// last child is one — `<div class="table-wrap"><table>…</table></div>` is how a
// table usually ships. Last child, not anywhere inside: an article body holding
// a table in the middle and two paragraphs after it is not a table, and reading
// the whole subtree made every `<div class="post-meta">` after one a footnote.
// Walking the last-child chain also costs the depth rather than the subtree.
function dataAbove(elements, lastChildOf, from) {
  if (SECTION_TAGS.has(elements[from].tag)) return null;
  for (let j = from; j !== undefined; j = lastChildOf.get(j)) {
    if (isDataBlock(elements[j])) return elements[j];
  }
  return null;
}

// Every element sitting directly under a table or a chart, with the prose it
// renders and what its subtree holds. A JSX expression is not prose: `{rows.map(
// (r) => …)}` reaches this as text, and a brace run comes out before the words
// are counted.
function blocksUnderData(elements) {
  const out = [];
  if (!elements) return out;
  // One map answers both questions asked of it. Read before the write it is the
  // previous sibling of the element in hand; read for an element whose subtree
  // is already behind us it is that element's last child.
  const lastChildOf = new Map();
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i];
    const sibling = lastChildOf.get(el.parent);
    lastChildOf.set(el.parent, i);
    if (sibling === undefined || isDataBlock(el) || SECTION_TAGS.has(el.tag)) continue;
    const above = dataAbove(elements, lastChildOf, sibling);
    if (!above) continue;

    const chunks = el.chunks.slice();
    // The candidate and everything prose-bearing under it. A note is often
    // wrapped: `<table/><div><p class="text-muted">…</p></div>` sets the note on
    // the <p>, and reading only the <div> saw no marker at all.
    const inside = [el];
    const muted = new Set();
    let heading = false;
    let data = false;
    for (let k = i + 1; k < elements.length; k++) {
      let parent = elements[k].parent;
      while (parent > i) parent = elements[parent].parent;
      if (parent !== i) break;
      const child = elements[k];
      if (/^h[1-6]$/.test(child.tag)) heading = true;
      if (isDataBlock(child)) data = true;
      if (MUTE_TAGS.has(child.tag) || muted.has(child.parent)) {
        muted.add(k);
        continue;
      }
      inside.push(child);
      chunks.push(...child.chunks);
    }
    const text = chunks
      .sort((a, b) => a[0] - b[0])
      .map((chunk) => chunk[1])
      // A space between runs, for the reason `stripTags` puts one there: without
      // it `</summary>Amounts` is one word to anything that counts words.
      .join(' ')
      .replace(/\{[^{}]*\}/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    out.push({ el, above, text, heading, data, inside, parent: elements[el.parent] || null });
  }
  return out;
}

// The data a heading names, read forwards: the next sibling, or a plain wrapper
// whose first child is one — `<div class="ui-table-scroll"><table>…</table></div>`
// is how a table ships inside a scroll region, and finance2's own `TableRegion`
// renders exactly that. First child, the mirror of `dataAbove`'s last child, and
// for the same reason: a page body whose first block is a row of controls and
// whose fourth is a table is not this heading's table.
function dataBelow(elements, firstChildOf, from) {
  if (SECTION_TAGS.has(elements[from].tag)) return null;
  for (let j = from; j !== undefined; j = firstChildOf.get(j)) {
    if (isDataBlock(elements[j])) return elements[j];
  }
  return null;
}

// At most two lines sit between a heading and the data it names. A third is the
// body prose of an article that happens to hold a table, not an annotation.
const ASIDE_MAX = 2;

// A list is content, not a line about the data, and `<ul class="release-notes">`
// otherwise reads as a note on its class alone.
const LIST_TAGS = new Set(['ul', 'ol', 'dl', 'li', 'dt', 'dd']);

// The one wrapper the walk will leave: a row that says it holds a heading.
// Leaving any wrapper read the next grid column's or the next table cell's table
// as this heading's own — `<div class="col-md-4"><h2/><p class="lead"/></div>
// <div class="col-md-8"><table/></div>` is a two-column page, not an annotated
// table, and an HTML email puts each in its own `<td>`. Every real shape that
// needs the climb names itself: finance2 ships `fin-section__head` and
// `fin-tasks__head`, and the kit card and the design-evidence page need no climb
// at all, because their table is already the heading's own sibling.
const HEAD_ROW_CLASS = /(?:^|[-_])(?:head|header|heading|hd|title)(?:$|[-_\d])/i;

// Index just past each element's subtree, so "is k inside i" is one comparison
// instead of a climb up k's parent chain. The climb is quadratic in depth, and on
// 15,000 nested divs it cost more than the rest of the rule put together.
function subtreeEnds(elements) {
  const ends = new Array(elements.length).fill(0);
  for (let i = elements.length - 1; i >= 0; i--) {
    if (ends[i] < i + 1) ends[i] = i + 1;
    const p = elements[i].parent;
    if (p >= 0 && ends[p] < ends[i]) ends[p] = ends[i];
  }
  return ends;
}

// Every line set between a heading and the data that heading names, with the
// prose it renders. The shape that ships puts the heading and the line in one
// head row — `<div class="head"><h2>…</h2><span class="basis">…</span></div>`
// followed by the table — so the walk leaves a named head row when it runs out of
// siblings, and nothing else.
function blocksBesideHeading(elements) {
  const out = [];
  if (!elements) return out;
  const childrenOf = new Map();
  const firstChildOf = new Map();
  // Where each element sits among its siblings, so a walk does not scan the
  // sibling list for the element it is already holding.
  const seatOf = new Map();
  for (let i = 0; i < elements.length; i++) {
    const p = elements[i].parent;
    if (!childrenOf.has(p)) childrenOf.set(p, []);
    seatOf.set(i, childrenOf.get(p).push(i) - 1);
    if (!firstChildOf.has(p)) firstChildOf.set(p, i);
  }
  const ends = subtreeEnds(elements);
  for (let h = 0; h < elements.length; h++) {
    // <h1> names the page, not the table: a report's own subtitle and byline sit
    // under one with its first table after them, and neither is beside the data.
    if (!/^h[2-6]$/.test(elements[h].tag)) continue;
    const siblings = childrenOf.get(elements[h].parent) || [];
    const tail = [];
    let data = null;
    for (let s = seatOf.get(h) + 1; s < siblings.length; s++) {
      const j = siblings[s];
      if (/^h[1-6]$/.test(elements[j].tag)) break;
      data = dataBelow(elements, firstChildOf, j);
      if (data) break;
      // A link or a button beside a heading is a control, not a line about the
      // data — and a `<a class="meta-link">See every source…</a>` reads as a note
      // to anything looking only at the class.
      if (!MUTE_TAGS.has(elements[j].tag)) tail.push(j);
      if (tail.length > ASIDE_MAX) break;
    }
    // Out of siblings inside a head row: the data is the row's next sibling.
    if (!data) {
      const wrap = elements[h].parent;
      if (wrap >= 0 && [...elements[wrap].classes].some((c) => HEAD_ROW_CLASS.test(c))) {
        const up = childrenOf.get(elements[wrap].parent) || [];
        const after = up[seatOf.get(wrap) + 1];
        if (after !== undefined) data = dataBelow(elements, firstChildOf, after);
      }
    }
    if (!data || !tail.length || tail.length > ASIDE_MAX) continue;
    const heading = { tag: elements[h].tag, text: subtreeText(elements, ends, h) };
    for (const j of tail) out.push(asideCandidate(elements, ends, j, heading, data));
  }
  return out;
}

// An element's own prose plus its descendants', in the order a person reads it.
// `text` on one element leaves a nested run out: `<h2>Revenue <b>per unit</b></h2>`
// gives the <h2> "Revenue " and the <b> "per unit".
function subtreeText(elements, ends, i) {
  const chunks = [];
  for (let k = i; k < ends[i]; k++) chunks.push(...elements[k].chunks);
  return orderedText(chunks);
}

// Chunks joined in document order, with a space between runs for the reason
// `stripTags` puts one there, and a brace run — a JSX expression — taken out.
function orderedText(chunks) {
  return chunks
    .sort((a, b) => a[0] - b[0])
    .map((chunk) => chunk[1])
    .join(' ')
    .replace(/\{[^{}]*\}/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// A line about the data is a line. Past this many elements it is a block of
// content, and reading each of its lines separately is quadratic in the subtree:
// a candidate wrapping 15,000 nested divs took 79 seconds before this bound.
const ASIDE_MAX_NODES = 40;

// One candidate: the element and everything prose-bearing under it, each with its
// own text, because the line carrying the marker is the line to measure and to
// report. `<span class="total">12,400 <small>EUR</small></span>` is a total with
// its unit, and reading the pair as one two-word note fired on `EUR`. Words a
// reader operates rather than reads come out, and so does a brace run.
function asideCandidate(elements, ends, i, heading, data) {
  const kept = [];
  const muted = new Set();
  let nested = LIST_TAGS.has(elements[i].tag) || ends[i] - i > ASIDE_MAX_NODES;
  const stop = Math.min(ends[i], i + ASIDE_MAX_NODES + 1);
  for (let k = i; k < stop; k++) {
    const child = elements[k];
    if (k > i) {
      if (/^h[1-6]$/.test(child.tag) || isDataBlock(child) || LIST_TAGS.has(child.tag)) nested = true;
      if (MUTE_TAGS.has(child.tag) || muted.has(child.parent)) {
        muted.add(k);
        continue;
      }
    }
    kept.push(k);
  }
  const inside = kept.map((k) => ({
    tag: elements[k].tag,
    classes: elements[k].classes,
    text: orderedText(kept.filter((j) => j >= k && j < ends[k]).flatMap((j) => elements[j].chunks)),
  }));
  return { heading, data, nested, inside, text: inside[0].text };
}

// Concatenated contents of every <style> block.
function cssBlocks(html) {
  const blocks = [];
  let start = null;
  for (const token of rawHtmlTokens(html)) {
    if (token.type !== 'tag' || token.name !== 'style') continue;
    if (!token.closing && !token.selfClosing) {
      start = token.end;
    } else if (start !== null && token.closing) {
      blocks.push(html.slice(start, token.index));
      start = null;
    }
  }
  return blocks.join('\n');
}

// Every <link rel="stylesheet"> href, in document order.
function stylesheetLinks(html) {
  const out = [];
  for (const token of rawHtmlTokens(html)) {
    if (token.type !== 'tag' || token.closing || token.name !== 'link') continue;
    const attrs = tagAttributes(token.text);
    const rel = attrs.find(([name]) => name === 'rel')?.[1] || '';
    const href = attrs.find(([name]) => name === 'href')?.[1];
    if (rel.toLowerCase().split(/\s+/).includes('stylesheet') && href) out.push(href);
  }
  return out;
}

// Read the stylesheets a page links, so CSS rules see what the page actually
// ships. A bundled site keeps its CSS in a linked file, and reading only
// <style> blocks scored 59 bytes of a page that ships 100,339 — seven of the
// visual rules read ctx.css, so on any bundled page they were measuring
// reachability rather than quality (lessly-hub/lessly#732).
//
// Local files only. A network fetch inside a merge gate is a different
// decision, and one that belongs to whoever runs the gate rather than to this
// loader; an http(s) href is reported unresolved instead.
function linkedCss(html, { filePath, root } = {}) {
  const found = [];
  const unresolved = [];
  if (!filePath) return { css: '', found, unresolved: stylesheetLinks(html) };

  const fs = require('fs');
  const path = require('path');
  const base = path.dirname(path.resolve(filePath));
  const siteRoot = root ? path.resolve(root) : base;

  for (const href of stylesheetLinks(html)) {
    if (/^(?:[a-z]+:)?\/\//i.test(href) || /^data:/i.test(href)) {
      unresolved.push(href);
      continue;
    }
    const clean = href.split(/[?#]/)[0];
    const candidate = clean.startsWith('/')
      ? path.join(siteRoot, clean)
      : path.resolve(base, clean);
    try {
      found.push({ href, path: candidate, css: fs.readFileSync(candidate, 'utf8') });
    } catch {
      unresolved.push(href);
    }
  }
  return { css: found.map((f) => f.css).join('\n'), found, unresolved };
}

// (selector, block) pairs from CSS rules.
//
// Split on the braces rather than matched with `/([^{}]+)\{([^{}]*)\}/g`. That
// regex is `js/polynomial-redos`: `[^{}]+` has to give up one character at a
// time at every start position, so a stylesheet carrying a long run with no
// brace in it costs O(n²). Measured on this machine, brace-free input: 20KB took
// 6,940ms, 39KB took 26,303ms, and 156KB had not finished in two minutes. CodeQL
// raised it against `scripts/lib/html.js:50` at plugin 4.0.0, and
// lessly-hub/compliance.lessly.tech deleted this file out of its copy rather
// than ship the alert (apliteni/claude-apliteni-plugin#79).
//
// The scan below reads each character once. It reproduces what the regex
// matched, nesting included: inside `@media x { a { b } }` the rule is ` a ` and
// not `@media x { a `, because `[^{}]+` could not cross the inner brace either.
// `cssRules.test.js` pins that against the regex over every stylesheet here.
function cssRules(css) {
  const out = [];
  const chunks = css.split('}');
  // Every chunk but the last was closed by the `}` that ended it. The last one
  // was not, and the regex needed that brace: a truncated stylesheet's final
  // unterminated rule is not a rule.
  for (let i = 0; i < chunks.length - 1; i++) {
    const chunk = chunks[i];
    const brace = chunk.lastIndexOf('{');
    if (brace === -1) continue;
    // The selector is the brace-free run ending at that `{` — everything after
    // the brace before it, which is where the regex would have started.
    const selector = chunk.slice(chunk.lastIndexOf('{', brace - 1) + 1, brace);
    if (!selector) continue; // `[^{}]+` needed at least one character
    out.push([selector.trim(), chunk.slice(brace + 1)]);
  }
  return out;
}

// Diagonal / decorative arrows (external-link cosplay). Plain →←↑↓ are allowed.
const DECOR_ARROWS = /[↗↖↘↙⬈⤴➚⇗⤢⧉]/;

// Broad emoji/pictograph range for section-marker detection.
const EMOJI = /^(?:[☀-➿]|[←-⇿]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udd00-\udfff])/;

// Does this source look like HTML (vs. markdown / plain text)?
//
// Taken on the source with its markdown code removed, because a markdown file
// explaining HTML quotes tags. This skill's own SKILL.md names `<style>`,
// `<link>` and `<div>` inside code spans, and on the raw text that was enough
// to classify a markdown document as a web page. Every markdown-only step then
// went unrun, the code-span exemption with them, and four schemes already
// sitting in backticks scored level-1 errors (apliteni#78).
function looksLikeHtml(source) {
  return /<(?:html|body|head|div|p|section|header|footer|h[1-6]|style|script|span|ul|ol|li|a)\b/i.test(
    withoutMarkdownCode(source)
  );
}

// Markdown code, removed the way CommonMark reads it rather than by pairing the
// first delimiter with the next one.
//
// `/`[^`]*`/g` paired every backtick with the one after it, so a single stray
// backtick shifted the pairing for the rest of the file and every span past it
// was handed to the rules as prose. The fenced form had the same defect: an odd
// ``` anywhere paired with the next real fence and silently ate the prose in
// between, which is the quiet half of the same bug (apliteni#78).

// Offsets of the blank lines in a text, so a candidate span can be told it has
// run past the end of its paragraph without re-slicing the source each time.
function blankLineOffsets(text) {
  const out = [];
  const re = /\n[ \t]*\n/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    out.push(m.index);
    re.lastIndex = m.index + 1; // consecutive blank lines each count
  }
  return out;
}

function blankLineBetween(offsets, from, to) {
  let lo = 0;
  let hi = offsets.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (offsets[mid] < from) lo = mid + 1;
    else if (offsets[mid] >= to) hi = mid - 1;
    else return true;
  }
  return false;
}

// Fenced blocks, matched on whole lines: three or more backticks or tildes open
// one, and a line of at least as many of the same character closes it. An
// unclosed fence runs to the end of the document, which is what CommonMark says
// and what stops a stray fence eating the prose after it.
function stripFences(text, replacement) {
  const out = [];
  let fence = null;
  const lists = [];
  for (const line of text.split('\n')) {
    const container = markdownContainer(line, !fence, fence?.quoteDepth ?? Infinity, lists);
    const blank = /^\s*$/.test(container.body);
    updateListStack(lists, container, blank);
    const body = markdownBlockBody(container, lists.at(-1));
    if (fence && (container.quoteDepth < fence.quoteDepth ||
      (fence.listOwner && lists[fence.listDepth - 1] !== fence.listOwner))) fence = null;
    if (fence) {
      if (fence.closing.test(body)) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(body);
    // A backtick fence's info string cannot itself contain a backtick, so an
    // inline ```span``` sitting on its own line stays prose.
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      const char = open[1][0] === '`' ? '\\`' : '~';
      fence = { closing: new RegExp(`^ {0,3}${char}{${open[1].length},}\\s*$`),
        quoteDepth: container.quoteDepth, listDepth: lists.length,
        listOwner: lists.at(-1) || null };
      out.push(replacement);
      continue;
    }
    out.push(line);
  }
  return out.join('\n');
}

// Inline code spans. A run of N backticks opens one and only a run of exactly N
// closes it; a run that finds no partner is literal text, and the run after it
// is free to open a span of its own.
function stripCodeSpans(text, replacement, protectedRanges = [], onSpan = null) {
  const runs = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== '`') continue;
    let len = 1;
    while (text[i + len] === '`') len++;
    runs.push({ start: i, len });
    i += len - 1;
  }
  if (runs.length < 2) return text;

  // One cursor per delimiter length, each only ever moving forward, so matching
  // stays linear in the number of runs however many of them go unpaired.
  const byLen = new Map();
  runs.forEach((r, i) => {
    if (!byLen.has(r.len)) byLen.set(r.len, []);
    byLen.get(r.len).push(i);
  });
  const cursor = new Map();
  const blanks = blankLineOffsets(text);

  let out = '';
  let copied = 0;
  let k = 0;
  let rangeIndex = 0;
  while (k < runs.length) {
    const open = runs[k];
    while (protectedRanges[rangeIndex]?.end <= open.start) rangeIndex++;
    // A tag protects an opener, but an earlier code span can close inside it.
    if (protectedRanges[rangeIndex]?.start <= open.start || markdownEscaped(text, open.start)) {
      k++;
      continue;
    }
    const peers = byLen.get(open.len);
    let c = cursor.get(open.len) || 0;
    while (c < peers.length && peers[c] <= k) c++;
    cursor.set(open.len, c);
    const close = c < peers.length ? runs[peers[c]] : null;
    if (!close || blankLineBetween(blanks, open.start + open.len, close.start)) {
      k++; // no partner inside this paragraph — the run is literal text
      continue;
    }
    if (onSpan) onSpan(open.start, close.start + close.len);
    out += text.slice(copied, open.start) + replacement;
    copied = close.start + close.len;
    cursor.set(open.len, c + 1);
    k = peers[c] + 1;
  }
  return out + text.slice(copied);
}

// Markdown with every code span and fenced block gone. The stream the rules
// that judge decoration read, and the one the HTML sniff is taken on.
function withoutMarkdownCode(source) {
  return stripCodeSpans(stripFences(source, ' '), ' ');
}

// Match CommonMark raw HTML tags. An attribute starts with an ASCII name and
// has a valid quoted or unquoted value. Invalid angle text stays visible.
const MARKDOWN_TAG = /<(?:\/[a-z][a-z0-9-]*[ \t\n]*|[a-z][a-z0-9-]*(?:[ \t\n]+[a-z_:][a-z0-9:._-]*(?:[ \t\n]*=[ \t\n]*(?:"[^"]*"|'[^']*'|[^ \t\n"'=<>`]+))?)*[ \t\n]*\/?)>/gi;
// HTML ignores the slash flag on non-void elements. Unknown component and
// foreign tag names retain the detector's self-closing syntax.
const NON_VOID_HTML = new Set(('a abbr address article aside audio b bdi bdo blockquote body button ' +
  'canvas caption cite code colgroup data datalist dd del details dfn dialog div dl dt em fieldset ' +
  'figcaption figure footer form h1 h2 h3 h4 h5 h6 head header hgroup html i iframe ins kbd label ' +
  'legend li main map mark menu meter nav noscript object ol optgroup option output p picture pre ' +
  'progress q rp rt ruby s samp script search section select slot small span strong style sub ' +
  'summary sup table tbody td template textarea tfoot th thead time title tr u ul var video').split(' '));

function selfClosingTag(text, foreign = false) {
  const name = /^<\/?([a-z][a-z0-9-]*)/i.exec(text)?.[1];
  if (!foreign && name && NON_VOID_HTML.has(name.toLowerCase())) return false;
  let state = 'name';
  let quote = null;
  let slash = false;
  for (const char of text) {
    if (state === 'quoted') {
      if (char === quote) state = 'beforeName';
      continue;
    }
    if (char === '>') return slash && state !== 'unquoted';
    const space = /[ \t\n\f\r]/.test(char);
    if (state === 'beforeValue') {
      if (space) continue;
      if (char === '"' || char === "'") {
        quote = char;
        state = 'quoted';
      } else state = 'unquoted';
    } else if (state === 'unquoted') {
      if (space) state = 'beforeName';
    } else if (char === '=') state = 'beforeValue';
    else if (space) state = 'beforeName';
    else state = 'name';
    if (!space) slash = char === '/' && state !== 'unquoted';
  }
  return false;
}

const FOREIGN_BREAKOUT = new Set(('b big blockquote body br center code dd div dl dt em embed ' +
  'h1 h2 h3 h4 h5 h6 head hr i img li listing menu meta nobr ol p pre ruby s small span strong ' +
  'strike sub sup table tt u ul var').split(' '));

// Track namespace boundaries needed for slash flags, not a browser tree.
function selfClosingContext(component = false) {
  const scopes = [];
  const positions = new Map();
  const pop = () => {
    const scope = scopes.pop();
    if (scope.previous === undefined) positions.delete(scope.name);
    else positions.set(scope.name, scope.previous);
  };
  return (text, paragraphBreak = false) => {
    if (paragraphBreak) {
      scopes.length = 0;
      positions.clear();
    }
    const match = /^<(\/?)([a-z][a-z0-9-]*)/i.exec(text);
    const name = match[2].toLowerCase();
    const closing = Boolean(match[1]);
    let parent = scopes.at(-1)?.namespace || 'html';
    const breakout = closing ? name === 'br' || name === 'p' : FOREIGN_BREAKOUT.has(name) ||
      (name === 'font' && tagAttributes(text).some(([attr]) => ['color', 'face', 'size'].includes(attr)));
    if (parent !== 'html' && breakout) {
      while (scopes.length && scopes.at(-1).namespace !== 'html') pop();
      parent = 'html';
    }
    const root = name === 'svg' || name === 'math';
    const integration = parent === 'svg' ? ['foreignobject', 'desc', 'title'].includes(name) :
      parent === 'math' && (['mi', 'mo', 'mn', 'ms', 'mtext'].includes(name) ||
        (name === 'annotation-xml' && tagAttributes(text).some(([attr, value]) =>
          attr === 'encoding' && /^(?:text\/html|application\/xhtml\+xml)$/i.test(value))));
    const foreign = component || root || parent !== 'html';
    const closes = selfClosingTag(text, foreign);
    if (closing) {
      const index = positions.get(name);
      if (index !== undefined) while (scopes.length > index) pop();
    } else if (!closes && (root || integration)) {
      const previous = positions.get(name);
      positions.set(name, scopes.length);
      scopes.push({ name, namespace: root ? name : 'html', previous });
    }
    return closes;
  };
}

// Consume each closing candidate once. A greater-than inside a quoted attribute
// does not finish the token, and an unfinished quote consumes the remaining text.
function rawClosingTag(source, from, name) {
  let cursor = from;
  const prefix = `</${name}`;
  while ((cursor = source.indexOf('</', cursor)) !== -1) {
    if (source.slice(cursor, cursor + prefix.length).toLowerCase() !== prefix ||
      !/[ \t\n\f\r/>]/.test(source[cursor + prefix.length] || '')) {
      cursor += 2;
      continue;
    }
    let end = cursor + prefix.length;
    let state = 'beforeName';
    let quote = null;
    for (; end < source.length; end++) {
      const char = source[end];
      const space = /[ \t\n\f\r]/.test(char);
      if (state === 'quoted') {
        if (char === quote) state = 'beforeName';
        continue;
      }
      if (char === '>') return { index: cursor, end: end + 1,
        text: source.slice(cursor, end + 1) };
      if (state === 'beforeValue') {
        if (space) continue;
        if (char === '"' || char === "'") {
          quote = char;
          state = 'quoted';
        } else state = 'unquoted';
      } else if (state === 'unquoted') {
        if (space) state = 'beforeName';
      } else if (char === '=' && state !== 'beforeName') state = 'beforeValue';
      else if (space) {
        if (state === 'name') state = 'afterName';
      } else if (char !== '/') state = 'name';
    }
    return null;
  }
  return null;
}
// Scan one immutable region. Offsets include newlines inside attributes.
function scanRawHtml(source, initialRaw = null, component = false) {
  const selfCloses = selfClosingContext(component);
  let cursor = 0;
  let mode = initialRaw === 'comment' ? 'comment' : initialRaw ? 'rawtext' : 'data';
  let start = 0;
  let quote = null;
  let attributeState = 'name';
  let commentOpenedHere = false;
  let rawName = initialRaw === 'comment' ? null : initialRaw;
  const tokens = [];
  const emit = (type, end) => {
    const token = { type, index: start, end, text: source.slice(start, end) };
    if (type === 'tag') {
      const head = /^<(\/?)([a-z][a-z0-9-]*)/i.exec(token.text);
      token.name = head[2].toLowerCase();
      token.closing = Boolean(head[1]);
      token.selfClosing = selfCloses(token.text);
    }
    tokens.push(token);
    cursor = end;
    mode = 'data';
  };
  while (cursor < source.length) {
    if (mode === 'data') {
      const next = source.indexOf('<', cursor);
      if (next === -1) break;
      if (source.startsWith('<!--', next)) {
        start = next;
        cursor = next + 4;
        commentOpenedHere = true;
        mode = 'comment';
        continue;
      }
      const nameStart = next + (source[next + 1] === '/' ? 2 : 1);
      if (!/[a-z]/i.test(source[nameStart] || '')) { cursor = next + 1; continue; }
      start = next;
      cursor = nameStart + 1;
      quote = null;
      attributeState = 'name';
      mode = 'tag';
      continue;
    }
    if (mode === 'tag') {
      while (cursor < source.length) {
        const char = source[cursor++];
        if (quote) {
          if (char === quote) quote = null;
        } else if (char === '>') {
          emit('tag', cursor);
          const opened = tokens[tokens.length - 1];
          if (!opened.closing && !opened.selfClosing &&
            ['script', 'style', 'textarea'].includes(opened.name)) {
            rawName = opened.name;
            mode = 'rawtext';
          }
          break;
        } else if (attributeState === 'beforeValue') {
          if (/[ \t\n\f\r]/.test(char)) continue;
          if (char === '"' || char === "'") {
            quote = char;
            attributeState = 'beforeName';
          } else attributeState = 'unquoted';
        } else if (attributeState === 'unquoted') {
          if (/[ \t\n\f\r]/.test(char)) attributeState = 'beforeName';
        } else if (char === '=' && attributeState !== 'beforeName') attributeState = 'beforeValue';
        else if (/[ \t\n\f\r]/.test(char)) {
          if (attributeState === 'name') attributeState = 'afterName';
        } else if (char !== '/') attributeState = 'name';
      }
      continue;
    }
    if (mode === 'comment') {
      const shortEnd = !commentOpenedHere ? null : source[start + 4] === '>' ? start + 5 :
        source[start + 4] === '-' && source[start + 5] === '>' ? start + 6 : null;
      if (shortEnd !== null) {
        emit('comment', shortEnd);
        continue;
      }
      const close = /--!?>/g;
      close.lastIndex = cursor;
      const match = close.exec(source);
      if (match) emit('comment', match.index + match[0].length);
      else break;
      continue;
    }
    const match = rawClosingTag(source, cursor, rawName);
    if (match) {
      start = match.index;
      emit('tag', match.end);
      rawName = null;
    } else break;
  }
  const openRaw = mode === 'comment' ? 'comment' : rawName;
  if (mode === 'comment') emit('comment', source.length);
  return { tokens, openRaw };
}

function rawHtmlTokens(source) {
  return scanRawHtml(source).tokens;
}
function markdownEscaped(source, offset) {
  let slashes = 0;
  while (source[offset - slashes - 1] === '\\') slashes++;
  return slashes % 2 === 1;
}

const MARKDOWN_TAG_AT = new RegExp(MARKDOWN_TAG.source, 'iy');

function inlineProtectedRanges(source) {
  const ranges = [];
  const blanks = blankLineOffsets(source);
  let cursor = 0;
  let noLongCommentClose = false;
  while ((cursor = source.indexOf('<', cursor)) !== -1) {
    if (markdownEscaped(source, cursor)) { cursor++; continue; }
    if (source.startsWith('<!--', cursor)) {
      const shortEnd = source[cursor + 4] === '>' ? cursor + 5 :
        source[cursor + 4] === '-' && source[cursor + 5] === '>' ? cursor + 6 : null;
      const longEnd = shortEnd || noLongCommentClose ? -1 :
        source.indexOf('-->', cursor + 4);
      if (longEnd === -1 && !shortEnd) noLongCommentClose = true;
      const close = shortEnd || (longEnd === -1 ? null : longEnd + 3);
      if (close && close > cursor + 4 && !blankLineBetween(blanks, cursor + 4, close)) {
        ranges.push({ start: cursor, end: close });
        cursor = close;
        continue;
      }
    }
    MARKDOWN_TAG_AT.lastIndex = cursor;
    const match = MARKDOWN_TAG_AT.exec(source);
    if (match && !/\n[ \t]*\n/.test(match[0])) {
      ranges.push({ start: cursor, end: cursor + match[0].length });
      cursor += match[0].length;
    } else cursor++;
  }
  return ranges;
}

function codeSpanCandidates(source) {
  const lengths = new Map();
  const byLength = new Map();
  for (let i = 0; i < source.length; i++) {
    if (source[i] !== '`') continue;
    let length = 1;
    while (source[i + length] === '`') length++;
    lengths.set(i, length);
    if (!byLength.has(length)) byLength.set(length, []);
    byLength.get(length).push(i);
    i += length - 1;
  }
  const cursors = new Map();
  const blanks = blankLineOffsets(source);
  return (start) => {
    const length = lengths.get(start);
    const peers = byLength.get(length);
    let cursor = cursors.get(length) || 0;
    while (cursor < peers.length && peers[cursor] <= start) cursor++;
    cursors.set(length, cursor);
    const close = peers[cursor];
    return close !== undefined && !blankLineBetween(blanks, start + length, close) ?
      close + length : null;
  };
}

// The next token owns its complete source range. A spelling inside a comment
// or raw-text element cannot open another element or a Markdown code span.
function markdownInlineTags(source, initialRaw = null) {
  const selfCloses = selfClosingContext();
  const tags = [];
  const blanks = blankLineOffsets(source);
  const tokens = [];
  const textareaRanges = [];
  const codeRanges = [];
  const commentEnds = [...source.matchAll(/--!?>/g)].map((match) => ({
    index: match.index, end: match.index + match[0].length, spelling: match[0],
  }));
  let commentCursor = 0;
  const nextInlineCommentEnd = (from) => {
    while (commentEnds[commentCursor] && (commentEnds[commentCursor].index < from ||
      commentEnds[commentCursor].spelling !== '-->')) commentCursor++;
    return commentEnds[commentCursor];
  };
  let cursor = 0;
  let rawName = initialRaw;
  let rawStart = initialRaw ? 0 : null;
  let rawContentStart = initialRaw === 'textarea' ? 0 : null;
  const nextCodeSpan = codeSpanCandidates(source);
  let nextTag = -2;
  let nextTick = -2;
  let rawCodeRanges = null;
  let rawCodeCursor = 0;
  let previousTagEnd = 0;
  const addTag = (text, index) => {
    const match = Object.assign([text], { index });
    tags.push(match);
    const selfClosing = selfCloses(text, blankLineBetween(blanks, previousTagEnd, index));
    tokens.push({ type: 'tag', index, end: index + text.length, text, selfClosing });
    previousTagEnd = index + text.length;
  };
  while (cursor < source.length) {
    if (rawName) {
      if (rawName === 'comment') {
        const close = nextInlineCommentEnd(cursor);
        if (!close) break;
        const finish = close.end;
        tokens.push({ type: 'comment', index: rawStart, end: finish,
          text: source.slice(rawStart, finish) });
        commentCursor++;
        cursor = finish;
        rawName = null;
        rawStart = null;
        continue;
      }
      if (rawCodeRanges === null) {
        rawCodeRanges = [];
        if (source.includes('`')) {
          const protectedRanges = inlineProtectedRanges(source);
          stripCodeSpans(source, ' ', protectedRanges, (start, end) => {
            rawCodeRanges.push({ start, end });
          });
        }
      }
      // Rejected Markdown angle text owns no token. Search plain closes
      // directly so an inner valid close remains available.
      const closing = new RegExp(`</${rawName}[ \\t\\n\\f\\r]*>`, 'gi');
      closing.lastIndex = cursor;
      let match = null;
      let candidate;
      while ((candidate = closing.exec(source)) !== null) {
        while (rawCodeRanges[rawCodeCursor]?.end <= candidate.index) rawCodeCursor++;
        // Inline Markdown accepts only a plain closing tag. Raw HTML blocks
        // use browser recovery and can accept attributes or a trailing slash.
        if (!markdownEscaped(source, candidate.index) &&
          !(rawCodeRanges[rawCodeCursor]?.start <= candidate.index)) {
          match = { index: candidate.index, end: closing.lastIndex, text: candidate[0] };
          break;
        }
      }
      if (!match) break;
      const finish = match.end;
      if (rawName === 'textarea') textareaRanges.push({ start: rawContentStart, end: match.index });
      addTag(match.text, match.index);
      cursor = finish;
      rawName = null;
      rawStart = null;
      rawContentStart = null;
      continue;
    }
    if (nextTag === -2 || (nextTag !== -1 && nextTag < cursor)) {
      nextTag = source.indexOf('<', cursor);
    }
    if (nextTick === -2 || (nextTick !== -1 && nextTick < cursor)) {
      nextTick = source.indexOf('`', cursor);
    }
    if (nextTick !== -1 && (nextTag === -1 || nextTick < nextTag)) {
      let length = 1;
      while (source[nextTick + length] === '`') length++;
      const end = !markdownEscaped(source, nextTick) ? nextCodeSpan(nextTick) : null;
      if (end !== null) {
        codeRanges.push({ start: nextTick, end });
        cursor = end;
      } else cursor = nextTick + length;
      continue;
    }
    const next = nextTag;
    if (next === -1) break;
    if (markdownEscaped(source, next)) { cursor = next + 1; continue; }
    if (source.startsWith('<!--', next)) {
      const shortEnd = source[next + 4] === '>' ? next + 5 :
        source[next + 4] === '-' && source[next + 5] === '>' ? next + 6 : null;
      if (shortEnd !== null) {
        tokens.push({ type: 'comment', index: next, end: shortEnd,
          text: source.slice(next, shortEnd) });
        cursor = shortEnd;
        continue;
      }
      const close = nextInlineCommentEnd(next + 4);
      if (close && !blankLineBetween(blanks, next + 4, close.end)) {
        const finish = close.end;
        tokens.push({ type: 'comment', index: next, end: finish,
          text: source.slice(next, finish) });
        commentCursor++;
        cursor = finish;
        continue;
      }
      cursor = next + 4;
      continue;
    }
    MARKDOWN_TAG_AT.lastIndex = next;
    const match = MARKDOWN_TAG_AT.exec(source);
    if (!match || /\n[ \t]*\n/.test(match[0])) { cursor = next + 1; continue; }
    addTag(match[0], next);
    const opening = /^<(script|style|textarea)(?=[\s/>])/i.exec(match[0]);
    if (opening && !tokens.at(-1).selfClosing) {
      rawName = opening[1].toLowerCase();
      rawStart = next;
      rawContentStart = next + match[0].length;
    }
    cursor = next + match[0].length;
  }
  if (rawName) {
    if (rawName === 'textarea') textareaRanges.push({ start: rawContentStart, end: source.length });
    if (rawName === 'comment') tokens.push({ type: 'comment', index: rawStart,
      end: source.length, text: source.slice(rawStart) });
  }
  return { tags, tokens, textareaRanges, codeRanges, openRaw: rawName };
}

function markdownTagMatches(source, rawHtml = false, tokens = null) {
  if (tokens || rawHtml) return (tokens || rawHtmlTokens(source)).filter((token) => token.type === 'tag')
    .map((token) => Object.assign([token.text], { index: token.index }));
  return markdownInlineTags(source).tags;
}

function stripMarkdownTags(source, rawHtml = false, tokens = null) {
  const pieces = [];
  let copied = 0;
  for (const match of markdownTagMatches(source, rawHtml, tokens)) {
    pieces.push(source.slice(copied, match.index), ' ');
    copied = match.index + match[0].length;
  }
  pieces.push(source.slice(copied));
  return pieces.join('');
}

function markdownAttributeRuns(source, rawHtml = false, tokens = null) {
  if (rawHtml) return attrTextRuns(source, tokens || rawHtmlTokens(source));
  return attrTextRuns(markdownTagMatches(source, false, tokens).map((match) => match[0]).join(' '));
}

function markdownVisibleRuns(source, html, tokens = null) {
  const boundary = html ? BLOCK_ELEMENT : NON_MARKUP_BOUNDARY;
  const runs = [];
  const pieces = [];
  let copied = 0;
  const finish = () => {
    let text = pieces.join('');
    if (!html) text = markdownLinkLabels(text.replace(/^\s{0,3}#{1,6}\s+/, '')
      .replace(/^\s{0,3}[-*+]\s+/, ''));
    text = decodeEntities(text, { markdownEscapes: !html }).replace(/\s+/g, ' ').trim();
    if (text) runs.push(text);
    pieces.length = 0;
  };
  for (const match of markdownTagMatches(source, html, tokens)) {
    pieces.push(source.slice(copied, match.index));
    if (boundary.test(match[0])) finish();
    else pieces.push(' ');
    copied = match.index + match[0].length;
  }
  pieces.push(source.slice(copied));
  finish();
  return runs;
}

// A tag's quoted backticks are HTML data. Code spans still remove complete
// Markdown spans, including tags written inside those spans.
function withoutMarkdownCodeAroundHtml(source, initialRaw = null) {
  // Region classification has already masked fences with their container context.
  const { codeRanges } = markdownInlineTags(source, initialRaw);
  return maskSourceRanges(source, codeRanges);
}

function maskSourceRanges(source, ranges) {
  const ordered = ranges.sort((a, b) => a.start - b.start);
  const pieces = [];
  let copied = 0;
  for (const range of ordered) {
    if (range.end <= copied) continue;
    const start = Math.max(copied, range.start);
    pieces.push(source.slice(copied, start),
      source.slice(start, range.end).replace(/[^\n]/g, ' '));
    copied = range.end;
  }
  pieces.push(source.slice(copied));
  return pieces.join('');
}

// Both region types use the same ordered tag and comment events. The active
// HTML exclusion survives a Markdown block boundary while reference policy changes.
function stripMarkdownHidden(source, rawHtml, sourceTokens = null, openHidden = null) {
  const tokens = sourceTokens || (rawHtml ? rawHtmlTokens(source) : markdownInlineTags(source).tokens);
  const ranges = [];
  let hidden = openHidden;
  let start = hidden ? 0 : null;
  let after = 0;
  if (hidden === 'comment') {
    const close = tokens.find((token) => token.type === 'comment' && token.index === 0 &&
      (rawHtml ? /--!?>$/.test(token.text) : token.text.endsWith('-->')));
    if (!close) return { text: maskSourceRanges(source,
      [{ start: 0, end: source.length }]), hidden };
    after = close.end;
    ranges.push({ start: 0, end: after });
    hidden = null;
    start = null;
  }
  for (const token of tokens) {
    if (token.index < after) continue;
    if (hidden) {
      const closing = token.type === 'tag' &&
        /^<\/(script|style|code|pre)(?=[ \t\n\f\r/>])/i.exec(token.text);
      if (closing && closing[1].toLowerCase() === hidden) {
        ranges.push({ start, end: token.end });
        hidden = null;
        start = null;
      }
      continue;
    }
    if (token.type === 'comment') {
      ranges.push({ start: token.index, end: token.end });
      if (rawHtml && !/(?:-->|--!>|<!-->|<!--->)$/.test(token.text)) {
        hidden = 'comment';
        start = token.index;
      }
      continue;
    }
    const opening = /^<(script|style|code|pre)(?=[\s/>])/i.exec(token.text);
    if (opening && !token.selfClosing) {
      hidden = opening[1].toLowerCase();
      start = token.index;
    }
  }
  if (hidden && hidden !== 'comment') ranges.push({ start, end: source.length });
  return { text: maskSourceRanges(source, ranges), hidden };
}

// Type 6 block tags can interrupt a paragraph. A complete tag on its own line
// starts type 7 only after a paragraph boundary. Output is not a type 6 tag.
const MARKDOWN_HTML_BLOCK = /^ {0,3}<\/?(?:address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?=[\s/>]|$)/i;
const MARKDOWN_HTML_TAG_LINE = new RegExp(`^ {0,3}${MARKDOWN_TAG.source}\\s*$`, 'i');
const MARKDOWN_SPECIAL_BLOCK = /^ {0,3}<(script|pre|style|textarea)(?=[\s>]|$)/i;
function markdownContainer(line, parseList = true, maxQuoteDepth = Infinity, lists = []) {
  // Structural columns use four-column tab stops. Keep source offsets for
  // attribute text and masks, including tabs partly consumed by a prefix.
  let expanded = line;
  let offsets = null;
  if (line.includes('\t')) {
    expanded = '';
    offsets = [];
    for (let index = 0; index < line.length; index++) {
      const width = line[index] === '\t' ? 4 - expanded.length % 4 : 1;
      for (let column = 0; column < width; column++) offsets.push(index);
      expanded += line[index] === '\t' ? ' '.repeat(width) : line[index];
    }
    offsets.push(line.length);
  }
  let body = expanded;
  let quoteDepth = 0;
  let list = false;
  const listItems = [];
  let markerValue = null;
  let markerIndent = 0;
  let listQuoteDepth = 0;
  let indent = 0;
  const indents = [];
  let quotesAfterList = false;
  while (true) {
    const leading = /^ */.exec(body)[0].length;
    indent = Math.max(indent, leading);
    indents[quoteDepth] ??= leading;
    const containerIndentAllowed = leading <= 3 || lists.some((owner) =>
      owner.quoteDepth === quoteDepth && leading >= owner.contentIndent &&
      leading - owner.contentIndent <= 3);
    const quote = containerIndentAllowed && /^ *>[ \t]?/.exec(body);
    if (quote && quoteDepth < maxQuoteDepth) {
      body = body.slice(quote[0].length);
      quoteDepth++;
      if (list) quotesAfterList = true;
      continue;
    }
    const marker = parseList && containerIndentAllowed &&
      /^ *([-+*]|\d{1,9}[.)])(?:[ \t]+|$)/.exec(body);
    if (marker) {
      if (!list) {
        markerValue = marker[1];
        markerIndent = leading;
        listQuoteDepth = quoteDepth;
      }
      list = true;
      const parent = listItems.findLast((item) => item.quoteDepth === quoteDepth);
      const prefix = leading + marker[1].length;
      const spaces = marker[0].length - prefix;
      const width = body.slice(marker[0].length).trim() && spaces <= 4 ?
        marker[0].length : prefix + 1;
      listItems.push({ quoteDepth, contentIndent: (parent?.contentIndent || 0) + width });
      body = body.slice(width);
      continue;
    }
    break;
  }
  const blockOffset = expanded.length - body.length;
  return { body: line.slice(offsets?.[blockOffset] ?? blockOffset), blockBody: body,
    source: line, offsets, blockOffset, quoteDepth, list, listItems, marker: markerValue,
    quotesAfterList, listQuoteDepth, indent, indents, markerIndent };
}

function retainedListDepth(lists, container, blank) {
  if (blank && !container.list) return lists.length;
  // Losing an outer owner also ends every item nested inside it.
  const ended = lists.findIndex((owner) => {
    const indent = container.list && container.listQuoteDepth === owner.quoteDepth ?
      container.markerIndent : (container.indents[owner.quoteDepth] || 0);
    return container.quoteDepth < owner.quoteDepth || indent < owner.contentIndent;
  });
  return ended === -1 ? lists.length : ended;
}

function updateListStack(lists, container, blank) {
  lists.length = retainedListDepth(lists, container, blank);
  lists.push(...container.listItems);
}

function markdownBlockBody(container, owner, preserveSource = false) {
  const body = container.blockBody;
  const indent = !container.list && owner?.quoteDepth === container.quoteDepth ? owner.contentIndent : 0;
  const available = /^ */.exec(body)[0].length;
  const removed = container.indent >= indent ? Math.min(indent, available) : 0;
  const offset = container.blockOffset + removed;
  return preserveSource ? container.source.slice(container.offsets?.[offset] ?? offset) : body.slice(removed);
}

// Decide block boundaries on the original source. Removing backticks first can
// turn inline HTML into a false block and can erase HTML attribute values.
function markdownRegions(source) {
  const regions = [];
  let kind = 'markdown';
  let lines = [];
  let endMarker = null;
  let quoteDepth = 0;
  let inList = false;
  let listDepth = 0;
  let listOwner = null;
  const lists = [];
  let paragraphOpen = false;
  let paragraphQuoteDepth = 0;
  let paragraphOuterList = false;
  let paragraphListOwner = null;
  let fence = null;
  let regionStart = 0;
  let nextLineStart = 0;
  const pushLine = (text, lineStart) => {
    if (!lines.length) regionStart = lineStart;
    lines.push(text);
  };
  const flush = () => {
    if (lines.length) {
      const text = lines.join('\n');
      regions.push({ kind, text, start: regionStart, end: regionStart + text.length });
    }
    lines = [];
  };
  for (const line of source.split('\n')) {
    const lineStart = nextLineStart;
    nextLineStart += line.length + 1;
    let container = markdownContainer(line, kind !== 'html' && !fence,
      fence?.quoteDepth ?? Infinity, lists);
    // Sibling items end the owning item. Only a new list must satisfy the
    // paragraph interruption rule, including numeric 01 and nonempty content.
    const sibling = paragraphListOwner && container.list &&
      container.listQuoteDepth === paragraphListOwner.quoteDepth &&
      container.markerIndent < paragraphListOwner.contentIndent;
    if (paragraphOpen && container.quoteDepth === paragraphQuoteDepth &&
      container.list && !sibling && (/^\s*$/.test(container.body) ||
      (/^\d/.test(container.marker) && Number.parseInt(container.marker, 10) !== 1))) {
      container = markdownContainer(line, false, Infinity, lists);
    }
    const blank = /^\s*$/.test(container.body);
    // Classify the line before changing owners. A lazy continuation keeps
    // the existing stack without copying it or restoring removed entries.
    const retainedDepth = retainedListDepth(lists, container, blank);
    const nextOwner = container.listItems.at(-1) || lists[retainedDepth - 1];
    const blockBody = markdownBlockBody(container, nextOwner);
    if (kind === 'html' && ((endMarker === null && blank) ||
      container.quoteDepth < quoteDepth ||
      (inList && (retainedDepth < listDepth || lists[listDepth - 1] !== listOwner)))) {
      flush();
      kind = 'markdown';
      endMarker = null;
      paragraphOpen = false;
    }
    let continuation = false;
    const startedAsHtml = kind === 'html';
    if (kind === 'markdown') {
      const openingFence = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(blockBody);
      const opensFence = openingFence &&
        !(openingFence[1][0] === '`' && openingFence[2].includes('`'));
      const atx = /^ {0,3}#{1,6}(?:[ \t]|$)/.test(blockBody);
      const thematic = /^ {0,3}(?:(?:\*[ \t]*){3,}|(?:-[ \t]*){3,}|(?:_[ \t]*){3,})$/.test(blockBody);
      const ownsUnderline = container.quoteDepth === paragraphQuoteDepth &&
        (!paragraphListOwner || (retainedDepth === lists.length &&
          lists.at(-1) === paragraphListOwner && !container.list));
      const setext = paragraphOpen && ownsUnderline && /^ {0,3}(?:=+|-+)[ \t]*$/.test(blockBody);
      // A missing quote marker can continue the open paragraph. A true block
      // start still ends it, even when that line has no quote marker.
      const lazyQuote = paragraphOpen && container.quoteDepth < paragraphQuoteDepth &&
        !container.list && !atx && !thematic && !setext && !blank && !opensFence &&
        !MARKDOWN_HTML_BLOCK.test(blockBody) && !MARKDOWN_SPECIAL_BLOCK.test(blockBody);
      const effectiveQuoteDepth = lazyQuote ? paragraphQuoteDepth : container.quoteDepth;
      const outerListEnded = paragraphOuterList && paragraphListOwner !== nextOwner &&
        container.quoteDepth > 0;
      const startsLeaf = container.list ||
        effectiveQuoteDepth !== paragraphQuoteDepth || outerListEnded || atx || thematic;
      continuation = paragraphOpen && !startsLeaf && !blank && !setext && !opensFence;
      // Lazy paragraph lines retain their list owners for later owned lines.
      if (!(continuation && !MARKDOWN_HTML_BLOCK.test(blockBody) &&
        !MARKDOWN_SPECIAL_BLOCK.test(blockBody) && !/^ {0,3}<!--/.test(blockBody))) {
        lists.length = retainedDepth;
        lists.push(...container.listItems);
      }
      if (lines.length && startsLeaf && !fence) {
        flush();
        paragraphOpen = false;
      }
      if (fence && (container.quoteDepth < fence.quoteDepth ||
        (fence.listOwner && lists[fence.listDepth - 1] !== fence.listOwner))) fence = null;
      if (fence) {
        // Keep offsets while removing code before regions lose their list context.
        pushLine(' '.repeat(line.length), lineStart);
        if (fence.closing.test(blockBody)) fence = null;
        paragraphOpen = false;
        continue;
      }
      if (opensFence) {
        const char = openingFence[1][0] === '`' ? '\\`' : '~';
        fence = { closing: new RegExp(`^ {0,3}${char}{${openingFence[1].length},}\\s*$`),
          quoteDepth: container.quoteDepth, listDepth: lists.length,
          listOwner: lists.at(-1) || null };
        pushLine(' '.repeat(line.length), lineStart);
        paragraphOpen = false;
        continue;
      }
      if (!paragraphOpen && /^ {4}/.test(blockBody)) {
        pushLine(' '.repeat(line.length), lineStart);
        continue;
      }
      if (blank || container.list || effectiveQuoteDepth !== paragraphQuoteDepth) paragraphOpen = false;
      const special = MARKDOWN_SPECIAL_BLOCK.exec(blockBody);
      const startsTagBlock = MARKDOWN_HTML_TAG_LINE.test(blockBody) &&
        !paragraphOpen;
      if (special || /^ {0,3}<!--/.test(blockBody) ||
        MARKDOWN_HTML_BLOCK.test(blockBody) || startsTagBlock) {
        flush();
        kind = 'html';
        quoteDepth = container.quoteDepth;
        inList = lists.length > 0;
        listDepth = lists.length;
        listOwner = lists.at(-1) || null;
        if (special) {
          const closing = new RegExp(`</${special[1]}[ \\t\\n]*>`, 'i');
          endMarker = (text) => closing.test(text);
        } else if (/^ {0,3}<!--/.test(blockBody)) {
          // CommonMark keeps the block open until -->, even if a browser
          // would end the comment at --!> inside that block.
          endMarker = (text) => text.includes('-->');
        } else {
          endMarker = null;
        }
      }
      if (kind === 'markdown') {
        if (!continuation) {
          paragraphOuterList = container.quotesAfterList;
          paragraphListOwner = lists.at(-1) || null;
        }
        paragraphOpen = !blank && !setext &&
          !atx && !thematic;
        paragraphQuoteDepth = effectiveQuoteDepth;
      }
      if (kind === 'markdown' && (atx || setext || thematic)) {
        pushLine(setext ? ' '.repeat(line.length) : line, lineStart);
        flush();
        paragraphOpen = false;
        continue;
      }
    }
    if (startedAsHtml) updateListStack(lists, container, blank);
    const sourceBody = markdownBlockBody(container, lists.at(-1), true);
    const rawLine = kind === 'html' && (quoteDepth > 0 || inList) ?
      ' '.repeat(line.length - sourceBody.length) + sourceBody : line;
    const inlineLine = blank && !container.list ? ' '.repeat(line.length) : continuation && container.quoteDepth > 0 ?
      ' '.repeat(line.length - container.body.length) + container.body : line;
    pushLine(kind === 'html' ? rawLine : inlineLine, lineStart);
    if (kind === 'html') {
      if (endMarker?.(blockBody)) {
        flush();
        kind = 'markdown';
        endMarker = null;
        paragraphOpen = false;
      }
    }
  }
  flush();
  return regions;
}

function protectTextareaCodeEntities(source, textareaRanges) {
  if (!textareaRanges.length) return { text: source, restore: (value) => value };
  let sentinel = '\ue000';
  while (source.includes(sentinel)) sentinel = String.fromCharCode(sentinel.charCodeAt(0) + 1);
  const chars = source.split('');
  let changed = false;
  for (const area of textareaRanges) {
    stripCodeSpans(source.slice(area.start, area.end), ' ', [], (from, to) => {
      for (let i = area.start + from; i < area.start + to; i++) {
        if (chars[i] === '&') {
          chars[i] = sentinel;
          changed = true;
        }
      }
    });
  }
  return changed ? { text: chars.join(''), restore: (value) => value.replaceAll(sentinel, '&') } :
    { text: source, restore: (value) => value };
}

// Keep text beside valid inline tags, but do not turn rejected angle text into
// markup. Style bodies keep their original CSS spelling.
function markdownMarkupSource(source, tokens, initialRaw) {
  const pieces = [];
  let copied = 0;
  let inStyle = initialRaw === 'style';
  const appendText = (end) => {
    const text = source.slice(copied, end);
    pieces.push(inStyle ? text : text.replace(/</g, '&lt;'));
  };
  for (const token of tokens) {
    appendText(token.index);
    if (token.type === 'tag') {
      pieces.push(token.text);
      if (/^<style(?=[\s/>])/i.test(token.text) && !token.selfClosing) inStyle = true;
      if (/^<\/style(?=[\s/>])/i.test(token.text)) inStyle = false;
    } else pieces.push(' ');
    copied = token.end;
  }
  appendText(source.length);
  return pieces.join('');
}

// Match the existing simple link syntax without rescanning unfinished suffixes.
function markdownLinkLabels(source) {
  const pieces = [];
  let copied = 0;
  let cursor = 0;
  while ((cursor = source.indexOf('[', cursor)) !== -1) {
    const labelEnd = source.indexOf(']', cursor + 1);
    if (labelEnd === -1) break;
    if (labelEnd === cursor + 1 || source[labelEnd + 1] !== '(') {
      cursor = labelEnd + 1;
      continue;
    }
    const end = source.indexOf(')', labelEnd + 2);
    if (end === -1) break;
    pieces.push(source.slice(copied, cursor), source.slice(cursor + 1, labelEnd));
    copied = end + 1;
    cursor = copied;
  }
  pieces.push(source.slice(copied));
  return pieces.join('');
}

function markdownStreams(source) {
  source = source.replace(/\r\n?/g, '\n');
  const attrs = [];
  const chunks = [];
  const runs = [];
  const paras = [];
  const markupPieces = [];
  let openHidden = null;
  let activeRaw = null;
  for (const region of markdownRegions(source)) {
    const rawHtml = region.kind === 'html';
    const prepared = rawHtml ? region.text : withoutMarkdownCodeAroundHtml(region.text, activeRaw);
    const scan = rawHtml ? scanRawHtml(prepared, activeRaw) : markdownInlineTags(prepared, activeRaw);
    markupPieces.push(rawHtml ? prepared : markdownMarkupSource(prepared, scan.tokens, activeRaw));
    activeRaw = scan.openRaw;
    const result = stripMarkdownHidden(prepared, rawHtml, scan.tokens, openHidden);
    const body = result.text;
    openHidden = result.hidden;
    const visibleTokens = scan.tokens.filter((token) =>
      token.end <= body.length && body[token.index] === '<');
    attrs.push(...markdownAttributeRuns(body, rawHtml, visibleTokens));
    if (region.kind === 'html') {
      const htmlRuns = markdownVisibleRuns(body, true, visibleTokens);
      runs.push(...htmlRuns);
      paras.push(...htmlRuns);
      chunks.push(decodeEntities(stripMarkdownTags(body, true, visibleTokens)));
      continue;
    }
    const protectedText = protectTextareaCodeEntities(body, scan.textareaRanges);
    const prose = markdownLinkLabels(stripMarkdownTags(protectedText.text, false, visibleTokens)
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}[-*+]\s+/gm, ''));
    const visible = protectedText.restore(decodeEntities(prose, { markdownEscapes: true }));
    chunks.push(visible);
    runs.push(...markdownVisibleRuns(protectedText.text, false, visibleTokens)
      .map((run) => protectedText.restore(run)).filter(Boolean));
    for (const paragraph of prose.split(/\n\s*\n/)) {
      const text = protectedText.restore(decodeEntities(paragraph, { markdownEscapes: true }))
        .replace(/\s+/g, ' ').trim();
      if (text) paras.push(text);
    }
  }
  return { visible: chunks.join(' '), runs, paragraphs: [...paras, ...attrs], attrs,
    markupSource: markupPieces.filter(Boolean).join('\n') };
}

// Visible prose as one string. For HTML: strip tags. For markdown/text: strip the
// lightweight markup that would otherwise pollute prose rules (fences, list bullets,
// heading hashes, link syntax) while keeping the words.
function plainText(source, isHtml) {
  if (isHtml) {
    const body = stripBetween(stripBetween(source, 'style'), 'script');
    const visible = decodeEntities(stripTags(body), { blankUnknown: true })
      .replace(/\s+/g, ' ')
      .trim();
    return [visible, ...attrTextRuns(source)].filter(Boolean).join(' ');
  }
  const { visible, attrs } = markdownStreams(source);
  return [visible, ...attrs].filter(Boolean).join(' ').trim();
}

// Prose with code removed — fenced blocks and inline spans in markdown, <code>
// and <pre> in HTML. A URI inside code is being quoted as a technical value, so
// the rules that judge decoration must not read it.
function proseWithoutCode(source, isHtml) {
  if (isHtml) {
    const body = ['style', 'script', 'code', 'pre'].reduce(stripBetween, source);
    const visible = decodeEntities(stripTags(body)).replace(/\s+/g, ' ').trim();
    return [visible, ...attrTextRuns(body)].filter(Boolean).join(' ');
  }
  return plainText(source, false);
}

// Prose split into paragraphs — the unit for density-gated text rules.
// HTML: split on block-level boundaries. Markdown/text: split on blank lines
// (fenced code removed first so code never counts as prose).
function paragraphs(source, isHtml) {
  if (isHtml) {
    // Each attribute value is its own paragraph: a tooltip is a unit of prose a
    // reader meets on its own, so the density gates should score it that way.
    return [...visibleTextRuns(source), ...attrTextRuns(source)];
  }
  // Split first, decode after: a decoded newline is inside a paragraph, not a
  // break between two.
  return markdownStreams(source).paragraphs;
}

// Component syntax permits <code/> and <Code/>. Represent those empty
// elements with paired tags before the shared HTML consumers read them.
function componentMarkup(source) {
  const pieces = [];
  let copied = 0;
  for (const token of scanRawHtml(source, null, true).tokens) {
    if (token.type !== 'tag' || token.closing || !token.selfClosing || !NON_VOID_HTML.has(token.name)) continue;
    pieces.push(source.slice(copied, token.index),
      token.text.replace(/\/\s*>$/, '>'), `</${token.name}>`);
    copied = token.end;
  }
  pieces.push(source.slice(copied));
  return pieces.join('');
}

// Build a parse context once, hand it to every rule. `filePath` lets the CSS a
// page links be read from disk; `root` resolves root-relative hrefs against a
// built site's directory. Without filePath the linked CSS is reported
// unresolved rather than silently skipped.
function parse(source, { filePath, root, ext } = {}) {
  const original = source;
  if (['jsx', 'tsx', 'vue', 'svelte', 'astro'].includes(ext) ||
    /\.(?:jsx|tsx|vue|svelte|astro)$/i.test(filePath || '')) source = componentMarkup(source);
  const isCss = ext === 'css' || (filePath && /\.css$/i.test(filePath));
  const isMarkdown = ['md', 'markdown'].includes(ext);
  const isHtml = !isCss && !isMarkdown &&
    (['html', 'htm', 'jsx', 'tsx', 'vue', 'svelte', 'astro'].includes(ext) || looksLikeHtml(source));
  const markdown = !isHtml && !isCss ? markdownStreams(source) : null;
  const markupSource = isMarkdown ? markdown.markupSource : source;
  const hasMarkup = isHtml || (isMarkdown && markupSource.length > 0);
  const elements = hasMarkup ? markupElements(markupSource) : null;
  const utilities = elements ? require('./utilities').elementCss(elements) : '';
  const inline = hasMarkup ? cssBlocks(markupSource) : '';
  const linked = hasMarkup ? linkedCss(markupSource, { filePath, root }) : { css: '', found: [], unresolved: [] };
  const css = [isCss ? source : '', inline, linked.css, utilities].filter(Boolean).join('\n');
  const markup = hasMarkup ? markupTokens(markupSource) : null;
  if (markup) for (const el of elements) for (const c of el.classes) markup.classes.add(c);
  return {
    html: original,
    isHtml,
    css,
    inlineCss: inline,
    linkedCss: linked.found,
    unresolvedCss: linked.unresolved,
    runs: isCss ? [source] : markdown ? markdown.runs : visibleTextRuns(source, { markup: isHtml }),
    attrs: markdown ? markdown.attrs : isHtml ? attrTextRuns(source) : [],
    markup,
    elements,
    cssRules: cssRules(css),
    text: isCss ? source : markdown ? [markdown.visible, ...markdown.attrs].filter(Boolean).join(' ').trim() : plainText(source, isHtml),
    codeless: isCss ? source : markdown ? [markdown.visible, ...markdown.attrs].filter(Boolean).join(' ').trim() : proseWithoutCode(source, isHtml),
    paragraphs: isCss ? [source] : markdown ? markdown.paragraphs : paragraphs(source, isHtml),
  };
}

module.exports = {
  stripBetween,
  stripTags,
  decodeEntities,
  visibleTextRuns,
  attrTextRuns,
  markupTokens,
  markupElements,
  selectorApplies,
  labelsAboveHeadings,
  selectorTargets,
  blocksUnderData,
  blocksBesideHeading,
  CODE_TAGS,
  cssBlocks,
  stylesheetLinks,
  linkedCss,
  cssRules,
  looksLikeHtml,
  stripFences,
  stripCodeSpans,
  withoutMarkdownCode,
  plainText,
  proseWithoutCode,
  paragraphs,
  parse,
  DECOR_ARROWS,
  EMOJI,
};
