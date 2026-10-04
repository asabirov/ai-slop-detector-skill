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
  stripTags,
  selectorApplies,
  selectorTargets,
  labelsAboveHeadings,
  blocksUnderData,
  blocksBesideHeading,
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

// What makes a line under a table a footnote: how it is set, or what it says.
// Either is enough. Under a table a small muted sentence is a footnote whatever
// it says, and a basis line is a footnote however it is set. A rule reading only
// the wording would have to guess at a sentence anywhere on the page; the whole
// point is that this one reads where the sentence sits.
//
// Set as subordinate: <small>, or a component or class that names itself a note.
// `legend` and `description` are not here — a chart legend and a product
// description are what they say they are, and this rule has no business in them.
const FOOTNOTE_TAG = /^small$|(?:^|-)(?:basis|notes?|footnotes?|hint|disclaimer)$/i;

// A caption names the thing it belongs to, which is its job. It is a footnote
// only when it states a basis instead, so it never takes the "set as
// subordinate" path.
const CAPTION_TAG = /^(?:fig)?caption$|(?:^|-)caption$/i;
const FOOTNOTE_CLASS =
  /(?:^|[-_])(?:foot|footer|footnote|notes?|caption|hint|help|basis|disclaimer|fineprint|muted|subtle|meta)(?:$|[-_\d])/i;

// The facts a footnote carries: what the numbers are counted in, what they leave
// out, how they were rounded, where they came from, when they were taken. Kept
// tight around the numbers, because a bare `source` or `based on` read ordinary
// article prose after a table as a basis line.
const BASIS = [
  /\b(?:amounts?|values?|figures?|totals?|numbers?|prices?|balances?|rates?)\b[^.;]{0,40}?\b(?:in|at|rate|rounded|converted|exclude[sd]?|excluding|include[sd]?|including)\b/i,
  /\bas of\b/i,
  /\brounded (?:to|up|down)\b/i,
  /\bexcluded from\b/i,
  /\bsources?:/i,
];

// A count line belongs under a table, and it is a count line by shape rather
// than by length: "Showing 1 to 10 of 57 entries" is what DataTables writes and
// it is eight words.
const COUNT_LINE = /^(?:showing|displaying|viewing)\b|^\d[\d,]*\s*(?:-|–|to|of)\s*\d/i;

// Six words for a line identified by how it is set, four for one identified by
// what it says — a basis line is named by its wording, so it needs fewer of
// them, and "Amounts in EUR, VAT excluded." is the shape that ships.
const SET_MIN_WORDS = 6;
const BASIS_MIN_WORDS = 4;

const tableFootnote = {
  id: 'table-footnote',
  level: 1,
  severity: 'error',
  why:
    'An explanatory line under a table or a chart — what the numbers are counted in, what they exclude, where they came from, when they were taken. Nobody reading the table reads under it, so the fact is unread and load-bearing at once. A local design rule asking for the line does not make anyone read it.',
  fix:
    'Cut the line. If the fact changes what a number means, put it where the number is: the column header, the unit on the value, or the label of the control that chose it. Policy belongs on the page that sets the policy, linked from the heading.',
  // Position is the definition, so position is the test — finance2 shipped a
  // basis line under every money table and passed four review rounds at strict
  // (#40), because nothing here was looking at where a line sat. What the
  // candidate holds then separates a footnote from the next thing on the page: a
  // heading or a table of its own means it is a section, not an annotation.
  test(ctx) {
    const hits = [];
    for (const { el, above, text, heading, data, inside } of blocksUnderData(ctx.elements)) {
      if (heading || data || COUNT_LINE.test(text)) continue;
      const words = (text.match(/\S+/g) || []).length;
      const basis = words >= BASIS_MIN_WORDS && BASIS.some((re) => re.test(text));
      const set =
        words >= SET_MIN_WORDS &&
        !CAPTION_TAG.test(el.tag) &&
        inside.some((e) => FOOTNOTE_TAG.test(e.tag) || [...e.classes].some((c) => FOOTNOTE_CLASS.test(c)));
      if (!set && !basis) continue;
      hits.push(`under <${above.tag}>: ${text.slice(0, 90)}`);
    }
    return hits;
  },
};

// Two tiers, because one marker set cannot carry both halves of this. A class or
// tag that names an annotation — basis, note, footnote, disclaimer — says the line
// is about the data, so any wording is enough: `<Basis>charge month</Basis>` is the
// line #52 was filed on and `<Basis>non-cash</Basis>` is one word. `<small>` is deliberately not here: it is how a kit sets
// a unit (`<small>EUR</small>`, `<small>ms, p95</small>`), and the README allows a
// unit beside a heading.
const ANNOTATION_TAG = /(?:^|-)(?:basis|notes?|footnotes?|disclaimer)$/i;
const ANNOTATION_CLASS = /(?:^|[-_])(?:basis|notes?|footnotes?|disclaimer|fineprint)(?:$|[-_\d])/i;

// The other tier is everything a design calls a line it has merely set below the
// heading: a subtitle, a lede, a `<small>`. finance2 ships `fin-small` and
// `ui-app__sub`; a kit ships `card-description`.
//
// `caption` and `meta` are deliberately out. A caption above the figure it names is
// where a caption belongs, which `SKILL.md` says in as many words, and `meta` is a
// byline — `<div class="entry-meta">Posted by Dana on 1 Oct 2026.</div>` above a
// post whose body opens with a table is about the post. Neither is needed by any
// shape measured here.
const SUBORDINATE_TAG = /^small$/i;
const SUBORDINATE_CLASS =
  /(?:^|[-_])(?:sub|subtitle|subhead(?:ing|line)?|description|lede|lead|dek|standfirst|tagline|intro|hint|help|muted|subtle|small)(?:$|[-_\d])/i;

