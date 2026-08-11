'use strict';

// TEXT / PROSE slop rules — the surface tells that read as templated machine
// drafting. Two design rules hold the pack together, and the research behind
// them is in docs/ai-slop-detector.md: target tells rather than "is this AI",
// and weight structure above vocabulary, which decays every model generation.
//
// Each rule: { id, level, severity, why, fix, test(ctx) -> string[] hits }

// Search whole prose for any of a set of patterns; return matched snippets.
function phraseRule(patterns) {
  return (ctx) => {
    const hits = [];
    for (const re of patterns) {
      const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      let m;
      while ((m = rx.exec(ctx.text)) !== null) {
        hits.push(m[0].trim().slice(0, 70));
        if (m.index === rx.lastIndex) rx.lastIndex++;
      }
    }
    return [...new Set(hits)];
  };
}

// ── level 1 · ban (chat residue leaked into prose → error) ───────────────

const sycophancyOpener = {
  id: 'sycophancy-opener',
  level: 1,
  severity: 'error',
  why: 'RLHF chat residue ("Certainly!", "Great question!", "I’d be happy to…") that survived from a chatbot into published copy. Near-diagnostic.',
  fix: 'Delete the opener. Start with the point.',
  test: phraseRule([
    /(?:^|[.!?]\s+|\n)\s*(certainly|great question|excellent question|absolutely|sure thing|of course)\s*[!,]/gi,
    /\bI['’]d be happy to\b/gi,
    /(?:^|\n)\s*(sure|certainly|here)['’]?s?,?\s+(here|is|are|what|how)\b/gi,
    /\b(hope this (?:email |message )?finds you well|as an ai language model)\b/gi,
  ]),
};

// ── level 2 · recommended (strong structural + exact-phrase tells) ───────

const negativeParallelism = {
  id: 'negative-parallelism',
  level: 2,
  severity: 'warning',
  why: 'The "not just X, but Y" / "it’s not X, it’s Y" antithesis — the single most-cited structural tell. RLHF-tuned models reach for it reflexively.',
  fix: 'State the claim directly. Cut the negated half unless the contrast is real.',
  test: phraseRule([
    /\bnot\s+(just|only|merely|simply)\b[^.?!]{1,60}?,?\s+but\b/gi,
    /\bit['’]s not\s+[^.?!]{1,40}?,\s+it['’]s\b/gi,
  ]),
};

const hedgeOpener = {
  id: 'hedge-opener',
  level: 2,
  severity: 'warning',
  why: 'Empty meta-commentary ("it’s important to note", "at its core", "when it comes to") — instruction-tuned filler that adds no content.',
  fix: 'Delete the frame and keep the fact it introduces.',
  test: phraseRule([
    /\bit['’]s (important|worth|crucial|essential) to (note|mention|remember|understand)\b/gi,
    /\b(it goes without saying|needless to say|at its core|at the end of the day|when it comes to|let['’]s (dive|delve) (in|into)|in the realm of|in the world of)\b/gi,
  ]),
};

const worldOpener = {
  id: 'world-opener',
  level: 2,
  severity: 'warning',
  why: '"In today’s fast-paced world / digital age" — boilerplate scene-setting that could open any document.',
  fix: 'Open on the specific thing this document is about.',
  test: phraseRule([
    /\bin today['’]s\s+(?:[a-z-]+\s+){0,2}(world|landscape|age|era|environment|market|economy)\b/gi,
    /\bin an? (?:increasingly|ever-)[a-z-]+\s+(world|landscape|era)\b/gi,
  ]),
};

const formulaicCloser = {
  id: 'formulaic-closer',
  level: 2,
  severity: 'warning',
  why: 'A paragraph opening "In conclusion / In summary / Overall," — the formulaic recap of essay/listicle output.',
  fix: 'End on the last real point. A short doc needs no recap.',
  test(ctx) {
    return ctx.paragraphs
      .filter((p) => /^(in conclusion|in summary|to sum up|overall|all in all|in short),/i.test(p))
      .map((p) => p.slice(0, 50));
  },
};

const scopeTemplate = {
  id: 'scope-template',
  level: 2,
  severity: 'warning',
  why: '"Whether you’re a X or a Y" / "from X to Y" enumerating-scope cliché that fakes inclusiveness.',
  fix: 'Name the actual audience or range.',
  test: phraseRule([
    /\bwhether you['’]re\s+an?\b[^.?!]{1,50}?\bor\b/gi,
    /\bfrom\s+[a-z][a-z\s]{1,25}?\s+to\s+[a-z][a-z\s]{1,25}?,\s/gi,
  ]),
};

// ── level 3 · strict (density-gated & structural → warning) ──────────────

const VOCAB = [
  'delve', 'delving', 'tapestry', 'landscape', 'realm', 'testament', 'interplay',
  'boasts', 'leverage', 'leveraging', 'utilize', 'utilizing', 'facilitate',
  'harness', 'harnessing', 'spearhead', 'robust', 'seamless', 'seamlessly',
  'comprehensive', 'vibrant', 'pivotal', 'crucial', 'meticulous', 'meticulously',
  'intricate', 'multifaceted', 'elevate', 'unlock', 'empower', 'empowering',
  'streamline', 'supercharge', 'unleash', 'foster', 'fostering', 'showcasing',
  'emphasizing', 'underscore', 'underscores', 'cutting-edge', 'game-changer',
  'bespoke', 'holistic', 'synergy',
];

const vocabDensity = {
  id: 'vocab-density',
  level: 3,
  severity: 'warning',
  why: 'Inflated corporate/AI vocabulary clustered in one paragraph (>=3 markers). One "robust" is fine; a pile of them is machine register.',
  fix: 'Swap each for the plain word (use, help, lead, strong) and cut the ones that add nothing.',
  test(ctx) {
    const re = new RegExp(`\\b(${VOCAB.join('|')})\\b`, 'gi');
    const hits = [];
    for (const p of ctx.paragraphs) {
      const found = p.match(re);
      if (found && found.length >= 3) {
        const uniq = [...new Set(found.map((w) => w.toLowerCase()))];
        hits.push(`${uniq.slice(0, 6).join(', ')} — ${found.length} inflated terms in one paragraph`);
      }
    }
    return hits;
  },
};

const emptyTransitionDensity = {
  id: 'empty-transition-density',
  level: 3,
  severity: 'warning',
  why: 'Sentence-initial "Moreover / Furthermore / Additionally / Notably / Indeed" used to simulate flow. Density (>=3 across the copy) is the tell, not any single use.',
  fix: 'Cut most of them. Let the sentences connect on their own logic.',
  test(ctx) {
    const re = /(?:^|[.!?]\s+|\n)\s*(moreover|furthermore|additionally|notably|importantly|indeed|consequently|thereby)\b/gi;
    const found = ctx.text.match(re) || [];
    if (found.length >= 3) {
      return [`${found.length} empty transitions (Moreover/Furthermore/Additionally/…)`];
    }
    return [];
  },
};

const boldHeaderList = {
  id: 'bold-header-list',
  level: 3,
  severity: 'warning',
  why: 'The inline-bold-colon list item ("**Header:** descriptive text") — the most reliable *formatting* tell of AI-drafted markdown.',
  fix: 'Use real subheadings, or plain bullets. Reserve bold for genuine emphasis.',
  test(ctx) {
    if (ctx.isHtml) return [];
    const re = /^\s{0,3}[-*+]\s+\*\*[^*]{1,60}?\*\*\s*[:—-]/gm;
    const found = ctx.html.match(re) || [];
    return found.length >= 2 ? [`${found.length} bold-header colon list items`] : [];
  },
};

// ── level 4 · paranoid (statistical / may false-positive → warning) ──────

const emDashDensity = {
  id: 'em-dash-density',
  level: 4,
  severity: 'warning',
  why: 'Em-dashes well above human baseline (>2 per 100 words) — a widely-cited 2025 tell. High false-positive risk; a threshold, not a ban.',
  fix: 'Keep the ones that carry a real aside; make the rest full stops or commas.',
  test(ctx) {
    const words = (ctx.text.match(/\S+/g) || []).length;
    if (words < 60) return [];
    const dashes = (ctx.text.match(/—/g) || []).length;
    const per100 = (dashes / words) * 100;
    return per100 > 2 ? [`${dashes} em-dashes in ${words} words (${per100.toFixed(1)}/100w)`] : [];
  },
};

const burstiness = {
  id: 'low-burstiness',
  level: 4,
  severity: 'warning',
  why: 'Metronomic sentence length (low variance). Human prose mixes short and long; AI tends to a uniform rhythm.',
  fix: 'Break some sentences short. Let one run long. Vary the cadence.',
  test(ctx) {
    const sentences = ctx.text.split(/[.!?]+[\s"']/).map((s) => (s.match(/\S+/g) || []).length).filter((n) => n > 2);
    if (sentences.length < 8) return [];
    const mean = sentences.reduce((a, b) => a + b, 0) / sentences.length;
    if (mean < 6) return [];
    const variance = sentences.reduce((a, b) => a + (b - mean) ** 2, 0) / sentences.length;
    const cv = Math.sqrt(variance) / mean; // coefficient of variation
    return cv < 0.35 ? [`uniform sentence length (cv ${cv.toFixed(2)}, mean ${mean.toFixed(1)} words)`] : [];
  },
};

module.exports = [
  sycophancyOpener,
  negativeParallelism,
  hedgeOpener,
  worldOpener,
  formulaicCloser,
  scopeTemplate,
  vocabDensity,
  emptyTransitionDensity,
  boldHeaderList,
  emDashDensity,
  burstiness,
];
