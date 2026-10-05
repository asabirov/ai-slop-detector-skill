'use strict';

// Dependency-free HTML/CSS parsing helpers for the slop detector.
// Deliberately regex-based, not a real DOM: the checks are heuristic tells,
// and staying dependency-free keeps the linter runnable anywhere Node is.

function stripBetween(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
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
  return html.replace(/<[^>]+>/g, ' ');
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
function decodeEntities(text, { blankUnknown = false } = {}) {
  return text.replace(ENTITY, (whole, hex, dec, name) => {
    if (name !== undefined) {
      const glyph = NAMED[name];
      if (glyph !== undefined) return glyph;
      return blankUnknown ? ' ' : whole;
    }
    const code = hex !== undefined ? parseInt(hex, 16) : Number(dec);
    return decodable(code) ? String.fromCodePoint(code) : whole;
  });
}

// Phrasing marks up words inside a line, so it does not end one: `draft ·
// <strong>2026</strong> · brainstorm` is one chain, and splitting it at the bold
// left three fragments and none. An `<img>` icon between the dots is the same
// shape, so `img` and `wbr` are here too. `svg` is not, and adding it alone would
// not help: an icon is drawn from `use`, `path` and `g`, which end a run as well.
// So a chain with an svg icon between its dots was read before this change and is
// not now. Letting it through means skipping a whole subtree, which is its own
// change.
//
// `span` and `a` are out, because they ended a run before this and a kit's
// `<span>` around a value is how a value is set apart, and `br` is out because
// ending a line is what it is for.
const PHRASING =
  'b|strong|i|em|code|small|sub|sup|mark|abbr|time|kbd|samp|var|cite|q|s|u|del|ins' +
  '|bdi|bdo|ruby|rt|rp|data|dfn|img|wbr|big|tt|font';

// The guard after the name is `(?![a-z0-9-])`, not `\b`: a hyphen is not a word
// character, so `\b` read every custom element starting with one of these names —
// `<time-ago>`, `<s-badge>` — as phrasing.
const ELEMENT = new RegExp(`<\\/?(?!(?:${PHRASING})(?![a-z0-9-]))[a-z][a-z0-9-]*\\b[^>]*>`, 'i');
const BLOCK_ELEMENT = /<\/?(?:p|div|h[1-6]|span|li|td|th|section|header|footer|text|a)\b[^>]*>/i;

// In markup every other element boundary ends a run. Twelve tag names used to, so
// a value in a tag outside the list was read as part of its neighbours: a `<dl>`
// arrived as one long line and no rule measuring a value could reach
// `<dd>14 · 1 no-show</dd>`.
//
// A file that is not markup keeps the twelve. It has no elements, so a tag-shaped
// run of its text is an accident, and splitting on those moved noise around rather
// than removing it. Markdown needs its lines, which is a separate defect.
function visibleTextRuns(html, { markup = true } = {}) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const runs = body.split(markup ? ELEMENT : BLOCK_ELEMENT);
  const out = [];
  for (const r of runs) {
    const t = decodeEntities(stripTags(r)).replace(/\s+/g, ' ').trim();
    if (t) out.push(t);
  }
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
const PROSE_ATTRS = /\b(?:title|alt|placeholder|aria-label|aria-description|aria-placeholder|aria-roledescription|data-tip|data-tooltip|data-title)\s*=\s*"([^"]*)"/gi;

// <meta name="description"> is the one `content=` worth reading — the rest
// carry viewport strings, verification tokens and URLs.
const META_DESCRIPTION =
  /<meta\b[^>]*\bname\s*=\s*"(?:description|og:description|twitter:description)"[^>]*\bcontent\s*=\s*"([^"]*)"/gi;

// One run per human-readable attribute value, longest first is not needed —
// order follows the document, same as visibleTextRuns.
function attrTextRuns(html) {
  const out = [];
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  for (const re of [PROSE_ATTRS, META_DESCRIPTION]) {
    const rx = new RegExp(re.source, re.flags);
    let m;
    while ((m = rx.exec(body)) !== null) {
      const t = decodeEntities(m[1]).replace(/\s+/g, ' ').trim();
      // A one-word label ("Close", "Menu") is a control name, not prose.
      if (t && /\s/.test(t)) out.push(t);
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
  let m;
  const classRe = /\bclass\s*=\s*"([^"]*)"/gi;
  while ((m = classRe.exec(body)) !== null) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }
  const idRe = /\bid\s*=\s*"([^"]*)"/gi;
  while ((m = idRe.exec(body)) !== null) if (m[1].trim()) ids.add(m[1].trim());
  const tagRe = /<([a-z][a-z0-9-]*)\b/gi;
  while ((m = tagRe.exec(body)) !== null) tags.add(m[1].toLowerCase());
  return { classes, ids, tags };
}

// Elements whose font is code's font by right: mono on them, or on anything
// they contain, is typography doing its job rather than costume.
const CODE_TAGS = new Set(['code', 'pre', 'kbd', 'samp', 'tt']);

const VOID_TAGS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr',
]);

