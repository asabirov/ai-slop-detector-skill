'use strict';

// VISUAL / DESIGN slop rules — the decorative machine-tells in markup & CSS.
// Ported and extended from Artur's field-validated detector (2026-07 planning
// artifacts) plus the design skill's known-slop catalogue.
//
// Principle behind all of them: structure and ornament must encode something true
// about the content, never decorate it. A URI implies a real address; monospace
// implies code; a number implies a sequence. When the form makes a promise the
// content doesn't keep, it reads as machine-generated filler.
//
// Each rule: { id, level, severity, why, fix, test(ctx) -> string[] hits }

const { DECOR_ARROWS, EMOJI, selectorApplies, selectorTargets, labelsAboveHeadings } = require('../lib/html');

const countOcc = (s, sub) => s.split(sub).length - 1;

// ── level 1 · ban (always slop → error) ──────────────────────────────────

// Schemes a reader's browser resolves. The charge this rule brings is "it links
// to nothing", so the list is what a link can be, not every scheme that exists:
// `file` is RFC 8089 and opens the file. `ssh`, `git` and `s3` address a tool
// rather than a reader, and belong in a code span, where this rule does not look.
const NAVIGABLE = ['http', 'https', 'ftp', 'ws', 'wss', 'file'];

const fakeUri = {
  id: 'fake-uri',
  level: 1,
  severity: 'error',
  why: 'Fake protocol URI (e.g. lessly://c4/goal) — decorative tech-cosplay pretending to be a real address. It links to nothing.',
  fix:
    'Use plain words, or a real https:// link. A real scheme being quoted as a technical value (neo4j://, postgres://, s3://) belongs in a code span or a fenced block, where this rule does not read it.',
  // Reads ctx.codeless, not ctx.runs: the tell is a URI used as ornament in
  // prose. The same string inside backticks is a value somebody is quoting.
  test(ctx) {
    const hits = [];
    const re = /\b([a-z][a-z0-9]{1,15}):\/\/[^\s"'<>]+/g;
    let m;
    while ((m = re.exec(ctx.codeless)) !== null) {
      if (!NAVIGABLE.includes(m[1].toLowerCase())) hits.push(m[0]);
    }
    return hits;
  },
};

// Spelling, not landing — the fallback for a selector we cannot resolve to an
// element. It reads `code`, `pre`, `kbd`, `samp` or `tt` anywhere in the
// selector text, so `.al-pre` reads as code to it. That is why it is the
// fallback and not the rule: a guess is only better than going quiet.
const SPELLED_FOR_CODE = /\b(code|pre|kbd|samp|tt)\b/i;

const monoNoncode = {
  id: 'mono-noncode',
  level: 1,
  severity: 'error',
  why: 'Monospace font on an element that is not code — fake-terminal decoration. Real code gets mono; a metadata line does not.',
  fix: 'Use the brand sans, or put the content in a <code>/<pre> if it really is code. If you want a label to stand out, weight or size it — do not costume it as code. Aligned digits want font-variant-numeric: tabular-nums, not a mono stack.',
  // Judged by what the selector lands on, not how it is spelled. The old
  // spelling check exempted anything with `code`/`pre`/`kbd`/`samp`/`tt` in its
  // text, so `.font-mono` — which lands on nothing but <code> spans — failed on
  // three shipped pages while `.al-pre` on a <div> passed
  // (lessly-hub/lessly-landing).
  test(ctx) {
    const hits = [];
    const re = /([^{}]+)\{[^{}]*font-family\s*:\s*([^;}]*mono[^;}]*)/gi;
    let m;
    while ((m = re.exec(ctx.css)) !== null) {
      // Every selector in the list, not just the last line of it. Reading one
      // line meant `.label,\n.snip {` was judged only on `.snip`, so a mono
      // label rode in free behind a legitimate code class.
      const list = m[1].replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\s+/g, ' ').trim();
      if (list.startsWith('@')) continue; // @font-face merely loads a face
      for (const part of list.split(',')) {
        const sel = part.trim();
        if (!sel) continue;
        // A shared stylesheet carries rules for pages this is not. Judging one
        // page on another's code blocks is how lessly.com's home page failed on
        // `.font-mono` it never applies (lessly-hub/lessly-landing#390). Asked
        // per selector, so one absent class cannot excuse its neighbours.
        if (!selectorApplies(sel, ctx.markup)) continue;

        const targets = selectorTargets(sel, ctx.elements);
        if (targets) {
          // Primary branch: we know every element this lands on. `inCode` covers
          // the element being code and the element being inside code, because
          // font-family inherits — mono on an <input> inside a <code> is the
          // code's font reaching it.
          if (targets.every((el) => el.inCode)) continue;
          const off = targets.find((el) => !el.inCode);
          hits.push(`${sel} → <${off.tag}> · ${m[2].trim().slice(0, 40)}`);
          continue;
        }
        // Fallback: no markup to read, or a selector this parser cannot point at
        // an element (`:root`, a sibling combinator, a class no element carries).
        // Guess from the spelling rather than go quiet.
        if (!SPELLED_FOR_CODE.test(sel)) hits.push(`${sel} → ${m[2].trim().slice(0, 40)}`);
      }
    }
    return hits;
  },
};

