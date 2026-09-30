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

const {
  DECOR_ARROWS,
  EMOJI,
  stripSubtrees,
  stripTags,
  selectorApplies,
  selectorTargets,
  labelsAboveHeadings,
  visibleTextRuns,
} = require('../lib/html');

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

const monoAllowed = (el) => el.inCode || (el.inTable && el.numericData && el.hasDigit);

const monoNoncode = {
  id: 'mono-noncode',
  level: 1,
  severity: 'error',
  why: 'Monospace font on an element that is not code — fake-terminal decoration. Real code gets mono; a metadata line does not.',
  fix: 'Use a readable proportional font, or put the content in a <code>/<pre> if it really is code. If you want a label to stand out, weight or size it — do not costume it as code. Numeric table data may use monospace or font-variant-numeric: tabular-nums.',
  // Judged by what the selector lands on, not how it is spelled. The old
  // spelling check exempted anything with `code`/`pre`/`kbd`/`samp`/`tt` in its
  // text, so `.font-mono` — which lands on nothing but <code> spans — failed on
  // three shipped pages while `.al-pre` on a <div> passed
  // (lessly-hub/lessly-landing).
  test(ctx) {
    const hits = [];
    // The lookbehind is the left edge of a CSS ident. Without it the *name*
    // `--default-mono-font-family` — a Tailwind v4 theme token — read as a
    // font-family declaration on :root, and every Tailwind v4 site failed
    // level 1 with nothing it could do about it (#9). A custom property
    // declares a value; only the real property applies one. The non-ASCII
    // range is part of the boundary because an ident may hold one and `\w`
    // is ASCII; without it `--<CJK>font-family` reopens the same hole.
    for (const [selector, body] of ctx.cssRules) {
      const family = /(?:^|;)\s*font-family\s*:\s*([^;}]*mono[^;}]*)/i.exec(body);
      if (!family) continue;
      const m = [null, selector, family[1]];
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

        const inlineIndex = /^\.__slop_inline_(\d+)$/.exec(sel);
        const targets = inlineIndex ? [ctx.elements[Number(inlineIndex[1])]] : selectorTargets(sel, ctx.elements);
        if (targets) {
          // Primary branch: we know every element this lands on. `inCode` covers
          // the element being code and the element being inside code, because
          // font-family inherits — mono on an <input> inside a <code> is the
          // code's font reaching it.
          if (targets.every(monoAllowed)) continue;
          const off = targets.find((el) => !monoAllowed(el));
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

const externalLinkArrow = {
  id: 'external-link-arrow',
  level: 1,
  severity: 'error',
  why: 'Diagonal "↗" open-in-new-tab arrow tacked onto a link — decorative external-link cosplay. A link already reads as a link.',
  fix: 'Drop the glyph. Plain directional →←↑↓ (flows, deltas) are fine.',
  // Reads ctx.codeless for the same reason fake-uri does: inside a code span the
  // glyph is the value under discussion, not ornament on a link. Reading ctx.runs
  // failed this skill's own reference on the row that documents this rule
  // (apliteni#78).
  test(ctx) {
    const hits = [];
    const re = new RegExp(DECOR_ARROWS.source, 'g');
    let m;
    while ((m = re.exec(ctx.codeless)) !== null) {
      hits.push(ctx.codeless.slice(Math.max(0, m.index - 30), m.index + 30).trim());
    }
    return hits;
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
      const inner = stripTags(m[1]).replace(/\s+/g, ' ').trim();
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
      const purple = /#[89ab][0-9a-f]{2}[cf][0-9a-f]|purple|violet|indigo|#7c3aed|#6d28d9|#9333ea|#a855f7|#8b5cf6|#6366f1/.test(g);
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
        hits.add(stripTags(inner).replace(/\s+/g, ' ').trim().slice(0, 40));
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
      const inner = stripTags(m[1]).replace(/\s+/g, ' ').trim();
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

// ── repeated state and restated facts · why: #39 ─────────────────────────

// Words that carry no fact, and a crude plural strip so "change" and "changes"
// are the same token. Enough for a restatement; not a stemmer.
const FACT_STOP = new Set(['a', 'all', 'an', 'and', 'any', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for', 'from', 'has', 'have', 'in', 'is', 'it', 'its', 'not', 'of', 'on', 'or', 'that', 'the', 'then', 'these', 'this', 'those', 'than', 'to', 'was', 'were', 'will', 'with', 'would']);
const stem = (w) => (w.length > 3 && w.endsWith('s') ? w.slice(0, -1) : w);

// Markers a page uses to say "this one is chosen". Each attribute is tested on
// its own rather than inside one `[^>]*` alternation, which is polynomial-redos.
//
// A link is never one of them, however it is marked. `aria-current`, `is-active`
// and `selected` all land on the current item of a nav, where a page title
// repeating it is ordinary practice, so only a control that is not a link counts.
const CHOSEN_ATTR = /\baria-(?:pressed|selected|checked)\s*=\s*(?:"true"|\{true\})/i;
const CHOSEN_CLASS = /(?:^|\s)(?:is-selected|is-active|selected)(?:$|\s)/i;
const ECHO_NEAR = 500;
const LABEL_MAX_CHARS = 60;

const classOf = (attrs) => (/\b(?:class|className)\s*=\s*"([^"]*)"/i.exec(attrs) || ['', ''])[1];

// Runs off a page one of these rules has narrowed further, reusing the parse's
// own runs when the narrowing changed nothing — which is most pages.
const runsOf = (ctx, page) => (page === ctx.onScreenHtml ? ctx.onScreenRuns : visibleTextRuns(page));

// The current item of a breadcrumb is marked the way a chosen control is —
// `is-active`, `selected` — and many libraries render it as plain text, so the
// "wraps a link" escape below misses it. A page title naming the crumb you are
// standing on is ordinary practice (#41 designer review).
const breadcrumb = (_tag, attrs) =>
  /breadcrumb/i.test(classOf(attrs)) || /\baria-label\s*=\s*"[^"]*breadcrumb/i.test(attrs);

// The value as a reader sees it, so a label wrapped in a child element — which is
// how every component library renders one — is read rather than missed.
function chosenText(html, tag, from) {
  const close = html.indexOf(`</${tag}`, from);
  const end = close === -1 ? from + 200 : Math.min(close, from + 200);
  const inner = html.slice(from, end);
  // A wrapper around a link is a nav item, whatever class it carries.
  if (/<a\b/i.test(inner)) return '';
  return stripTags(inner).replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX_CHARS);
}

function chosenValues(html) {
  const out = [];
  const re = /<([a-z][a-z0-9-]*)((?:"[^"]*"|'[^']*'|[^>'"])*)>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const tag = m[1].toLowerCase();
    if (tag === 'a') continue;
    const attrs = m[2];
    const classes = classOf(attrs);
    const option = tag === 'option' && /\bselected\b/i.test(attrs);
    if (!option && !CHOSEN_ATTR.test(attrs) && !CHOSEN_CLASS.test(classes)) continue;
    const text = chosenText(html, tag, re.lastIndex);
    if (text) out.push({ at: m.index, text });
  }
  return out;
}

