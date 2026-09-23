# ai-slop-detector

A focused editorial skill with an optional deterministic linter for HTML,
markdown, plain text, and source comments.

The skill uses five rules and one pass over the requested surface. The CLI keeps
shared rule packs and stable exit codes. Mandatory scans after every edit and
unconditional style bans were rejected for the skill: necessary safety comments
and intentional native UI fonts should survive an editorial review.

Install the personal skill from this repository. CI can pin the same source.

## Using the skill

Ask for a slop review or an edit of the artifact. The skill preserves meaning,
voice, and useful technical detail. It reports concrete reader problems and
checks its corrections before stopping. It does not automatically run a command,
install dependencies, or review untouched files.

Read `SKILL.md` for the editorial workflow. Use the CLI below when requested,
required by the repository, or useful for a batch scan. CLI findings retain their
existing severities; editorial judgment does not waive an existing CI gate.

## What it does today

Three rule packs over one engine.

- **Visual** reads markup and the CSS a page applies, including stylesheets it
  links from disk. Catches fake protocol URIs, monospace used as decoration,
  emoji headings, gradients, glow shadows, glass surfaces, nested cards,
  oversized stats, motion and repeated layout defaults. Native font stacks and
  numeric table data are allowed.
- **Text** reads visible prose plus the attributes a person actually reads
  (`title`, `alt`, `placeholder`, `aria-label`, `data-tip`, the meta
  description). Catches "not just X, but Y", hedge openers, sycophancy residue,
  clustered inflated vocabulary.
- **Comments** reads source files. Catches the design document an agent files
  into a code comment because the project gave it nowhere else to write one.
  `comment-chaptered` joins blocks separated by exactly one blank line, with
  no code between them: 8+ comment lines require two headings or interior
  dividers in total to fail level 1. A block of 8+ lines with one signal
  still fails on its own, even inside a joined run.
  One title in a joined run is a label; two chapter signals make chapters.
  Blank separators do not count toward length; individual block frames stay
  exempt. Essay and ratio measurements are unchanged.

Code is not prose. Fenced blocks and inline code spans come out of a document
before the rules that judge decoration read it, so a page can quote the pattern
it explains. Spans are matched the way CommonMark matches them, a run of N
backticks closing only on a run of N, and the HTML sniff is taken after that
removal so a markdown file naming `<style>` in backticks is still markdown.

Four levels, each a superset of the one below: `ban`, `recommended` (default),
`strict`, `paranoid`. Only `error` findings exit non-zero, so level 1 is the
merge gate and the higher levels are polish.

`docs/ai-slop-detector.md` documents the optional CLI. `SKILL.md` is the personal
skill entrypoint.

## Running it

In a repository's CI, or anywhere with Node 20:

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#v2.0.0" dist --level 1        # pin a tag in CI
npx -y "$REPO#v2.0.0" src scripts --level 1
npx -y "$REPO" 'src/**/*.js' --json         # unpinned tracks main
```

There is no npm package. `npx` installs from this repository, so a runner needs
network and access to GitHub. Pin a tag: unpinned tracks `main`, and a rule that
tightens will fail a build that passed yesterday. The tag above is the one that was
current when this line was written; the newest is on the [releases page](https://github.com/asabirov/ai-slop-detector-skill/releases).

In a Claude Code session, from this repository cloned where it looks for personal
skills:

```bash
git clone https://github.com/asabirov/ai-slop-detector-skill.git \
  ~/.claude/skills/ai-slop-detector
node ~/.claude/skills/ai-slop-detector/bin/slop-detector.js <path>
```

In this repository:

```bash
npm test           # the unit tests, the fixtures, and this repo's own prose
npm run lint:self  # the detector must pass its own rules
```

Tests run locally, not in CI. Paste the full `npm test` output and self-lint
result into the PR. CI retains self-lint, release, and CodeQL workflows.

The UI rules use static markup and declaration heuristics rather than a browser
or CSS engine: no runtime dependencies, fast batch scans, and no computed-style
claims. They read standalone CSS, inline styles, and literal Tailwind classes in
HTML, JSX, TSX, Vue, Svelte, and Astro. Dynamic classes, Tailwind configuration,
CSS cascade resolution, and contrast checks need a rendered review. See the
[CLI reference](docs/ai-slop-detector.md) for coverage and thresholds.

## Changing a rule

The rule set is a shared contract. Do not fork it, and do not silence a rule in
the repository that trips over it. Open an issue here naming the rule `id`,
showing the case, and saying what you would change.

A rule change is tested both ways: a triggering case goes into a slop fixture,
and every `fixtures/clean.*` must stay silent at paranoid. If a new rule makes a
clean fixture fire, the rule is wrong, not the fixture.