const systemFont = {
  id: 'system-font',
  level: 1,
  severity: 'error',
  why: 'system-ui / -apple-system as the first font family — "no typeface was chosen". The page inherits whatever the OS hands it.',
  fix: 'Embed the brand face (Inter) via @font-face and lead the stack with it.',
  test(ctx) {
    const hits = [];
    const re = /font-family\s*:\s*(system-ui|-apple-system)\b/gi;
    let m;
    while ((m = re.exec(ctx.css)) !== null) hits.push(m[0]);
    return hits;
  },
};

const externalLinkArrow = {
  id: 'external-link-arrow',
  level: 1,
  severity: 'error',
  why: 'Diagonal "↗" open-in-new-tab arrow tacked onto a link — decorative external-link cosplay. A link already reads as a link.',
  fix: 'Drop the glyph. Plain directional →←↑↓ (flows, deltas) are fine.',
  test(ctx) {
    return ctx.runs.filter((t) => DECOR_ARROWS.test(t)).map((t) => t.slice(0, 60));
  },
};

// ── level 2 · recommended (strong tells → warning) ───────────────────────

const middotChain = {
  id: 'middot-chain',
  level: 2,
  severity: 'warning',
  why: 'Middot metadata chain (a · b · c) — templated polish that packs unrelated facts into one dotted line.',
  fix: 'Write a sentence, or split into real elements.',
  test(ctx) {
    return ctx.runs
      .filter((t) => countOcc(t, ' · ') >= 2 || countOcc(t, ' • ') >= 2)
      .map((t) => t.slice(0, 70));
  },
};

const decorNumbering = {
  id: 'decor-numbering',
  level: 2,
  severity: 'warning',
  why: 'Decorative "01 — label" eyebrow where the number indexes nothing.',
  fix: 'Drop the number, or use it only where it encodes a real sequence.',
  test(ctx) {
    return ctx.runs.filter((t) => /^0\d\s*[·•—:.\-]\s*\S/.test(t)).map((t) => t.slice(0, 50));
  },
};

// Which classes render their text uppercase, and how wide they track it. Read
// from (selector, block) pairs rather than blocks alone so a hit can name the
// element a reader would go and look at.
function uppercaseClasses(cssRules) {
  const out = new Map();
  for (const [selector, body] of cssRules) {
    if (!/text-transform\s*:\s*uppercase/i.test(body)) continue;
    const ls = /letter-spacing\s*:\s*([0-9.]*[0-9])\s*(em|rem|px)/i.exec(body);
    const tracking = ls ? `${ls[1]}${ls[2].toLowerCase()}` : null;
    for (const part of selector.split(',')) {
      for (const cls of part.trim().match(/\.[-_a-zA-Z0-9]+/g) || []) {
        out.set(cls.slice(1), tracking);
      }
    }
  }
  return out;
}

// Uppercase in the eye, however it got there: a class, an inline style, or text
// already typed in capitals. Cyrillic counts — no lowercase letter anywhere and
// at least one letter present, rather than an A-Z test that only reads Latin.
const isLiteralCaps = (t) => /\p{L}/u.test(t) && !/\p{Ll}/u.test(t);

// A kicker is a micro-label. Past this it is a standfirst or a paragraph, and
// dropping it is a different edit than the one this rule asks for.
const KICKER_MAX_CHARS = 40;

