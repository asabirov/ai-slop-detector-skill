---
name: ai-slop-detector
description: "Use after generating or editing ANY artifact a human will read — HTML page, mockup, landing, deck, dashboard, markdown doc, lifecycle email, product-UI copy — AND after writing or editing source code, to catch AI 'slop': the visual machine-tells (fake protocol URIs, monospace-as-decoration, system-font defaults, purple-blue and cream-terracotta palettes, emoji headings, middot chains, decorative numbering, external-link ↗ arrows), the text tells (not-just-X-but-Y, 'in today's fast-paced world', hedge openers, sycophancy residue, inflated-vocabulary density, em-dash overuse, metronomic sentences), and the code-comment tells (essay-length comment blocks, chaptered comments with dividers, prose density above one line per two lines of code). Deterministic, runnable, four levels of strictness. Complements voice (text register) and design (constructive). Trigger on: ai slop, slop check, remove ai slop, visual slop, text slop, comment slop, verbose comments, slop detector, does this look ai-generated, machine-generated look, before publishing a page or mockup or deck, before committing code, launch copy audit, on-brand check."
added: 2026-07-28
---

# AI Slop Detector

The adversarial check that an artifact didn't drift into machine-generated defaults.
`voice` and `design` are the constructive side — what good copy and good design are.
This is the linter that catches what slipped through: the decorative tech-cosplay and
templated tells that read as AI-generated even when the content is right.

**Core principle:** structure and ornament must encode something true about the content,
never decorate it. A URI implies a real address; monospace implies code; a number implies
a sequence; an inflated adjective implies a claim. When the form makes a promise the
content doesn't keep, it reads as machine filler.

**What it is NOT:** an "is this AI-generated?" classifier. That problem is probabilistic,
unexplainable, and false-positive-prone (GPTZero, Pangram, Binoculars) — it must never
drive a decision about a person. This tool claims only "this *reads as* templated," and
every finding is explainable with a concrete fix.

## When to use

Run it **after every iteration** of a customer- or agent-facing artifact, before you show
or ship it — same discipline as running `voice` on the copy: generate → detect → fix →
re-detect. An artifact with an `error`-level hit is not ready to publish.

Covers HTML, markdown, and plain text (landing, docs, decks, dashboards, product UI,
error/empty states, lifecycle email). Not for: internal Slack/ClickUp notes, PR
descriptions, commit messages.

It also covers **source files**, where the slop is the comment. An agent that has nowhere
to record an argument records it in the file it is editing, and the result is a design
document with no date, no author and no reviewer, going stale from the moment the code
around it changes. Run it before you commit; when it fires, the fix is to move the
rationale to the issue where the decision was argued — project docs if there isn't one —
and leave a one-line pointer behind.

## Levels of danger

Each level is a superset of the one below. Pick by how much the surface matters.

| Level | Name | Adds | Use for |
|-------|------|------|---------|
| 1 | `ban` | Hard bans only — things that are **always** slop. All errors. | The merge gate. Never negotiable. |
| 2 | `recommended` | + strong, high-precision structural & phrase tells (warnings). **Default.** | Every artifact, every iteration. |
| 3 | `strict` | + opinionated stylistic tells, density-gated vocabulary. | Landing, launch post, hero surfaces. |
| 4 | `paranoid` | + statistical rules that may false-positive (em-dash rate, burstiness). | Deep pre-launch audit. |

Three severities, two outcomes: `error` findings fail the run (exit 1); `medium` and
`warning` never do (exit 0). Level 1 is all errors; levels 2–4 add the rest. So level 1 is
the block, higher levels are the polish.

`medium` is for a finding a rule is sure of but will not gate a merge on — louder than a
warning, and not an invitation to disagree with it. The verdict names the loudest thing
present: `fail`, `review`, `warn`, `pass`.

## Run it

In a session, from the plugin's copy:

```bash
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js <file>                 # level 2 (default)
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js src scripts --level 1  # a tree, hard bans only
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js 'src/**/*.js' --json
```

In a repository's CI, from npm, with no copy of the rules checked in:

```bash
npx @apliteni/slop-detector dist --level 1
```

### A page's CSS is read from the files it links