function headingRuns(html) {
  const out = [];
  const re = /<(h[1-6])\b[^>]*>([\s\S]{0,300}?)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ at: m.index, end: re.lastIndex, text: stripTags(m[2]).replace(/\s+/g, ' ').trim() });
  }
  return out;
}

// "Sep" is echoed by "September 2026": every word of the title opens on the
// chosen value, so the title adds nothing but a date the control implies. A
// title that brings a word of its own ("Costs by team" beside a "Costs" tab) is
// naming its subject and stays silent.
function echoesValue(value, heading) {
  const chosen = (value.toLowerCase().match(/[a-z][a-z-]*/g) || []).filter((w) => w.length >= 3);
  const words = (heading.toLowerCase().match(/[a-z][a-z-]*/g) || []).filter((w) => w.length > 2 && !FACT_STOP.has(w));
  if (!chosen.length || !words.length) return false;
  return words.every((w) => chosen.some((c) => w.startsWith(c) || c.startsWith(w)));
}

const stateTitleEcho = {
  id: 'state-title-echo',
  level: 2,
  severity: 'warning',
  why: 'A title beside a control repeats the value the control already shows as chosen — a period selector on "Sep" with "September 2026" as the heading next to it. The reader is told the same state twice, and one of the two goes stale.',
  fix: 'Let the control carry the state. Give the heading the subject of the screen, or drop it. A heading only a screen reader reads is not a repeat: leave it where it is.',
  test(ctx) {
    if (!ctx.isHtml) return [];
    const page = stripSubtrees(ctx.onScreenHtml, breadcrumb);
    const headings = headingRuns(page);
    const hits = new Set();
    for (const chosen of chosenValues(page)) {
      for (const h of headings) {
        if (chosen.at > h.at && chosen.at < h.end) continue;
        if (Math.abs(h.at - chosen.at) > ECHO_NEAR || !h.text || h.text.length > LABEL_MAX_CHARS) continue;
        if (echoesValue(chosen.text, h.text)) hits.add(`"${h.text}" repeats the selected "${chosen.text}"`);
      }
    }
    return [...hits];
  },
};

