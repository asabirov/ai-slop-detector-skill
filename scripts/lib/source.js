'use strict';

// Source-file parsing for the comments pack: split a file into comment blocks
// and code lines. Line-based and dependency-free, the same bet lib/html.js
// makes — the rules are heuristics about shape, so a real parser would buy
// precision the rules cannot spend.
//
// A comment line is one whose FIRST non-space character opens a comment, so
// `const u = 'https://x'` is code and a trailing `// note` never counts. The
// pack measures blocks of prose, not annotations.

const C_LIKE = 'c'; //  // and /* */
const BLOCK_ONLY = 'block'; //  /* */ only
const HASH = 'hash'; //  #

const EXT_SYNTAX = {
  js: C_LIKE, mjs: C_LIKE, cjs: C_LIKE, jsx: C_LIKE,
  ts: C_LIKE, tsx: C_LIKE, mts: C_LIKE, cts: C_LIKE,
  scss: C_LIKE, less: C_LIKE, css: BLOCK_ONLY,
  go: C_LIKE, java: C_LIKE, c: C_LIKE, h: C_LIKE, cc: C_LIKE, cpp: C_LIKE,
  hpp: C_LIKE, rs: C_LIKE, swift: C_LIKE, kt: C_LIKE, php: C_LIKE,
  py: HASH, sh: HASH, bash: HASH, zsh: HASH, rb: HASH,
  yml: HASH, yaml: HASH, toml: HASH,
};

const SOURCE_EXTS = Object.keys(EXT_SYNTAX);

function syntaxFor(ext) {
  return EXT_SYNTAX[String(ext || '').replace(/^\./, '').toLowerCase()] || null;
}

// A run of 8+ box-drawing or rule characters — the divider that turns a comment
// into a chaptered document. Requires a run, so `a -- b` and `x → y` are safe.
const DIVIDER = /([-=_~*#─━═.]\s?){8,}/;

// Structured API metadata, not prose: `@param`, `@returns`, `@type`, `@example`.
const TAG_LINE = /^@\w+/;

// A shouted section title inside a comment: three or more words, all caps.
const CAPS_HEADING = /^[A-Z0-9][A-Z0-9 ,'’()\/-]{8,58}\.?$/;

// Strip the comment markers so a line can be read as the prose it carries.
function strip(line) {
  return line
    .trim()
    .replace(/^\/\*+/, '')
    .replace(/\*+\/$/, '')
    .replace(/^\/\/+/, '')
    .replace(/^#+/, '')
    .replace(/^\*+/, '')
    .trim();
}

function isCapsHeading(text) {
  if (!CAPS_HEADING.test(text)) return false;
  return text.split(/\s+/).filter((w) => /[A-Z]{2}/.test(w)).length >= 3;
}

// Classify every line, then group consecutive comment lines into blocks.
// A blank line ends a block — unless we are inside a /* */, where blank lines
// are part of the comment the author wrote.
function parseSource(text, { ext = 'js' } = {}) {
  const syntax = syntaxFor(ext) || C_LIKE;
  const lines = String(text).split('\n');
  const blocks = [];
  let commentLines = 0;
  let codeLines = 0;
  let inBlockComment = false;
  let current = null;

  const close = () => {
    if (current) blocks.push(finish(current));
    current = null;
  };

  lines.forEach((raw, i) => {
    const t = raw.trim();
    const wasInBlock = inBlockComment;

    if (inBlockComment) {
      if (t.includes('*/')) inBlockComment = false;
    } else if (syntax !== HASH && t.startsWith('/*') && !t.includes('*/')) {
      inBlockComment = true;
    }

    const opensComment =
      (syntax === C_LIKE && (t.startsWith('//') || t.startsWith('/*'))) ||
      (syntax === BLOCK_ONLY && t.startsWith('/*')) ||
      (syntax === HASH && t.startsWith('#') && !t.startsWith('#!'));
    const isComment = wasInBlock || opensComment;

    if (!t && !wasInBlock) {
      close();
      return;
    }
    if (isComment) {
      commentLines += 1;
      if (!current) current = { start: i + 1, lines: [] };
      current.lines.push(raw);
      return;
    }
    close();
    if (t) codeLines += 1;
  });
  close();

  const proseLines = blocks.reduce((sum, b) => sum + b.prose, 0);
  return { kind: 'source', ext, lines, blocks, commentLines, proseLines, codeLines };
}

// Measure one block. `prose` is what the rules count: lines carrying sentences,
// with API tag lines and dividers excluded so a documented signature is not
// mistaken for an essay.
function finish(block) {
  const stripped = block.lines.map(strip);
  let prose = 0;
  let dividers = 0;
  let headings = 0;

  const last = stripped.length - 1;
  stripped.forEach((s, i) => {
    if (!s) return;
    if (DIVIDER.test(s)) {
      // Only an INTERIOR divider chapters a comment. A rule on the first or
      // last line frames it — the CSS banner header convention — and a frame
      // around one idea is not a table of contents.
      if (i > 0 && i < last) dividers += 1;
      return;
    }
    if (TAG_LINE.test(s)) return;
    if (isCapsHeading(s)) {
      headings += 1;
      return;
    }
    if ((s.match(/[A-Za-z]{3,}/g) || []).length >= 2) prose += 1;
  });

  const first = stripped.find((s) => s && !DIVIDER.test(s)) || stripped[0] || '';
  return {
    start: block.start,
    end: block.start + block.lines.length - 1,
    len: block.lines.length,
    text: block.lines.join('\n'),
    first,
    prose,
    dividers,
    headings,
  };
}

module.exports = { parseSource, syntaxFor, SOURCE_EXTS, DIVIDER, isCapsHeading };
