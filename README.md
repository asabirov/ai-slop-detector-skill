# ai-slop-detector

A deterministic linter for AI slop: the decorative machine-tells that read as
generated even when the content is right. It scores HTML, markdown, plain text
and source files, at four levels of strictness, and every finding names a
concrete fix.

## The choice this makes

**Chosen:** one repository that is both the source of the
`apliteni:ai-slop-detector` skill and the thing a CI job runs, installed straight
from GitHub with `npx github:asabirov/ai-slop-detector-skill#<tag>`, plus a GitHub
Action that syncs the skill into `apliteni/claude-apliteni-plugin`. Gives up: a
rule change lands in two places, the sync can fall behind, and a consumer needs
network and GitHub reachable from its runner.

**Turned down:** leaving it inside the plugin, where it lived until now. Why not:
a Claude Code plugin installs into a directory named after its version, so
nothing outside a session could ever install the rules. Two repositories had
already copied the files by hand, and one of them pruned three files out of its
copy to get past CodeQL.

**Turned down:** publishing to npm as `@apliteni/slop-detector`. Why not: it buys
a shorter command and costs an npm org, a token in CI, a release job that can fail
on its own, and a second place the rules exist. `npx github:<repo>#<tag>` runs the
same bin from the same commit. `package.json` is `private`, so nothing publishes it
by accident. Decided by Artur on 2026-09-02.

**Turned down:** a git submodule inside the plugin. Why not: it ships the whole
source repo to every install — 400K and 32 worktree files plus a nested `.git`,
against 152K and 19 today — while the plugin is trying to ship *less* of the
linter, not more. Not for the reason first written here: Claude Code's plugin
loader does clone with `--recurse-submodules --shallow-submodules` and then runs
`git submodule update --init --recursive --depth`, so a submodule would have
arrived populated. Measured against `claude` 2.1.236 on 2026-09-02.

**Decided by:** `lessly-hub/compliance.lessly.tech` and
`lessly-hub/board.lessly.tech` both carry a hand-vendored copy pinned to plugin
version `4.0.0`, and the compliance copy deleted `scripts/lib/html.js`,
`scripts/rules/visual.js` and `scripts/rules/text.js`. Two copies of a shared
rule set had already diverged before anyone published anything.

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

`docs/ai-slop-detector.md` is the full rule catalogue and the human reference.
`SKILL.md` is the agent-facing entry point, and it is the file the sync Action
copies into the plugin.

`plugin-stub.md` is the page that replaces it there once the plugin stops
shipping the linter's source — an install pointer that says where the real one
is, and says in its own description that it cannot lint anything. It does not
ship yet. See "The switch to the stub" below.

## Running it

In a repository's CI, or anywhere with Node 20:

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#v1.0.0" dist --level 1        # pin a tag in CI
npx -y "$REPO#v1.0.0" src scripts --level 1
npx -y "$REPO" 'src/**/*.js' --json         # unpinned tracks main
```

There is no npm package. `npx` installs from this repository, so a runner needs
network and access to GitHub. Pin a tag: unpinned tracks `main`, and a rule that
tightens will fail a build that passed yesterday.

In a Claude Code session with the `apliteni` plugin installed:

```bash
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js <path>
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
| `apliteni/claude-apliteni-plugin` | `skills/ai-slop-detector/`, written by `.github/workflows/sync-plugin.yml` in this repo. Do not edit it there. |
| Any repository's CI | `npx -y github:asabirov/ai-slop-detector-skill#<tag>`, or a dev dependency on the git URL. |

### The switch to the stub

The plugin ships the whole linter today — 19 files, 152K, measured by running the
sync's own copy step into a temporary directory. It should ship a pointer instead,
because a plugin installs into a directory named after its version, so nothing
outside a session can reach the rules that way.
[apliteni/claude-apliteni-plugin#82](https://github.com/apliteni/claude-apliteni-plugin/issues/82)
is that removal. It used to be blocked on publishing to npm; dropping npm unblocked
it, because `npx github:<repo>#<tag>` gives a session and a CI job the same route
without a registry.

The change here is one word. `SKILL_PAGE` in
`.github/workflows/sync-plugin.yml` goes from `skill` to `stub`, and that single
value picks the page *and* drops `bin/`, `scripts/`, `fixtures/` and `package.json`
from the copy. Both halves move together, so the plugin cannot end up carrying a
stub and the code, or the real page and no code. Run it either way to see:

```bash
node tools/render-skill.js . /tmp/plugin asabirov/ai-slop-detector-skill "$(git rev-parse HEAD)" stub
```

An unrecognised value exits 2 rather than shipping a half-built directory.