function factTokens(text) {
  const words = (text.toLowerCase().match(/[a-z0-9][a-z0-9'’-]*/g) || []).map(stem);
  return new Set(words.filter((w) => w.length > 1 && !FACT_STOP.has(w)));
}

function tokenOverlap(a, b) {
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

// Two lines that each bring a word the other lacks are two facts in one frame,
// not one fact twice: "Total revenue in September 2026" beside "Total expenses
// in September 2026". A restatement may add words to the line it repeats; it
// does not swap the subject (#41 designer review).
function eachAddsAWord(a, b) {
  const beyond = (x, y) => [...x].some((t) => !y.has(t));
  return beyond(a, b) && beyond(b, a);
}

// A print statement repeats the account and the period on every page by design,
// and that is what a running header and footer are for.
const printChrome = (tag) => tag === 'header' || tag === 'footer';

const restatedFact = {
  id: 'restated-fact',
  level: 3,
  severity: 'warning',
  why: 'One fact stated twice on a screen in different words — "Change against August 2026" above the cards, and "changes are against August 2026" in the caption below them. The second reads as new information and is not.',
  fix: 'Keep the statement in the one place the reader needs it and delete the other. A caption that labels its own number is not half of a pair: keep both.',
  // Grouped by the value the two lines share, so a page of prose costs one pass
  // rather than every run against every other run.
  test(ctx) {
    const buckets = new Map();
    // The browser-tab title is not a line on the page, and "Page — Brand" beside
    // the <h1> it names would pair with it on every well-titled document.
    const title = (/<title\b[^>]*>([\s\S]{0,300}?)<\/title>/i.exec(ctx.html) || ['', ''])[1];
    const tabTitle = stripTags(title).replace(/\s+/g, ' ').trim();
    for (const text of runsOf(ctx, stripSubtrees(ctx.onScreenHtml, printChrome))) {
      if (text.length > 120 || (tabTitle && text === tabTitle)) continue;
      const tokens = factTokens(text);
      const numbers = [...tokens].filter((w) => /\d/.test(w));
      if (tokens.size < 3 || !numbers.length) continue;
      const row = { text, key: text.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim(), tokens };
      for (const n of numbers) {
        if (!buckets.has(n)) buckets.set(n, []);
        buckets.get(n).push(row);
      }
    }
    const hits = new Set();
    for (const group of buckets.values()) {
      if (group.length > 20) continue; // one value in twenty lines is a column
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          // The same line twice is a list of like things, not a restatement.
          if (group[i].key === group[j].key) continue;
          if (eachAddsAWord(group[i].tokens, group[j].tokens)) continue;
          if (tokenOverlap(group[i].tokens, group[j].tokens) >= 0.6) {
            hits.add(`"${group[i].text.slice(0, 45)}" restates "${group[j].text.slice(0, 45)}"`);
          }
        }
      }
    }
    return [...hits];
  },
};

// Words that end in "s" after a number without counting anything: a verb, or a
// unit of time in "10 years ago".
const NOT_COUNTED = new Set(['was', 'is', 'as', 'has', 'years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'times']);

// An error summary counts what is wrong with the page, not rows of data, and the
// sentence after the count tells the reader what to do about it. Same for an
// empty state, where the count is zero. Both are the right copy for the pattern
// (#41 designer review).
const STATE_COUNTED = new Set(['errors', 'warnings', 'issues', 'problems', 'fields']);
const announced = (_tag, attrs) => /\brole\s*=\s*"(?:alert|alertdialog|status)"/i.test(attrs);

const countSentence = {
  id: 'count-sentence',
  level: 3,
  severity: 'warning',
  why: 'A sentence of explanation built around a count that changes — "4 rows would move to Software. Each amount shows how much the move adds to or removes from Software." The number moves under the reader while the prose wrapped round it stays.',
  fix: 'Put the count in a short label beside the thing it counts, and let the table show the rest. A count followed by what to do next — an error summary, an empty state — is doing its job.',
  test(ctx) {
    if (!ctx.isHtml) return [];
    return runsOf(ctx, stripSubtrees(ctx.onScreenHtml, announced)).filter((t) => {
      const opening = /^(\d[\d,.]*)\s+([a-z][a-z-]*s)\b/i.exec(t);
      if (!opening || (t.match(/\S+/g) || []).length < 12) return false;
      // A year is a date, not a count, and "10 years ago" opens a story.
      if (/^(?:19|20)\d\d$/.test(opening[1]) || NOT_COUNTED.has(opening[2].toLowerCase())) return false;
      // Nothing to count is an empty state; counting errors is an error summary.
      if (Number(opening[1].replace(/,/g, '')) === 0 || STATE_COUNTED.has(opening[2].toLowerCase())) return false;
      return true;
    }).map((t) => t.slice(0, 70));
  },
};

const HELPER_LINE = /^(?:compared (?:with|to|against)|relative to|measured against|benchmarked against)\b/i;
// A tooltip is a fragment. A comma or a full stop makes it a sentence somebody
// wrote on purpose — "Compared to last year, revenue grew 40%." is copy.
const isFragment = (t) => !/[,.!?]/.test(t) && (t.match(/\S+/g) || []).length <= 8;

// Where a comparison is allowed to live: a heading, a table cell or its caption,
// a figure caption, a chart legend, a control's own label, a real tooltip
// component, and code or the tab title, which are not page copy at all. On print
// and on a touch screen there is no hover, so a caption or a legend is often the
// only place the baseline can go (#41 designer and QA reviews).
const TOOLTIP_HOME = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'th', 'td', 'caption', 'figcaption', 'legend', 'label', 'code', 'pre', 'title']);
const LEGEND_CLASS = /(?:^|[\s_-])legends?(?:$|[\s_-])/i;
const tooltipHome = (tag, attrs) =>
  TOOLTIP_HOME.has(tag) || /\brole\s*=\s*"tooltip"/i.test(attrs) || LEGEND_CLASS.test(classOf(attrs));

const tooltipAsText = {
  id: 'tooltip-as-text',
  level: 3,
  severity: 'warning',
  why: 'Helper text laid out as a free-standing line — "Compared with August 2026" printed beside the period selector. It is a tooltip, or a column header, doing its explaining in the middle of the page.',
  fix: 'Move it into the column header that already carries the comparison, or the label of the control it qualifies. A tooltip last, and only for detail the reader can do without: hover reaches neither touch nor print.',
  // Read off the page with the places the explanation is allowed to live taken
  // out first.
  test(ctx) {
    const candidate = (t) => HELPER_LINE.test(t) && isFragment(t);
    // Asked of the runs first. Stripping can only remove candidates, so a page
    // with none skips the strip — and with it the cost of a page of unclosed tags.
    if (!ctx.isHtml || !ctx.onScreenRuns.some(candidate)) return [];
    const free = stripSubtrees(ctx.onScreenHtml, tooltipHome);
    return [...new Set(runsOf(ctx, free).filter(candidate))].map((t) => t.slice(0, 60));
  },
};

module.exports = [
  cssUnreadable,
  fakeUri,
  monoNoncode,
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
  stateTitleEcho,
  restatedFact,
  countSentence,
  tooltipAsText,
  radiusMonotony,
  ...require('./ui'),
];