const eyebrowKicker = {
  id: 'eyebrow-kicker',
  level: 2,
  severity: 'warning',
  why: 'Uppercase micro-label sitting directly above a heading, pre-announcing what the heading already says. The classic example, not something found here: "WHAT’S IN THE BOX" over "What you get on day one".',
  fix: 'Drop the kicker; let the heading lead. Use sentence case for labels.',
  // Position is the definition, so position is the test: the element renders
  // uppercase AND the next thing after it is a heading. Nothing here reads
  // tracking as a gate. .02em looked like the line between status.lessly.com's
  // badges and lessly.com's kickers, but the phrase in this rule's own `why`
  // ships at .04em on a real hero — any threshold between them hides the shape
  // the rule is named after (apliteni#73).
  //
  // Matching elements also does what `selectorApplies` does for mono-noncode,
  // and more strictly: a class no element carries reaches no element here.
  test(ctx) {
    const upper = uppercaseClasses(ctx.cssRules);
    const hits = [];
    for (const el of labelsAboveHeadings(ctx.html)) {
      if (!el.text || el.text.length > KICKER_MAX_CHARS) continue;
      const styled = el.classes.find((c) => upper.has(c));
      const inline = /text-transform\s*:\s*uppercase/i.test(el.style);
      if (!styled && !inline && !isLiteralCaps(el.text)) continue;
      const tracking = styled ? upper.get(styled) : null;
      hits.push(
        `"${el.text}" above "${el.heading}"` +
          (styled ? ` (.${styled}${tracking ? `, tracked ${tracking}` : ''})` : '')
      );
    }
    return hits;
  },
};

const emojiHeading = {
  id: 'emoji-heading',
  level: 2,
  severity: 'warning',
  why: 'Emoji as a section marker (🚀 / ✨) — generic AI decoration standing in for type hierarchy.',
  fix: 'Let heading weight and size carry the structure.',
  test(ctx) {
    const hits = [];
    const re = /<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/gi;
    let m;
    while ((m = re.exec(ctx.html)) !== null) {
      const inner = m[1].replace(/<[^>]+>/g, '').trim();
      if (inner && EMOJI.test(inner)) hits.push(inner.slice(0, 40));
    }
    return hits;
  },
};

const purpleBlueHero = {
  id: 'purple-blue-hero',
  level: 2,
  severity: 'warning',
  why: 'The default purple→blue gradient hero — the single most common AI-generated look.',
  fix: 'Use brand gradient tokens.',
  test(ctx) {
    const hits = [];
    const re = /linear-gradient\([^)]*\)/gi;
    let m;
    while ((m = re.exec(ctx.css)) !== null) {
      const g = m[0].toLowerCase();
      const purple = /#[89ab][0-9a-f]{2}[cf][0-9a-f]|purple|violet|indigo|#7c3aed|#6d28d9/.test(g);
      const blue = /blue|#[0-6][0-9a-f]{2}[ef][0-9a-f]|#2563eb|#3b82f6/.test(g);
      if (purple && blue) hits.push(g.slice(0, 50));
    }
    return hits;
  },
};

const aiPalette = {
  id: 'ai-palette',
  level: 2,
  severity: 'warning',
  why: 'Warm-cream (#F4F1EA) + terracotta — the most common AI-generated palette.',
  fix: 'Use brand color tokens.',
  test(ctx) {
    const cream = /#f4f1ea|#faf6f0|#f5f1e8/i.test(ctx.css);
    const terra = /#e07a5f|#cc6b49|#d4744f|terracotta/i.test(ctx.css);
    return cream && terra ? ['warm-cream + terracotta palette'] : [];
  },
};

// ── level 3 · strict (opinionated stylistic tells → warning) ─────────────

const headingItalic = {
  id: 'heading-italic',
  level: 3,
  severity: 'warning',
  why: 'Italicised word(s) inside a heading (<i>/<em>) — decorative AI polish. Headings stay upright.',
  fix: 'Remove the italics; if you need emphasis, restructure the heading.',
  test(ctx) {
    const hits = new Set();
    const re = /<(h[1-6])\b[^>]*>([\s\S]*?)<\/\1>/gi;
    let m;
    while ((m = re.exec(ctx.html)) !== null) {
      const inner = m[2];
      if (/<(i|em)\b/i.test(inner) || /font-style\s*:\s*italic/i.test(inner)) {
        hits.add(inner.replace(/<[^>]+>/g, '').trim().slice(0, 40));
      }
    }
    return [...hits];
  },
};

const headingPeriod = {
  id: 'heading-period',
  level: 3,
  severity: 'warning',
  why: 'Short display heading ending in a lone period ("Ship it.") — affected AI polish. Titles don’t punctuate.',
  fix: 'Drop the trailing period.',
  test(ctx) {
    const hits = new Set();
    const re = /<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi;
    let m;
    while ((m = re.exec(ctx.html)) !== null) {
      const inner = m[1].replace(/<[^>]+>/g, '').trim();
      if (
        inner.endsWith('.') &&
        !inner.endsWith('...') &&
        countOcc(inner, '.') === 1 &&
        inner.split(/\s+/).length <= 6
      ) {
        hits.add(inner.slice(0, 40));
      }
    }
    return [...hits];
  },
};

