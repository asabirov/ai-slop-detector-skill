# AI Slop Detector

Reference for the optional deterministic CLI in `asabirov/ai-slop-detector-skill`.
For editorial review, follow `SKILL.md`. The CLI retains opinionated rules and
severities for compatibility with existing CI gates; its findings are not universal
judgments about good writing or design. The workflow advice below applies when
using that CLI, not to every editorial pass.

## What it does

Catches AI **slop** — the decorative machine-tells that read as AI-generated even when the
content is right — in HTML, markdown, and plain text. It is a deterministic linter: same
input, same output, every finding explainable with a concrete fix. It is the adversarial
counterpart to `voice` (which judges text register) and `design` (the constructive source
of truth). Build with those; run this as the last gate.

**It is not an "is-this-AI?" classifier.** That problem is probabilistic, unexplainable,
and false-positive-prone, and must never drive a decision about a person. This tool claims
only that a surface *reads as templated*, and tells you exactly where and how to fix it.

**Core principle:** structure and ornament must encode something true about the content,
never decorate it. A URI implies a real address; monospace implies code; a number implies
a sequence; an inflated adjective implies a claim. When the form makes a promise the
content doesn't keep, it reads as machine filler.

## Levels of danger

Strictness is tiered. Each level is a superset of the one below — pick by how much the
surface matters.

| Level | Name | What it adds | Use for |
|-------|------|--------------|---------|
| 1 | `ban` | Existing blocking rules. All `error`. | Required CI gates. |
| 2 | `recommended` | + strong, high-precision structural and phrase tells (`medium`, `warning`). | Default for a requested CLI scan. |
| 3 | `strict` | + opinionated stylistic tells and density-gated vocabulary. | Landing, launch post, hero surfaces. |
| 4 | `paranoid` | + statistical rules that may false-positive. | Deep pre-launch audit. |

There are three severities and two outcomes. `error` findings fail the run (exit `1`);
`medium` and `warning` findings never do (exit `0`). Level 1 is all errors, so it is the
block; levels 2–4 add the rest, so they are the polish.

`medium` and `warning` findings need contextual review. A pattern match establishes
what the rule detected, not whether its suggested edit helps the reader. Keep
necessary technical detail and intentional style. Required CI errors remain
blocking; report a rule conflict instead of bypassing the gate.

The verdict names the loudest thing present: `fail`, then `review` (a medium), then `warn`,
then `pass`.

## Run it

