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

// Concatenated contents of every <style> block.
function cssBlocks(html) {
  const blocks = [];
  const re = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;
  let m;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  return blocks.join('\n');
}

// Every declaration block we can see: <style> rules + inline style="" attrs.
function styleBodies(html, css) {
  const bodies = [];
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(css)) !== null) bodies.push(m[2]);
  const inlineRe = /style="([^"]*)"/gi;
  while ((m = inlineRe.exec(html)) !== null) bodies.push(m[1]);
  return bodies;
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

// Build a parse context once, hand it to every rule.
function parse(source) {
  const isHtml = looksLikeHtml(source);
  const css = isHtml ? cssBlocks(source) : '';
  return {
    html: source,
    isHtml,
    css,
    runs: visibleTextRuns(source),
    attrs: isHtml ? attrTextRuns(source) : [],
    styleBodies: styleBodies(source, css),
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
  cssBlocks,
  styleBodies,
  cssRules,
  looksLikeHtml,
  plainText,
  proseWithoutCode,
  paragraphs,
  parse,
  DECOR_ARROWS,
  EMOJI,
};