const decorBulletDot = {
  id: 'decor-bullet-dot',
  level: 3,
  severity: 'warning',
  why: 'Empty colored round element prefixing a label — AI category-marker polish that encodes nothing.',
  fix: 'Let the label stand alone, or make the dot encode a real state/color meaning.',
  test(ctx) {
    const dotClasses = new Set();
    for (const [sel, block] of ctx.cssRules) {
      const w = /\bwidth\s*:\s*([0-9.]+)px/.exec(block);
      const h = /\bheight\s*:\s*([0-9.]+)px/.exec(block);
      const round = /border-radius\s*:\s*(50%|999px|[0-9.]+px)/.test(block);
      if (w && h && round && parseFloat(w[1]) <= 12 && parseFloat(h[1]) <= 12) {
        for (const cls of sel.match(/\.([A-Za-z0-9_-]+)/g) || []) dotClasses.add(cls.slice(1));
      }
    }
    if (!dotClasses.size) return [];
    const encodesColor = (cls) => {
      const c = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      if (new RegExp(`\\.${c}\\b[.:][^{}]*\\{[^{}]*(?:background|color)\\s*:`).test(ctx.css)) return true;
      const tagRe = new RegExp(`<(?:span|i|div)\\b[^>]*\\bclass="[^"]*\\b${c}\\b[^"]*"[^>]*>`, 'g');
      let mm;
      while ((mm = tagRe.exec(ctx.html)) !== null) {
        if (/style="[^"]*(?:background|color)\s*:/.test(mm[0])) return true;
      }
      return false;
    };
    const hits = [];
    for (const cls of dotClasses) {
      if (encodesColor(cls)) continue;
      const c = cls.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const emptyRe = new RegExp(`<(span|i|div)\\b[^>]*class="[^"]*\\b${c}\\b[^"]*"[^>]*>\\s*</\\1>`);
      if (emptyRe.test(ctx.html)) hits.push(`.${cls} (empty dot element)`);
    }
    return hits;
  },
};

// ── level 4 · paranoid (may false-positive → warning) ────────────────────

const radiusMonotony = {
  id: 'radius-monotony',
  level: 4,
  severity: 'warning',
  why: 'One border-radius on literally every surface — templated. Weight is a design choice; sameness is a default.',
  fix: 'Vary radius by element weight, or commit to the sameness deliberately.',
  test(ctx) {
    const radii = [];
    const re = /border-radius\s*:\s*([0-9.]+)(px|rem)/gi;
    let m;
    while ((m = re.exec(ctx.css)) !== null) radii.push([m[1], m[2]]);
    if (radii.length < 6) return [];
    const vals = radii
      .filter(([v, u]) => !(u === 'px' && parseFloat(v) > 100))
      .map(([v, u]) => `${v}${u}`);
    const counts = {};
    for (const v of vals) counts[v] = (counts[v] || 0) + 1;
    const top = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (top && top[1] >= Math.max(6, vals.length * 0.8)) {
      return [`one radius (${top[0]}) on ~all surfaces — vary or intend it`];
    }
    return [];
  },
};

// A page that links CSS the linter could not open is a page whose CSS rules did
// not run. Seven visual rules read ctx.css, so on a bundled page that silence
// prints as a clean pass — lessly.com scored pass at every level, including
// paranoid, while shipping 8 mono-noncode errors in a stylesheet nobody opened
// (lessly-hub/lessly#732). Medium: the linter is certain it could not see the
// file, and being unable to look is not the page's defect to fail on.
const cssUnreadable = {
  id: 'css-unreadable',
  level: 2,
  severity: 'medium',
  why: 'The page links stylesheets the linter could not read, so every CSS rule scored nothing rather than nothing being there.',
  fix: 'Run against the built site directory so hrefs resolve, or pass --root <dir>. A remote href cannot be read: fetch it alongside the page first.',
  test(ctx) {
    const missing = ctx.unresolvedCss || [];
    if (missing.length === 0) return [];
    const shown = missing.slice(0, 3).join(', ');
    return [
      `${missing.length} linked stylesheet${missing.length > 1 ? 's' : ''} unread (${shown}${missing.length > 3 ? ', …' : ''}) — CSS rules did not run`,
    ];
  },
};

module.exports = [
  cssUnreadable,
  fakeUri,
  monoNoncode,
  systemFont,
  externalLinkArrow,
  middotChain,
  decorNumbering,
  eyebrowKicker,
  emojiHeading,
  purpleBlueHero,
  aiPalette,
  headingItalic,
  headingPeriod,
  decorBulletDot,
  radiusMonotony,
];