Straight from the source repository, which is how a repository's CI runs it. There is no
npm package; `npx` installs from GitHub, so the runner needs network. Pin a tag — unpinned
tracks `main`, and a rule that tightens fails a build that passed yesterday. `v2.0.0` was
current when this page was generated; the newest is on the [releases page](https://github.com/asabirov/ai-slop-detector-skill/releases).

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#v2.0.0" <file>
npx -y "$REPO#v2.0.0" src scripts --level 1
npx -y "$REPO#v2.0.0" 'src/**/*.js' --json
```

For a Claude Code session, clone this repository into the personal skills directory:

```bash
git clone https://github.com/asabirov/ai-slop-detector-skill.git \
  ~/.claude/skills/ai-slop-detector
node ~/.claude/skills/ai-slop-detector/bin/slop-detector.js <file>
```

Arguments are files, directories (walked) or globs. Each file is routed by its extension —
`.html`/`.md`/`.txt` to the visual and text packs, source files to the comments pack.
CSS and component files also receive visual checks, without prose scoring. The option
`--as source|artifact` overrides that. Git-ignored files are skipped (`--no-git-ignore` to
stop that), and `--ignore 'vendor/**,*.gen.js'` drops more: a gate that reports findings in
build output is a gate nobody can act on.

`scripts/detect.js` takes exactly one file and is the older entry point; `bin/slop-detector.js`
is the same engine over many.

`--level` accepts a number (`1`–`4`) or a name (`ban`, `recommended`, `strict`,
`paranoid`). `--json` emits `{ verdict, level, files[], stats }` for chaining.

### Static UI coverage

Visual rules also read standalone `.css`, quoted `style` attributes, and literal
`class` / `className` attributes in HTML, JSX, TSX, Vue, Svelte, and Astro.
Supported Tailwind utilities cover gradients and color stops, text clipping,
backdrop blur, radii, typography, alignment, borders, and bounce animation.
Selected arbitrary values (radius, shadow, easing, blur, size, background) are
read directly. Conditional variants, computed class expressions, custom utility
configuration, JSX style objects, and CSS variable resolution need generated CSS.
Color utilities at shades 300–700 use representative palette hues. Other shade
values are left unresolved so pale backgrounds do not count as saturated accents.
The scanner does not implement cascade, layout, or contrast calculations.

### Built HTML and linked CSS

Relative stylesheet links resolve against the HTML file. Root-relative links
resolve against the directory argument or `--root`. For a built page:

```bash
node <skill-dir>/bin/slop-detector.js dist/index.html --root dist --no-git-ignore --json
```

Use `--no-git-ignore` when build output is ignored. Explicitly named directories
can be scanned, but nested build/vendor directories and minified files are skipped.
A missing or remote stylesheet produces `css-unreadable` at level 2 and above;
level 1 does not report that coverage gap. Report unread CSS as incomplete coverage,
not proof that the page is clean. Inspect or obtain missing assets when the task
requires a complete visual check.

## Rule catalogue

Three packs, one engine. Structural tells are weighted above vocabulary because vocabulary
lists decay every model generation (delve → showcasing → …) while structure holds. `id`
values are stable — reference them in allowlists and PR notes.

### Visual pack — markup and CSS

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `fake-uri` | 1 | error | Fake protocol URI (`lessly://c4/goal`) — links to nothing. Skips code. |
| `mono-noncode` | 1 | error | Monospace font on prose or a label — fake-terminal decoration. |
| `external-link-arrow` | 1 | error | Diagonal `↗` open-in-new-tab arrow on a link — decorative cosplay. Skips code. |
| `table-footnote` | 1 | error | An explanatory line under a table or a chart — basis, source, exclusion or an “as of” date. |
| `table-aside` | 1 | error | A lede, subtitle or basis line set beside the heading that names a table or a chart. |
| `middot-chain` | 2 | warning | `a · b · c` metadata chain — templated polish. |
| `middot-two-facts` | 2 | warning | One value holding two facts (`4 April · 3 days late`, `Unpaid · 3 days overdue`) — a number on each side with the words around them changing, or a state word facing a counted thing. |
| `decor-numbering` | 2 | warning | `01 — label` eyebrow where the number indexes nothing. |
| `eyebrow-kicker` | 2 | warning | Uppercase wide-tracked micro-label pre-announcing a heading. |
| `emoji-heading` | 2 | warning | Emoji as a section marker, standing in for type hierarchy. |
| `purple-blue-hero` | 2 | warning | The default purple→blue gradient hero. |
| `ai-palette` | 2 | warning | Warm-cream (`#F4F1EA`) + terracotta — the most common AI palette. |
| `heading-italic` | 3 | warning | Italicised word inside a heading — decorative polish. |
| `heading-period` | 3 | warning | Short display heading ending in a lone period (`Ship it.`). |
| `decor-bullet-dot` | 3 | warning | Empty colored round element prefixing a label — encodes nothing. |
| `radius-monotony` | 4 | warning | One `border-radius` on every surface — templated sameness. |

| `gradient-text` | 2 | warning | Gradient clipped into text is decorative emphasis. |
| `ai-gradient` | 2 | warning | Pink, violet and purple gradient combinations are a common generated UI default. |
| `glow-shadow` | 2 | warning | A colored zero-offset shadow creates a decorative halo. |
| `glassmorphism` | 2 | warning | Backdrop blur is a common decorative glass effect. |
| `nested-cards` | 2 | warning | Cards inside cards add redundant containers. |
| `bounce-easing` | 2 | warning | Bounce or elastic motion adds ornamental overshoot. |
| `accent-bar` | 3 | warning | A colored side stripe decorates a container boundary. |
| `pill-radius` | 3 | warning | Pill-shaped buttons or cards can become a default shape without a purpose. |
| `big-number-stat` | 3 | warning | Oversized numeric stats can substitute a hero template for useful evidence. |
| `emoji-icon` | 2 | warning | An isolated emoji stands in for a designed icon. |
| `family-ceiling` | 4 | warning | More than three primary font families can fragment a type system. |
| `stock-display-face` | 4 | warning | Inter or Space Grotesk as a display face is a common default worth reviewing. |
| `mono-uppercase-label` | 3 | warning | Tracked uppercase monospace labels imitate terminal chrome. |
| `accent-budget` | 4 | warning | Several unrelated accent colors can obscure emphasis. |
| `hairline-grid` | 4 | warning | Repeated hairline boxes in a grid can make every item look like the same card. |
| `double-edge` | 4 | warning | Repeated boxes separate themselves with both a border and a fill. |
| `button-drift` | 4 | warning | Several unrelated button sizes or radii weaken control consistency. |
| `everything-centred` | 4 | warning | Centering most of a page weakens the alignment hierarchy. |
| `stock-palette` | 4 | warning | Near-black with acid green, or cream with terracotta and serif type, are common generated palettes. |

`table-footnote` reads position, not wording. The data above it is a `<table>`, a
tag ending in a data word (`DataTable`, `LineChart`, `BarGraph`), or a container
whose class names a chart (`chart`, `graph`, `plot`, `sparkline`) — either as the
element directly before the candidate, or as the last child of a plain wrapper
around one. Last child, not anywhere inside: an article body with a table in the
middle is not a table.

It fires when the element under that data either states a basis in four words or
more, or is set subordinate to the data in six or more. A basis is what the
numbers are counted in, what they exclude, how they were rounded, an “as of”
date, or a `Source:`. Set subordinate means a `<small>`, a tag naming a note,
basis, hint, footnote or disclaimer (`<Basis>`, `<TableNote>`), or a class naming
one of those plus caption, help, fineprint, muted, subtle or meta — on the
element, or on anything prose-bearing inside it.

These stay silent: a count line by its shape (`Showing 1 to 10 of 57 entries`), a
chart legend and a product description (neither `legend` nor `description` is a
marker), a `<caption>` or `<figcaption>` element unless it states a basis rather
than naming its figure, a candidate that carries its own heading or its own table, a
`<section>`, `<nav>`, `<footer>` or `<main>`, and a line whose prose is under the
floor once the words inside its links and buttons are removed — which is what a
pager is.

A `<ul>`, a `<dl>` and a bare `<svg>` are out of the rule, measured rather than
assumed. Over 1,264 HTML files on one machine, every `<ul>` an earlier draft
reached was a navigation menu or an ordinary bulleted list with the next paragraph
after it (65 hits, none real), and every bare `<svg>` was an illustration with its
caption under it (395 hits, none real). A `<p class="cloud-paragraph-align-right">`
matched the chart class, because `paragraph` contains `graph`. A chart drawn as an
unclassed `<svg>` is therefore missed here, as is a note that sits outside the card
holding its table. The editorial check in `SKILL.md` still covers a list and a
chart, because a reader can tell a data list from a menu and this parser cannot.

`table-aside` is the same test read forwards (#52). The candidate is a line between
an `h2`–`h6` and the data that heading names: the heading's following siblings, or,
when the heading and the line share a head row whose class says so (`head`,
`header`, `heading`, `hd`, `title`), that row's next sibling. The data is found on
the first-child chain, the mirror of `table-footnote`'s last child. At most two
lines sit between a heading and its data, and a candidate over 40 elements is
content rather than a line.

Beside a heading a total, a count, a unit and a control all sit legitimately, so
the line has to say what it is. Each floor is measured on the line carrying the
marker, not the row holding it. It fires when that line either names itself a
basis, note, footnote, disclaimer or fineprint, at any length; or is a `<small>` or
carries a class naming a sub, subtitle, subheading, description, lede, lead, dek,
standfirst, tagline, intro, hint, help, muted, subtle or small, on three words or
more ending in `.`, `!` or `?`; or states a basis by wording, the five patterns
`table-footnote` uses, on three words or more.

These stay silent: an `<h1>`, which names the page; a `<small>` holding a unit
(`EUR`, `ms, p95`); a `caption` or a `meta` class, because a caption above its
figure belongs there and `meta` is a byline; a count line by shape; a list; a link
or a button; a candidate carrying its own heading or data; and the table in the
next grid column or table cell, which is what the head-row class test keeps out.

A page lede under the page title is out of reach: finance2 renders it under an
`<h1>`, and a row of controls sits between it and the first table. `SKILL.md`
covers it editorially. Two of #40's lines are reached only in a rendered page,
because `Tasks.tsx` renders its group subtitles through a JSX expression.

New UI checks are warnings, `table-footnote` and `table-aside` excepted: they are
the merge gate because two reviewers ran `--level strict` over the screens in #40
and got a pass.
Aggregate checks use conservative thresholds: more
than three primary font families, at least three distinct accents, three
hairline-bordered grid items, five border-plus-fill rules, or three button sizes
or radii. Centering warns on a document root or four elements covering at least
a third of the page, unless left/start/justify alignment exists. Display-face
checks only inspect explicit headings or type at least 48px; choosing Inter for
body text is allowed. Structural counts resolve simple tag, class, and ID
selectors; complex selectors and inherited styles need rendered review.

### Text pack — prose

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `sycophancy-opener` | 1 | error | Chat residue (`Certainly!`, `I'd be happy to…`) leaked into copy. |
| `negative-parallelism` | 2 | warning | `not just X, but Y` / `it's not X, it's Y` — the top structural tell. |
| `hedge-opener` | 2 | warning | `it's important to note`, `at its core`, `when it comes to`. |
| `world-opener` | 2 | warning | `in today's fast-paced world / digital age` scene-setting. |
| `formulaic-closer` | 2 | warning | Paragraph opening `In conclusion / In summary / Overall,`. |
| `scope-template` | 2 | warning | `whether you're a X or a Y` / `from X to Y` enumerating-scope cliché. |
| `meta-label-opener` | 2 | warning | `Here's how it works:` / `Our recommended tier:` — the outline's label, shipped as copy. |
| `plainness-boast` | 3 | warning | `straight answers`, `no fluff`, `in plain English` — copy advertising its own candour. |
| `vocab-density` | 3 | warning | ≥3 inflated terms (robust, seamless, leverage…) clustered in one paragraph. |
| `empty-transition-density` | 3 | warning | ≥3 sentence-initial `Moreover / Furthermore / Additionally`. |
| `bold-header-list` | 3 | warning | `**Header:** text` markdown list items — the top formatting tell. |
| `em-dash-density` | 4 | warning | Em-dashes above human baseline (>2 per 100 words). |
| `low-burstiness` | 4 | warning | Metronomic sentence length (low variance). |

Prose means prose wherever a reader meets it. The text pack reads the visible text **and**
the human-readable attributes — `title`, `alt`, `placeholder`, `aria-label`, `data-tip` — plus
the meta description. It used to read only the first: stripping tags with `<[^>]+>` deletes an
attribute along with the tag it sits in. On `lessly.com/pricing` that hid 26 values and 324 of
the page's 934 words — the entire compare table — and the gate called the page clean at
paranoid while its owner called it slop (lessly-landing#387). Addresses and identifiers
(`href`, `src`, `class`, `id`) are still not prose, and a one-word value is a control name.

Vocabulary is **density-gated** — flagged only when several inflated terms cluster in one
paragraph. One "robust" is fine; a pile of them is machine register. This is the single
biggest false-positive killer, and the reason single-word puffery does not fire on its own.

### Comments pack — source files

The slop here is the comment: a design document written into the file being edited,
because the project offered nowhere else to put an argument. It has no date, no author and
no reviewer, and it starts going stale the moment the code around it moves.

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `comment-chaptered` | 1 | error | 8+ comment lines with one heading or interior divider in a single block, or two in total across joined blocks. |
| `comment-essay` | 2 | medium | One block carrying 12+ prose lines. |
| `comment-ratio` | 2 | warning | More than one prose line per two lines of code (files of 20+ code lines). |

For `comment-chaptered` only, blocks separated by exactly one blank line
(including whitespace-only lines) form one document. Code or two or more blank
lines end the run. Separator lines do not count toward the 8-line floor, and
headings and interior dividers are counted across the blocks. A single block
of 8+ lines requires at least one signal and keeps firing inside a joined run;
qualification through joining requires at least two signals.
One title in a joined run is a label; two chapter signals make chapters.
Dividers framing an individual block remain frames; joining does not turn them
into chapters.
`comment-essay` still measures individual blocks, and `comment-ratio` is unchanged.

**Length is `medium`, and chaptering is the only ban.** Chaptering is a shape: a comment
either has an interior divider or it does not, so a gate can be certain about it. Length is
a population, and the pack has no honest place to cut it. Measured across twelve Apliteni
repositories (issue #59), 1,511 comment blocks carry 12 or more prose lines, and the mass
of them sits at 12–17 — so a ban anywhere in that range draws a line through the middle of
one population rather than at its edge, and calls two sides of a distribution by two
different names. `comment-essay` covers all of it at one severity instead: certain about
what it found, and not a merge blocker.

The pack measures shape, never wording, and it is deliberately blind to the things a
comment is for. API tag lines (`@param`, `@returns`) never count toward length, so a fully
documented signature costs nothing. A divider on the first or last line **frames** a
comment — the CSS banner-header convention — while a divider in the middle **chapters**
one, and only the second fires. A trailing `// note` is not a block at all, because the
first non-space character of the line has to open the comment.

Two candidate rules were measured against a 12,708-line codebase and dropped. A
`restates-code` rule (a comment that only repeats the line under it) fired twice, and both
were false positives. An argument-marker density rule ("which is why", "the obvious
implementation", "that has happened twice") caught six blocks whose average length was 92
lines — every one of them already caught by `comment-essay`. Length and chaptering carry
the whole signal; vocabulary adds noise.

Languages: `//` and `/* */` (JS/TS, Go, Rust, Java, C-family, SCSS), `#` (Python, shell,
YAML, TOML, Ruby), and CSS block comments.

Review what the comment contributes before following the CLI's suggested move.
Keep constraints needed to maintain the adjacent code. Move broader decision
history to an issue or project docs only when that improves its usefulness, and
leave a pointer. Preserve the information in either case.

## The detector reads its own documentation

Every markdown file this repo ships is scored at level 1 by the test suite, and passes. A
catalogue explains a rule by quoting what it catches, so put the example in a code span or
a fenced block: `fake-uri` and `external-link-arrow` do not read there. That is the whole
exemption, and it is per span, so a stray backtick earlier in the file no longer shifts it
(apliteni#78).

Above level 1 these documents still warn — `negative-parallelism` and `world-opener` fire
on the sentences that name those patterns, in prose where quoting them would read as
pedantry. Warnings exit 0. Do not "fix" either kind by deleting the example: a catalogue
that cannot name what it catches is worth less than a clean run.

## Deliberate exceptions

A false positive that nags is itself slop. Warnings are defaults to follow-or-justify, not
gates. When a warning fires on a genuinely deliberate choice, record the reason in the PR
(never in the artifact) and move on. If a rule is simply wrong, fix the rule — see below.

Native UI fonts are valid choices. The brand-specific `system-font` rule was
removed; all remaining IDs and exit codes are unchanged. `mono-noncode` permits
numeric content in table cells, including descendant spans.

## Extending it

Rules live in `scripts/rules/visual.js`, `scripts/rules/ui.js`, and `scripts/rules/text.js`. Adding one is a
one-line push into the pack; nothing in `detect.js` changes. A rule is:

```js
{ id: 'kebab-id', level: 1 | 2 | 3 | 4, severity: 'error' | 'medium' | 'warning',
  why: 'why this reads as slop', fix: 'the concrete fix',
  test(ctx) { /* ctx: { html, isHtml, css, runs, styleBodies, cssRules, text, paragraphs } */
    return [/* one string per occurrence */]; } }
```

Before adding a rule, it must earn its place — high signal, and a pattern you can point to
in real AI output — and it must be tested both ways:

1. Add a triggering case to a slop fixture. `scripts/detect.test.js` asserts every rule
   fires in at least one fixture.
2. Confirm `fixtures/clean.html` and `fixtures/clean.md` stay silent. If a new rule makes
   the good page fire, the rule is too aggressive — fix the rule, not the good page.

```bash
npm run verify
```

That runs the suite and then `npm run lint:self`, and it is the script the
required `test` check on `main` runs, so a rule change that breaks the suite
cannot merge. Paste its full output in the PR: the check says pass or fail and
nothing about which assertions ran.

## Disagree with a rule, or want to tune it?

The rule set is a shared contract — everyone's audit stays consistent only if the rules
stay the same for everyone. So don't fork or silence rules locally. If you think a rule is
wrong, too aggressive, missing, or should sit at a different level, **open an issue in the
source repo**
([asabirov/ai-slop-detector-skill](https://github.com/asabirov/ai-slop-detector-skill/issues/new)):

- name the rule `id` (e.g. `heading-period`),
- show the case it fires on (or misses), and
- say what you'd change — remove it, re-level it, or narrow the pattern.

Rule changes land through a PR with the fixture updated both ways (the new case fires, the
clean fixtures stay silent), so the change is reviewed and can't quietly regress. A one-off
deliberate choice doesn't need an issue — record the reason in your PR and move on; open an
issue only when the rule itself should change for everyone.

## Where it fits

The visual and text packs were built for the launch-copy audit gate
([lessly-hub/lessly#732](https://github.com/lessly-hub/lessly/issues/732)): the pass every
customer-facing surface clears before public-launch go/no-go. Grounded in a 2025–2026
survey of AI-slop detection (Wikipedia "Signs of AI writing", the *Measuring AI Slop*
taxonomy, slop-gate, Vale).

The comments pack was added when the same agents that write the copy turned out to be
writing design documents into source files — 33% of one repository's lines were comments,
and its longest single comment block ran to 117 lines.

The rules live in `asabirov/ai-slop-detector-skill`. A CI job uses a pinned git
version through `npx`; a session uses the standalone skill checkout.
