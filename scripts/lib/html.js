'use strict';

// Dependency-free HTML/CSS parsing helpers for the slop detector.
// Deliberately regex-based, not a real DOM: the checks are heuristic tells,
// and staying dependency-free keeps the linter runnable anywhere Node is.

function stripBetween(html, tag) {
  return html.replace(new RegExp(`<${tag}\\b[\\s\\S]*?</${tag}>`, 'gi'), ' ');
}

// Visible text as it roughly renders, one run per element-ish boundary.
function visibleTextRuns(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const runs = body.split(
    /<\/?(?:p|div|h[1-6]|span|li|td|th|section|header|footer|text|a)\b[^>]*>/i
  );
  const out = [];
  for (const r of runs) {
    const t = r.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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

function labelsAboveHeadings(html) {
  const body = stripBetween(stripBetween(html, 'style'), 'script');
  const out = [];
  const re = new RegExp(
    `<(${LABEL_TAGS})\\b([^>]*)>([\\s\\S]*?)</\\1>(?:\\s|<!--[\\s\\S]*?-->)*<(h[1-6])\\b[^>]*>([\\s\\S]*?)</\\4>`,
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
      text: decodeEntities(m[3].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
      heading: decodeEntities(m[5].replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim(),
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
function cssRules(css) {
  const out = [];
  const re = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = re.exec(css)) !== null) out.push([m[1].trim(), m[2]]);
  return out;
}

// Diagonal / decorative arrows (external-link cosplay). Plain →←↑↓ are allowed.
const DECOR_ARROWS = /[↗↖↘↙⬈⤴➚⇗⤢⧉]/;

// Broad emoji/pictograph range for section-marker detection.
const EMOJI = /^(?:[☀-➿]|[←-⇿]|\ud83c[\udc00-\udfff]|\ud83d[\udc00-\udfff]|\ud83e[\udd00-\udfff])/;

// Does this source look like HTML (vs. markdown / plain text)?
function looksLikeHtml(source) {
  return /<(?:html|body|head|div|p|section|header|footer|h[1-6]|style|script|span|ul|ol|li|a)\b/i.test(
    source
  );
}

// Visible prose as one string. For HTML: strip tags. For markdown/text: strip the
// lightweight markup that would otherwise pollute prose rules (fences, list bullets,
// heading hashes, link syntax) while keeping the words.
function plainText(source, isHtml) {
  if (isHtml) {
    const body = stripBetween(stripBetween(source, 'style'), 'script');
    const visible = body
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    return [visible, ...attrTextRuns(source)].filter(Boolean).join(' ');
  }
  return source
    .replace(/```[\s\S]*?```/g, ' ') // fenced code — never prose
    .replace(/`[^`]*`/g, ' ') // inline code
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
    const visible = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
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
  const noCode = source.replace(/```[\s\S]*?```/g, '\n\n');
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
    cssRules: cssRules(css),
    text: plainText(source, isHtml),
    codeless: proseWithoutCode(source, isHtml),
    paragraphs: paragraphs(source, isHtml),
  };
}

module.exports = {
  stripBetween,
  visibleTextRuns,
  attrTextRuns,
  markupTokens,
  selectorApplies,
  labelsAboveHeadings,
  cssBlocks,
  stylesheetLinks,
  linkedCss,
  cssRules,
  looksLikeHtml,
  plainText,
  proseWithoutCode,
  paragraphs,
  parse,
  DECOR_ARROWS,
  EMOJI,
};