// Every element the page carries, each with the tag chain above it. Still a
// regex, not a DOM — but a stack of open tags is enough to answer the one
// question the mono rule needs: what does this selector land on, and does that
// element sit inside a <code>. `inCode` is true for the code elements
// themselves and for everything nested in one, because font-family inherits:
// <code><input></code> puts mono on the input, legitimately.
//
// Mis-nested markup (an unclosed <code>) inflates the chain. That errs toward
// calling something code, which is the quiet direction; a page whose <code>
// never closes has a bigger problem than this rule.
function markupElements(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script').replace(/<!--[\s\S]*?-->/g, ' ');
  const out = [];
  const stack = []; // open elements, innermost last
  const re = /<(\/?)([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>'"])*)>/gi;
  let m;
  let previousEnd = 0;
  while ((m = re.exec(body)) !== null) {
    if (stack.length) {
      const run = body.slice(previousEnd, m.index);
      out[stack[stack.length - 1]].text += run;
      out[stack[stack.length - 1]].chunks.push([previousEnd, run]);
    }
    previousEnd = re.lastIndex;
    const [, closing, rawTag, attrs] = m;
    const tag = rawTag.toLowerCase();
    if (closing) {
      // Pop to the matching open tag; ignore a stray close.
      for (let i = stack.length - 1; i >= 0; i--) {
        if (out[stack[i]].tag === tag) {
          stack.length = i;
          break;
        }
      }
      continue;
    }
    const classAttr = /(?:^|\s)(?:class|className)\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const classValue = classAttr ? (classAttr[1] ?? classAttr[2]) : '';
    const styleAttr = /(?:^|\s)style\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const idAttr = /\bid\s*=\s*"([^"]*)"/i.exec(attrs);
    const parent = stack.length ? stack[stack.length - 1] : -1;
    const el = {
      tag,
      classes: new Set(classValue.trim().split(/\s+/).filter(Boolean)),
      id: idAttr ? idAttr[1].trim() : null,
      parent,
      text: '',
      // `text` loses order: a run belongs to the innermost open element, so
      // `<p><strong>Amounts</strong> in EUR.</p>` gives the <p> " in EUR." and
      // the <strong> "Amounts", and joining parent before child reads them
      // backwards. `chunks` keeps each run's position in the document so a
      // subtree can be read in the order a person reads it.
      chunks: [],
      style: styleAttr ? decodeEntities(styleAttr[1] ?? styleAttr[2]) : '',
      inTable: tag === 'td' || tag === 'th' || (parent >= 0 && out[parent].inTable),
      inCode: CODE_TAGS.has(tag) || (parent >= 0 && out[parent].inCode),
    };
    out.push(el);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(attrs)) stack.push(out.length - 1);
  }
  if (stack.length) {
    const run = body.slice(previousEnd);
    out[stack[stack.length - 1]].text += run;
    out[stack[stack.length - 1]].chunks.push([previousEnd, run]);
  }
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
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks.join('\n');
}

// Every <link rel="stylesheet"> href, in document order.
function stylesheetLinks(html) {
  const out = [];
  const re = /<link\b[^>]*>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[0];
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const href = /\bhref\s*=\s*["']([^"']+)["']/i.exec(tag);
    if (href) out.push(href[1]);
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
  for (const line of text.split('\n')) {
    if (fence) {
      if (fence.test(line)) fence = null;
      continue;
    }
    const open = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    // A backtick fence's info string cannot itself contain a backtick, so an
    // inline ```span``` sitting on its own line stays prose.
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      const char = open[1][0] === '`' ? '\\`' : '~';
      fence = new RegExp(`^ {0,3}${char}{${open[1].length},}\\s*$`);
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
function stripCodeSpans(text, replacement) {
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
  while (k < runs.length) {
    const open = runs[k];
    const peers = byLen.get(open.len);
    let c = cursor.get(open.len) || 0;
    while (c < peers.length && peers[c] <= k) c++;
    cursor.set(open.len, c);
    const close = c < peers.length ? runs[peers[c]] : null;
    if (!close || blankLineBetween(blanks, open.start + open.len, close.start)) {
      k++; // no partner inside this paragraph — the run is literal text
      continue;
    }
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
  // Markdown renders an entity too, so the same decode applies — after the
  // syntax is stripped, not before. The other way round, a decoded character is
  // read as syntax: CommonMark resolves an entity after block structure, so
  // `&#35; x` is a paragraph printing `# x`, not a heading.
  return decodeEntities(
    withoutMarkdownCode(source)
      .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading hashes
      .replace(/^\s{0,3}[-*+]\s+/gm, '') // list bullets
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → link text
  ).trim();
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
  return stripFences(source, '\n')
    .split(/\n\s*\n/)
    .map((p) => decodeEntities(p).replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Build a parse context once, hand it to every rule. `filePath` lets the CSS a
// page links be read from disk; `root` resolves root-relative hrefs against a
// built site's directory. Without filePath the linked CSS is reported
// unresolved rather than silently skipped.
function parse(source, { filePath, root, ext } = {}) {
  const isCss = ext === 'css' || (filePath && /\.css$/i.test(filePath));
  const isHtml = !isCss && (['html', 'htm', 'jsx', 'tsx', 'vue', 'svelte', 'astro'].includes(ext) || looksLikeHtml(source));
  const elements = isHtml ? markupElements(source) : null;
  const utilities = elements ? require('./utilities').elementCss(elements) : '';
  const inline = isHtml ? cssBlocks(source) : '';
  const linked = isHtml ? linkedCss(source, { filePath, root }) : { css: '', found: [], unresolved: [] };
  const css = [isCss ? source : '', inline, linked.css, utilities].filter(Boolean).join('\n');
  const markup = isHtml ? markupTokens(source) : null;
  if (markup) for (const el of elements) for (const c of el.classes) markup.classes.add(c);
  return {
    html: source,
    isHtml,
    css,
    inlineCss: inline,
    linkedCss: linked.found,
    unresolvedCss: linked.unresolved,
    runs: visibleTextRuns(source, { markup: isHtml }),
    attrs: isHtml ? attrTextRuns(source) : [],
    markup,
    elements,
    cssRules: cssRules(css),
    text: plainText(source, isHtml),
    codeless: proseWithoutCode(source, isHtml),
    paragraphs: paragraphs(source, isHtml),
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
