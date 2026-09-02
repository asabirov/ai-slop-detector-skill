# AI Slop Detector

Canonical reference for the `apliteni:ai-slop-detector` skill and for the linter behind
it, `asabirov/ai-slop-detector-skill`: the full rule catalogue, the danger levels, how to run it, and
how to add a rule. The agent-facing entry point is `SKILL.md`; this page is the human
reference behind it.

Both live in `asabirov/ai-slop-detector-skill`. The copies inside
`apliteni/claude-apliteni-plugin` are generated from there and must not be edited.

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
| 1 | `ban` | Hard bans — always slop. All `error`. | The merge gate. Non-negotiable. |
| 2 | `recommended` | + strong, high-precision structural and phrase tells (`medium`, `warning`). | Default. Every artifact, every iteration. |
| 3 | `strict` | + opinionated stylistic tells and density-gated vocabulary. | Landing, launch post, hero surfaces. |
| 4 | `paranoid` | + statistical rules that may false-positive. | Deep pre-launch audit. |

There are three severities and two outcomes. `error` findings fail the run (exit `1`);
`medium` and `warning` findings never do (exit `0`). Level 1 is all errors, so it is the
block; levels 2–4 add the rest, so they are the polish.

`medium` sits between the two because a rule can be certain about what it found and still
not be worth blocking a merge over. A warning invites you to disagree; a medium does not,
it just isn't the gate. A rule whose text says the content is unreviewable and whose
severity says *ship it anyway* was the specific defect this tier fixes — see issue #59.

The verdict names the loudest thing present: `fail`, then `review` (a medium), then `warn`,
then `pass`.

## Run it

Straight from the source repository, which is how a repository's CI runs it. There is no
npm package; `npx` installs from GitHub, so the runner needs network. Pin a tag — unpinned
tracks `main`, and a rule that tightens fails a build that passed yesterday.

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#v1.0.0" <file>
npx -y "$REPO#v1.0.0" src scripts --level 1
npx -y "$REPO#v1.0.0" 'src/**/*.js' --json
```

From the plugin's copy, which is how a Claude Code session runs it:

```bash
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js <file>
```

Arguments are files, directories (walked) or globs. Each file is routed by its extension —
`.html`/`.md`/`.txt` to the visual and text packs, source files to the comments pack — and
`--as source|artifact` overrides that. Git-ignored files are skipped (`--no-git-ignore` to
stop that), and `--ignore 'vendor/**,*.gen.js'` drops more: a gate that reports findings in
build output is a gate nobody can act on.

`scripts/detect.js` takes exactly one file and is the older entry point; `bin/slop-detector.js`
is the same engine over many.

`--level` accepts a number (`1`–`4`) or a name (`ban`, `recommended`, `strict`,
`paranoid`). `--json` emits `{ verdict, level, files[], stats }` for chaining.

## Rule catalogue

Three packs, one engine. Structural tells are weighted above vocabulary because vocabulary
lists decay every model generation (delve → showcasing → …) while structure holds. `id`
values are stable — reference them in allowlists and PR notes.

### Visual pack — markup and CSS

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `fake-uri` | 1 | error | Fake protocol URI (`lessly://c4/goal`) — links to nothing. Skips code. |
| `mono-noncode` | 1 | error | Monospace font on prose or a label — fake-terminal decoration. |
| `system-font` | 1 | error | `system-ui` / `-apple-system` as the first family — no typeface chosen. |
| `external-link-arrow` | 1 | error | Diagonal `↗` open-in-new-tab arrow on a link — decorative cosplay. Skips code. |
| `middot-chain` | 2 | warning | `a · b · c` metadata chain — templated polish. |
| `decor-numbering` | 2 | warning | `01 — label` eyebrow where the number indexes nothing. |
| `eyebrow-kicker` | 2 | warning | Uppercase wide-tracked micro-label pre-announcing a heading. |
| `emoji-heading` | 2 | warning | Emoji as a section marker, standing in for type hierarchy. |
| `purple-blue-hero` | 2 | warning | The default purple→blue gradient hero. |
| `ai-palette` | 2 | warning | Warm-cream (`#F4F1EA`) + terracotta — the most common AI palette. |
| `heading-italic` | 3 | warning | Italicised word inside a heading — decorative polish. |
| `heading-period` | 3 | warning | Short display heading ending in a lone period (`Ship it.`). |
| `decor-bullet-dot` | 3 | warning | Empty colored round element prefixing a label — encodes nothing. |
| `radius-monotony` | 4 | warning | One `border-radius` on every surface — templated sameness. |

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
| `comment-chaptered` | 1 | error | A block of 8+ lines split by an interior divider or a shouted section heading. |
| `comment-essay` | 2 | medium | One block carrying 12+ prose lines. |
| `comment-ratio` | 2 | warning | More than one prose line per two lines of code (files of 20+ code lines). |

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

**The fix is always the same.** Move the rationale to where the decision was argued — the
issue — and leave a one-line pointer where it was: `// why: #197`. The issue already holds
the measurement, the alternatives and the back-and-forth, dated and attributed, so a
decision record kept beside it is a second copy maintained by hand. Project docs are the
home for anything the issue does not cover. The comment keeps what the code cannot say.

Deleting it instead is the one wrong answer — a `comment-essay` usually holds something
real, and silencing the rule by cutting the text throws that away.

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

`error`-level bans have no deliberate-use case. There is no good reason for a fake `app://`
URI or a `system-ui` default in a shipped Lessly surface.

## Extending it

Rules live in `scripts/rules/visual.js` and `scripts/rules/text.js`. Adding one is a
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
npm test
```

The suite runs in CI (`.github/workflows/tests.yml`), so a rule that breaks coverage or
trips a clean fixture fails the build. The plugin runs the same suite against its
generated copy, which is what catches a bad sync.

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

The rules live once, in `asabirov/ai-slop-detector-skill`, and reach two places: as
`npx`, run from that repository, and as the `apliteni:ai-slop-detector` skill inside
`apliteni/claude-apliteni-plugin`, whose copy a GitHub Action regenerates.

They used to ship only inside the plugin, unpublished, which meant a build could never fail
on its own: an `error` stopped a commit only because whoever was committing had run the
linter and fixed what it said. Two repositories worked around that by copying the files.
`lessly-hub/board.lessly.tech` keeps a byte-identical copy under a hash manifest;
`lessly-hub/compliance.lessly.tech` keeps a pruned one that deleted `scripts/lib/html.js`,
`scripts/rules/visual.js` and `scripts/rules/text.js` to get past CodeQL. Both pin plugin
version `4.0.0`. Installing the package replaces both copies.
