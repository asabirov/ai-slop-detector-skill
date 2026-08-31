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
    return body
      .replace(/<[^>]+>/g, ' ')
      .replace(/&[a-z]+;/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim();
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
    return body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  }
  return plainText(source, false);
}

// Prose split into paragraphs — the unit for density-gated text rules.
// HTML: split on block-level boundaries. Markdown/text: split on blank lines
// (fenced code removed first so code never counts as prose).
function paragraphs(source, isHtml) {
  if (isHtml) {
    return visibleTextRuns(source);
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