// A line that is merely set smaller has to be a sentence before this rule reads
// it. Measured, not assumed: over 2,285 real HTML files the subordinate slot
// beside a heading holds a count (`11 services · 5 regions`), a unit (`req/s ·
// 15m avg`) or a status (`Private workspace`) more often than it holds filler, and
// none of those is a sentence. An annotation-named line skips this, because naming
// itself a basis is the stronger signal.
const SENTENCE = /[.!?]["')”’]?$/;
const SENTENCE_MIN_WORDS = 3;

const words = (text) => (text.match(/\S+/g) || []).length;

const tableAside = {
  id: 'table-aside',
  level: 1,
  severity: 'error',
  why:
    'A line set beside a heading that names a table or a chart — a lede, a group subtitle, a basis, an "as of" date. The data is right there, so the line is read instead of the numbers or not at all. Setting it small or muted says the designer knew it was not worth reading.',
  fix:
    'Cut the line. If it only names what the heading already names, the heading is the one copy needed. If it changes what a number means, put it where the number is: the column header, the unit on the value, or the label of the control that chose it.',
  // The mirror of `table-footnote`: the same position test read forwards, the same
  // control muting and the same count-line exemption. An <h1> is out — it names
  // the page, and a report's own subtitle and byline sit under one with the first
  // table after them. A candidate carrying its own heading, its own data or a list
  // is content rather than an annotation. Each floor is measured against the line
  // that carries the marker, not the row holding it.
  test(ctx) {
    const hits = [];
    for (const { heading, data, text, nested, inside } of blocksBesideHeading(ctx.elements)) {
      if (nested || COUNT_LINE.test(text)) continue;
      // No word floor on this tier, measured: one word recovers `<Basis>non-cash</Basis>`
      // beside an <h2> that already carries a `Non-cash` badge, and adds nothing over
      // the 2,285 files or the counter-cases. A letter, though — a basis holding only
      // `€794.00` is the value, not a line about it.
      const annotated = inside.find(
        (e) =>
          /\p{L}/u.test(e.text) &&
          (ANNOTATION_TAG.test(e.tag) || [...e.classes].some((c) => ANNOTATION_CLASS.test(c)))
      );
      const subordinate = inside.find(
        (e) =>
          words(e.text) >= SENTENCE_MIN_WORDS &&
          SENTENCE.test(e.text) &&
          (SUBORDINATE_TAG.test(e.tag) ||
            ANNOTATION_TAG.test(e.tag) ||
            [...e.classes].some((c) => SUBORDINATE_CLASS.test(c) || ANNOTATION_CLASS.test(c)))
      );
      const marked = annotated || subordinate;
      const basis =
        words(text) >= SENTENCE_MIN_WORDS && BASIS.some((re) => re.test(text)) ? inside[0] : null;
      const line = marked || basis;
      if (!line) continue;
      // Point at the marked line, not at the row holding it: a total with a basis
      // beside it is one candidate, and the basis is the half worth reading about.
      hits.push(
        `beside <${heading.tag}> "${heading.text.slice(0, 40)}" above <${data.tag}>: ${line.text.slice(0, 70)}`
      );
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

// The pair, where `middot-chain` reads three or more. A screen ships it as one
// value — "4 April · 3 days late", "14 · 1 no-show" — and the reader has to take
// the separator apart to find the fact they came for. A number on each side is
// what makes it two facts, so a time beside who did it ("09:40 · System") is one
// event. Both sides in the same shape are one value as well — a dimension, a
// range, a pair of versions: "1920 · 1080", "1920 px · 1080 px", "Q1 · Q2",
// "3 items · 7 items". The dot there is arithmetic. A word that changes, or a
// word on one side only, is a second fact: "14 · 1 lost", "1 h · 30 min".
// Measured over 4,247 local pages and components, one distinct string fires. A
// vertical bar was in the separator set and came out: a union type
// (`'browser' | 'server'`) is not a value.
const FACT_PAIR = /\s[·•]\s/;
const MEASURE = /^(\p{L}*)[\d.,]+\s*([\p{L}%°/²³]*)$/u;
const shape = (m) => `${m[1].toLowerCase()}|${m[2].toLowerCase()}`;

const middotTwoFacts = {
  id: 'middot-two-facts',
  level: 2,
  severity: 'warning',
  why: 'Two facts joined into one value with a middot — the reader has to take the value apart to find the one they came for.',
  fix: 'Split them into their own value and label, or keep the fact that matters and drop the other.',
  test(ctx) {
    return ctx.runs
      .filter((t) => words(t) <= 8)
      .filter((t) => {
        const parts = t.split(FACT_PAIR).map((p) => p.trim());
        if (parts.length !== 2 || parts.some((p) => !/\d/.test(p))) return false;
        const measures = parts.map((p) => MEASURE.exec(p));
        if (measures.every(Boolean) && shape(measures[0]) === shape(measures[1])) return false;
        return parts.some((p) => /\p{L}/u.test(p));
      })
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

module.exports = [
  cssUnreadable,
  fakeUri,
  monoNoncode,
  externalLinkArrow,
  tableFootnote,
  tableAside,
  middotChain,
  middotTwoFacts,
  decorNumbering,
  eyebrowKicker,
  emojiHeading,
  purpleBlueHero,
  aiPalette,
  headingItalic,
  headingPeriod,
  decorBulletDot,
  radiusMonotony,
  ...require('./ui'),
];
