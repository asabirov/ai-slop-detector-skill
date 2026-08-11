# AI Slop Detector

Canonical reference for the `apliteni:ai-slop-detector` skill: the full rule catalogue,
the danger levels, how to run it, and how to add a rule. The agent-facing entry point is
`skills/ai-slop-detector/SKILL.md`; this page is the human reference behind it.

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
| 2 | `recommended` | + strong, high-precision structural and phrase tells (`warning`). | Default. Every artifact, every iteration. |
| 3 | `strict` | + opinionated stylistic tells and density-gated vocabulary. | Landing, launch post, hero surfaces. |
| 4 | `paranoid` | + statistical rules that may false-positive. | Deep pre-launch audit. |

`error` findings fail the run (exit `1`); `warning` findings never do (exit `0`). Level 1
is all errors, so it is the block; levels 2–4 add warnings, so they are the polish.

## Run it

```bash
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js <file>
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js src scripts --level 1
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js 'src/**/*.js' --json
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
| `fake-uri` | 1 | error | Fake protocol URI (`lessly://c4/goal`) — links to nothing. |
| `mono-noncode` | 1 | error | Monospace font on prose or a label — fake-terminal decoration. |
| `system-font` | 1 | error | `system-ui` / `-apple-system` as the first family — no typeface chosen. |
| `external-link-arrow` | 1 | error | Diagonal `↗` open-in-new-tab arrow on a link — decorative cosplay. |
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
| `vocab-density` | 3 | warning | ≥3 inflated terms (robust, seamless, leverage…) clustered in one paragraph. |
| `empty-transition-density` | 3 | warning | ≥3 sentence-initial `Moreover / Furthermore / Additionally`. |
| `bold-header-list` | 3 | warning | `**Header:** text` markdown list items — the top formatting tell. |
| `em-dash-density` | 4 | warning | Em-dashes above human baseline (>2 per 100 words). |
| `low-burstiness` | 4 | warning | Metronomic sentence length (low variance). |

Vocabulary is **density-gated** — flagged only when several inflated terms cluster in one
paragraph. One "robust" is fine; a pile of them is machine register. This is the single
biggest false-positive killer, and the reason single-word puffery does not fire on its own.

### Comments pack — source files

The slop here is the comment: a design document written into the file being edited,
because the project offered nowhere else to put an argument. It has no date, no author and
no reviewer, and it starts going stale the moment the code around it moves.

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `comment-essay` | 1 | error | One block carrying 25+ prose lines. |
| `comment-chaptered` | 1 | error | A block of 8+ lines split by an interior divider or a shouted section heading. |
| `comment-long` | 2 | warning | One block carrying 12–24 prose lines. |
| `comment-ratio` | 2 | warning | More than one prose line per two lines of code (files of 20+ code lines). |

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

**The fix is always the same.** Move the rationale into an ADR or the project docs, and
leave a one-line pointer where it was: `// why: docs/adr/0007-name.md`. The comment keeps
what the code cannot say. The argument goes where it can be reviewed, dated and superseded.
Deleting it instead is the one wrong answer — a `comment-essay` usually holds something
real, and silencing the rule by cutting the text throws that away.

## The detector fires on its own documentation

Run it over `SKILL.md` or this page and it reports `fake-uri`, `negative-parallelism`,
`world-opener` and the rest. Every one of those is a rule quoting the pattern it catches,
which is why CI lints `scripts/` and `bin/` and leaves the prose alone. Do not "fix" these
by deleting the examples — a catalogue that cannot name what it catches is worth less than
a clean run.

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
{ id: 'kebab-id', level: 1 | 2 | 3 | 4, severity: 'error' | 'warning',
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
node --test skills/ai-slop-detector/scripts/*.test.js
```

The suite runs in CI (`.github/workflows/ci.yml`), so a rule that breaks coverage or trips
a clean fixture fails the build.

## Disagree with a rule, or want to tune it?

The rule set is a shared contract — everyone's audit stays consistent only if the rules
stay the same for everyone. So don't fork or silence rules locally. If you think a rule is
wrong, too aggressive, missing, or should sit at a different level, **open an issue in this
repo** ([lessly-hub/claude-lessly-plugin](https://github.com/lessly-hub/claude-lessly-plugin/issues/new)):

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

The rules live once, in `skills/ai-slop-detector/` of this repository, and they are not
published anywhere. An agent in a session is the only thing that runs them.

That is a deliberate limit, and it has a cost worth stating: an `error` here stops a commit
only because whoever is committing ran the linter and fixed what it said. No build fails on
its own. A repository that wants the rules enforced without a person in the loop has to
carry its own copy of `scripts/` and `bin/` — the shape apliteni-ui already uses for
`brand.generated.css`, where a generated file is synced in and a `--check` script goes red
when the copy falls behind. Nobody has needed that yet.
