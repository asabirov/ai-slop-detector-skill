# ai-slop-detector

A focused editorial skill with an optional deterministic linter for HTML,
markdown, plain text, and source comments.

The skill uses five rules and one pass over the requested surface. The CLI keeps
its existing rule packs and CI contract. Mandatory scans after every edit and
unconditional style bans were rejected for the skill: necessary safety comments
and intentional native UI fonts should survive an editorial review.

The personal skill is installed from this repository. The plugin ships an
installation pointer. Keeping the detector here also lets CI pin the same source.

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
  system-font defaults, emoji headings, the purple-blue hero.
- **Text** reads visible prose plus the attributes a person actually reads
  (`title`, `alt`, `placeholder`, `aria-label`, `data-tip`, the meta
  description). Catches "not just X, but Y", hedge openers, sycophancy residue,
  clustered inflated vocabulary.
- **Comments** reads source files. Catches the design document an agent files
  into a code comment because the project gave it nowhere else to write one.

Code is not prose. Fenced blocks and inline code spans come out of a document
before the rules that judge decoration read it, so a page can quote the pattern
it explains. Spans are matched the way CommonMark matches them, a run of N
backticks closing only on a run of N, and the HTML sniff is taken after that
removal so a markdown file naming `<style>` in backticks is still markdown.

Four levels, each a superset of the one below: `ban`, `recommended` (default),
`strict`, `paranoid`. Only `error` findings exit non-zero, so level 1 is the
merge gate and the higher levels are polish.

`docs/ai-slop-detector.md` documents the optional CLI. `SKILL.md` is the personal
skill entrypoint. The sync Action copies `plugin-stub.md` into the plugin.

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
skills. The `apliteni` plugin ships a page pointing here and none of the code:

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

## Changing a rule

The rule set is a shared contract. Do not fork it, and do not silence a rule in
the repository that trips over it. Open an issue here naming the rule `id`,
showing the case, and saying what you would change.

A rule change is tested both ways: a triggering case goes into a slop fixture,
and every `fixtures/clean.*` must stay silent at paranoid. If a new rule makes a
clean fixture fire, the rule is wrong, not the fixture.

## Where the copies are

| Consumer | How it gets the rules |
| --- | --- |
| `apliteni/claude-apliteni-plugin` | A pointer page at `skills/ai-slop-detector/SKILL.md` and the reference at `docs/ai-slop-detector.md`, both written by `.github/workflows/sync-plugin.yml` in this repo. Not the rules. Do not edit them there. |
| Any repository's CI | `npx -y github:asabirov/ai-slop-detector-skill#<tag>`, or a dev dependency on the git URL. |

### Why the plugin gets a pointer

The plugin shipped the whole linter until
[apliteni/claude-apliteni-plugin#82](https://github.com/apliteni/claude-apliteni-plugin/issues/82)
— 18 files, 164K. A plugin installs into a directory named after its version, so
nothing outside a Claude Code session could reach the rules that way, and two
repositories copied the files by hand instead. One of them deleted three rule files
out of its copy to get past CodeQL.

The removal used to wait on publishing to npm. Dropping npm unblocked it: `npx
github:<repo>#<tag>` gives a session and a CI job the same route without a registry,
and `SKILL_PAGE` in `sync-plugin.yml` moves the page and the code together.

The change here is one word. `SKILL_PAGE` in
`.github/workflows/sync-plugin.yml` goes from `skill` to `stub`, and that single
value picks the page *and* drops `bin/`, `scripts/`, `fixtures/` and `package.json`
from the copy. Both halves move together, so the plugin cannot end up carrying a
stub and the code, or the real page and no code. Run it either way to see:

```bash
node tools/render-skill.js . /tmp/plugin asabirov/ai-slop-detector-skill "$(git rev-parse HEAD)" stub
```

An unrecognised value exits 2 rather than shipping a half-built directory.
