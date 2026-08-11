'use strict';

// CODE-COMMENT slop rules — the essay that an agent wrote into a source file
// because the project had nowhere else to put an argument.
//
// The pack measures shape, not vocabulary. Two candidate rules were dropped
// during calibration against a 12,708-line codebase: `restates-code` fired
// twice and both were false positives, and an argument-marker density rule
// ("which is why", "the obvious implementation") caught 6 blocks whose average
// length was 92 lines — every one already caught by comment-essay. Length and
// chaptering carry the whole signal.
//
// Each rule: { id, level, severity, why, fix, test(ctx) -> string[] hits }
// ctx here is the SOURCE context (scripts/lib/source.js), not the HTML one.

const ADR = 'Move the rationale into an ADR or the project docs and leave a one-line pointer: `// why: docs/adr/0007-name.md`.';

function label(block, detail) {
  const head = block.first.length > 60 ? block.first.slice(0, 57) + '…' : block.first;
  return `line ${block.start}: ${head} (${detail})`;
}

// ── level 1 · ban (a document living in a source file → error) ───────────

const commentEssay = {
  id: 'comment-essay',
  level: 1,
  severity: 'error',
  why:
    'A comment block of 25+ prose lines is a design document that was pasted into a source file. It cannot be reviewed as a decision, it has no date and no author, and it goes stale the first time the code around it changes — the reader has no way to tell whether it still describes the code.',
  fix: ADR + ' A comment says what the code cannot; the argument for it belongs where it can be reviewed, dated and superseded.',
  test: (ctx) => ctx.blocks.filter((b) => b.prose >= 25).map((b) => label(b, `${b.prose} prose lines`)),
};

const commentChaptered = {
  id: 'comment-chaptered',
  level: 1,
  severity: 'error',
  why:
    'A comment with dividers or shouted section headings has chapters, and a thing with chapters is a document. Length alone misses this one: a 10-line comment split into titled sections is still an ADR wearing a comment.',
  fix: ADR + ' Keep dividers for separating code, not for sectioning prose.',
  test: (ctx) =>
    ctx.blocks
      .filter((b) => b.len >= 8 && (b.dividers >= 1 || b.headings >= 1))
      .map((b) => label(b, b.dividers ? `${b.dividers} divider(s) in a ${b.len}-line block` : `${b.headings} section heading(s)`)),
};

// ── level 2 · recommended (warnings) ─────────────────────────────────────

const commentLong = {
  id: 'comment-long',
  level: 2,
  severity: 'warning',
  why:
    'Twelve prose lines is past what a comment can hold accurate. It is usually the beginning of an essay — the same content, still unreviewable, just under the ban threshold.',
  fix: 'Cut it to the one thing the code cannot say. If the rest is an argument worth keeping, ' + ADR,
  test: (ctx) => ctx.blocks.filter((b) => b.prose >= 12 && b.prose < 25).map((b) => label(b, `${b.prose} prose lines`)),
};

const commentRatio = {
  id: 'comment-ratio',
  level: 2,
  severity: 'warning',
  why:
    'More than one line of prose per two lines of code means the file is carrying documentation it should not own. Prose at that density is maintained by nobody: the tests prove the code, and nothing proves the comments. API tag lines are excluded from the count, so a fully documented signature costs nothing.',
  fix: 'Move the standing explanation — how the module works, why it exists — into the project docs, and leave the file with the notes that are local to a line.',
  test: (ctx) => {
    if (ctx.codeLines < 20) return [];
    const ratio = ctx.proseLines / ctx.codeLines;
    if (ratio <= 0.5) return [];
    return [`${ctx.proseLines} prose lines to ${ctx.codeLines} code lines (${ratio.toFixed(2)}:1)`];
  },
};

module.exports = [commentEssay, commentChaptered, commentLong, commentRatio];
