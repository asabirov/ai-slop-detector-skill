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

function visibleTextRuns(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const runs = body.split(
    /<\/?(?:p|div|h[1-6]|span|li|td|th|section|header|footer|text|a)\b[^>]*>/i
  );
  const out = [];
  for (const r of runs) {
    const t = stripTags(r).replace(/\s+/g, ' ').trim();
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

function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&(amp|lt|gt|quot|apos|nbsp);/gi, (_, n) => {
      const map = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
      return map[n.toLowerCase()];
    });
}

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
  while ((m = re.exec(body)) !== null) {
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
    const classAttr = /\bclass\s*=\s*"([^"]*)"/i.exec(attrs);
    const idAttr = /\bid\s*=\s*"([^"]*)"/i.exec(attrs);
    const parent = stack.length ? stack[stack.length - 1] : -1;
    const el = {
      tag,
      classes: new Set((classAttr ? classAttr[1].trim().split(/\s+/) : []).filter(Boolean)),
      id: idAttr ? idAttr[1].trim() : null,
      parent,
      inCode: CODE_TAGS.has(tag) || (parent >= 0 && out[parent].inCode),
    };
    out.push(el);
    if (!VOID_TAGS.has(tag) && !/\/\s*$/.test(attrs)) stack.push(out.length - 1);
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
    const visible = stripTags(body)
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return [visible, ...attrTextRuns(source)].filter(Boolean).join(' ');
  }
  return withoutMarkdownCode(source)
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // heading hashes
    .replace(/^\s{0,3}[-*+]\s+/gm, '') // list bullets
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links → link text
    .trim();
}

// Prose with code removed — fenced blocks and inline spans in markdown, <code>
// and <pre> in HTML. A URI inside code is being quoted as a technical value, so
// the rules that judge decoration must not read it.
function proseWithoutCode(source, isHtml) {
  if (isHtml) {
    const body = ['style', 'script', 'code', 'pre'].reduce(stripBetween, source);
    const visible = stripTags(body).replace(/\s+/g, ' ').trim();
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
  const noCode = stripFences(source, '\n');
  return noCode
    .split(/\n\s*\n/)
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// Build a parse context once, hand it to every rule. `filePath` lets the CSS a
// page links be read from disk; `root` resolves root-relative hrefs against a
// built site's directory. Without filePath the linked CSS is reported
// unresolved rather than silently skipped.
function parse(source, { filePath, root } = {}) {
  const isHtml = looksLikeHtml(source);
  const inline = isHtml ? cssBlocks(source) : '';
  const linked = isHtml ? linkedCss(source, { filePath, root }) : { css: '', found: [], unresolved: [] };
  const css = [inline, linked.css].filter(Boolean).join('\n');
  return {
    html: source,
    isHtml,
    css,
    inlineCss: inline,
    linkedCss: linked.found,
    unresolvedCss: linked.unresolved,
    runs: visibleTextRuns(source),
    attrs: isHtml ? attrTextRuns(source) : [],
    markup: isHtml ? markupTokens(source) : null,
    elements: isHtml ? markupElements(source) : null,
    cssRules: cssRules(css),
    text: plainText(source, isHtml),
    codeless: proseWithoutCode(source, isHtml),
    paragraphs: paragraphs(source, isHtml),
  };
}

module.exports = {
  stripBetween,
  stripTags,
  visibleTextRuns,
  attrTextRuns,
  markupTokens,
  markupElements,
  selectorApplies,
  labelsAboveHeadings,
  selectorTargets,
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