Seven visual rules read `ctx.css`, and two of them are level-1 bans. A bundled site keeps
its CSS in a `<link>`, so reading only `<style>` blocks scored **59 bytes of a page that
ships 100,339** — and that page passed at every level, paranoid included, while carrying 8
`mono-noncode` errors nobody could see (lessly-hub/lessly#732).

Linked stylesheets are now resolved from disk. A relative href resolves against the page's
own directory; a root-relative one (`/_astro/app.css`) resolves against the directory you
named, or `--root <dir>`. So point it at the built site:

```bash
slop-detector dist --level 1                      # hrefs inside dist/ resolve
slop-detector dist/index.html --root dist --level 1
```

**A stylesheet it cannot open is a finding, not a silence.** `css-unreadable` (medium,
level 2) fires when a page links CSS the linter could not read, and says so rather than
scoring zero: *"2 linked stylesheets unread — CSS rules did not run"*. A remote href cannot
be read at all; fetch it next to the page first. This rule exists because the silent
version of that answer is indistinguishable from a clean pass, and shipped as one.

**A shared sheet is judged against the page that links it.** One stylesheet serves every
page on a site, so a selector no element on this page carries is not this page's defect.
`mono-noncode` checks the selector reaches the markup; `eyebrow-kicker` goes further and
matches the element itself, because a kicker is defined by sitting above a heading rather
than by any declaration. Its finding quotes the label and the heading under it
(*"COMPLY" above "Keep it compliant while it runs"*), so you can act on it without opening
the CSS.

Arguments are files, directories (walked) or globs. Each file is routed by its extension:
`.html`/`.md`/`.txt` to the visual and text packs, source files to the comments pack.
`--as source|artifact` overrides. Git-ignored files are skipped unless you pass
`--no-git-ignore`, and `--ignore 'vendor/**'` drops more.

The rules live in `asabirov/ai-slop-detector-skill` and are published as
`@apliteni/slop-detector`. This copy inside the plugin is generated from that repo by a
GitHub Action, so a repository that wants the gate in CI installs the package rather than
copying the files. Two repositories carried hand-made copies before it was published, and
one of them had already deleted three files out of its copy.

Exit code `1` on any `error`. `--json` emits `{verdict, level, files[], stats}` for
chaining, where `stats` counts `errors`, `medium` and `warnings`. Fix every error; treat
medium findings as work to do and warnings as strong defaults unless you have a deliberate
reason — and record that reason (see below).

## What it flags

Three rule packs. Structural tells are weighted above vocabulary because vocabulary decays
every model generation (delve → showcasing → …) while structure ("not just X, but Y")
stays stable.

**Visual** (markup/CSS): `fake-uri`, `mono-noncode`, `system-font`, `external-link-arrow`
(bans) · `css-unreadable`, `middot-chain`, `decor-numbering`, `eyebrow-kicker`,
`emoji-heading`, `purple-blue-hero`, `ai-palette` · `heading-italic`, `heading-period`,
`decor-bullet-dot` · `radius-monotony`.

**Text** (prose — visible text plus the human-readable attributes `title`, `alt`,
`placeholder`, `aria-label`, `data-tip` and the meta description): `sycophancy-opener` (ban) · `negative-parallelism`, `hedge-opener`,
`world-opener`, `formulaic-closer`, `scope-template`, `meta-label-opener` · `vocab-density`,
`plainness-boast`,
`empty-transition-density`, `bold-header-list` · `em-dash-density`, `low-burstiness`.

**Comments** (source files): `comment-chaptered` (ban) · `comment-essay` (medium) ·
`comment-ratio`.

Vocabulary is **density-gated** — flagged only when ≥3 inflated terms cluster in one
paragraph. One "robust" is fine; a pile of them is machine register.

The comments pack measures shape, never wording, and it excludes what a comment is for:
API tag lines (`@param`, `@returns`) never count toward length, a divider that frames a
comment is not a divider that chapters one, a rule must carry to the end of its line so a
dot leader inside a table is content rather than a chapter break (issue #64), and a
trailing `// note` is not a block. What
is left is prose — and past a couple of dozen lines of it, you are reading a document that
somebody filed in the wrong place.

| Rule | Severity | Fires when |
|---|---|---|
| `comment-chaptered` | error | a block of 8+ lines is split by an interior divider or a shouted section heading |
| `comment-essay` | medium | one block carries 12+ prose lines |
| `comment-ratio` | warning | a file holds more than one prose line per two lines of code |

Chaptering is the only ban here. It is a shape — the divider is there or it is not — so a
gate can be certain of it. Length is a population with no honest place to cut it, so it is
one rule at one severity from 12 lines up (issue #59).

## Deliberate exceptions

A false positive that nags is itself slop. When a warning is a deliberate choice — a hero
that genuinely uses one em-dash, an engineering doc that legitimately says "robust" once —
the density gates already let single uses pass. If a rule still fires on an intentional
choice, **record the reason** in the PR (not in the artifact) and move on. Never silence a
rule by weakening the artifact to dodge it; fix the rule if it's wrong (see below).

`error`-level bans have no deliberate-use case. There is no good reason for a fake `app://`
URI or a system-font default in a shipped surface, and none for a comment with chapters —
a thing with chapters is a document, and a document has a home where it can be reviewed.

`fake-uri` reads prose only. A real scheme quoted as a technical value — `neo4j://`,
`postgres://`, `s3://` — passes inside a code span or a fenced block, which is where a
document that means it puts it (issue #64). The rule is after ornament, and ornament does
not live in a code block. In prose the rule allows the schemes a reader's browser resolves
— `http`, `https`, `ftp`, `ws`, `wss`, `file` — because its charge is that the URI links to
nothing, and `file:///Users/x/a.png` opens the file (RFC 8089, issue #631).

`sycophancy-opener` reads bare "here is" as an opener only where a paragraph opens. A line
break inside a paragraph is a wrap, not a sentence start, and reading one as a start failed
the gate on every wrapped line beginning "here is" (issue #632).

A `medium` is not a warning you get to record a reason for. It is work you have not done
yet, and it does not block the merge only because the argument it names is worth keeping.

## Relationship to other skills

- **voice** — judges *what the text says* and its register (Notarial-Warm/Founder/Plain/
  Terse). This skill catches *surface tells* voice doesn't score. A polished artifact passes
  both.
- **design** — the constructive source of truth (brand tokens, typography, layout). This
  skill is the adversarial check that the build didn't drift into the defaults design warns
  against.

Order: build with `design` + `voice`, then run `ai-slop-detector` as the last gate.

## Extending it

Rules live in `scripts/rules/{visual,text,comments}.js`. Adding one is a one-line push
into the pack — nothing in `detect.js` changes. The pack a rule joins decides which context
it reads, and the registry stamps the `kind` on it. Each rule is:

```js
{ id: 'kebab-id', level: 1|2|3|4, severity: 'error'|'warning',
  why: 'why this reads as slop', fix: 'the concrete fix',
  test(ctx) { return [/* string hit per occurrence */]; } }
```

`ctx` for the visual and text packs: `{html, isHtml, css, runs, styleBodies, cssRules,
text, paragraphs}`. For the comments pack: `{lines, blocks, commentLines, proseLines,
codeLines}`, where each block carries `{start, end, len, prose, dividers, headings, first}`.

Disagree with a rule, or want it re-leveled or removed? The rule set is a shared contract —
don't fork or silence it locally. Open an issue in `asabirov/ai-slop-detector-skill`
(name the rule `id`, show the
case, say what you'd change). Details: `docs/ai-slop-detector.md` § Disagree with a rule.

Before adding a rule, it must earn its place (high signal, cite where the pattern appears
in real AI output) and it must be **tested both ways**:

1. Add a triggering case to a slop fixture — `scripts/detect.test.js` asserts every rule
   fires in at least one fixture.
2. Confirm every `fixtures/clean.*` stays silent at paranoid. If a new rule makes the good
   file fire, the rule is too aggressive — fix the rule, not the good file.

```bash
npm test          # unit tests + fixtures
npm run lint:self # the detector must pass its own rules
```

## Common mistakes

- **Treating warnings as blockers.** Only `error` fails the run. Warnings are defaults to
  follow-or-justify, not gates.
- **Cleaning a fixture to make tests pass.** The slop fixtures are supposed to fire. The
  clean fixtures are supposed to stay silent. Never edit a fixture to dodge a test — that's
  deleting the test.
- **Reaching for level 4 by default.** Paranoid rules (em-dash rate, burstiness) false-
  positive on legitimate house style. Use level 2 day-to-day; escalate deliberately.
- **Expecting it to judge quality.** It catches tells, not weak arguments or wrong facts —
  that's human review and `voice`.
- **Deleting the comment instead of moving it.** A comment-essay usually holds something
  real. Silencing the rule by cutting the text throws that away; the fix is to file the
  argument where it can be reviewed and leave a pointer.

## Context

Full rule catalogue and human reference: `docs/ai-slop-detector.md`.

The visual and text packs were built for the launch-copy audit gate
(lessly-hub/lessly#732): the pass every customer-facing surface clears before public-launch
go/no-go. The comments pack was added when the same agents that write the copy turned out
to be writing design documents into source files.
