# ai-slop-detector

A deterministic linter for AI slop: the decorative machine-tells that read as
generated even when the content is right. It scores HTML, markdown, plain text
and source files, at four levels of strictness, and every finding names a
concrete fix.

## The choice this makes

**Chosen:** one repository that is both the npm package `@apliteni/slop-detector`
and the source of the `apliteni:ai-slop-detector` skill, with a GitHub Action
that syncs the skill into `apliteni/claude-apliteni-plugin`. Gives up: a rule
change now lands in two places, and the sync can fall behind.

**Turned down:** leaving it inside the plugin, where it lived until now. Why not:
a Claude Code plugin installs into a directory named after its version, so
nothing outside a session could ever install the rules. Two repositories had
already copied the files by hand, and one of them pruned three files out of its
copy to get past CodeQL.

**Turned down:** a git submodule inside the plugin. Why not: the plugin loader
clones the repository and does not fetch submodules, so the skill directory
would arrive empty.

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

Four levels, each a superset of the one below: `ban`, `recommended` (default),
`strict`, `paranoid`. Only `error` findings exit non-zero, so level 1 is the
merge gate and the higher levels are polish.

`docs/ai-slop-detector.md` is the full rule catalogue and the human reference.
`SKILL.md` is the agent-facing entry point, and it is the file the sync Action
copies into the plugin.

## Running it

In a repository's CI, or anywhere with Node 20:

```bash
npx @apliteni/slop-detector dist --level 1
npx @apliteni/slop-detector src scripts --level 1
npx @apliteni/slop-detector 'src/**/*.js' --json
```

In a Claude Code session with the `apliteni` plugin installed:

```bash
node $CLAUDE_PLUGIN_ROOT/skills/ai-slop-detector/bin/slop-detector.js <path>
```

In this repository:

```bash
npm test           # the unit tests and the fixtures
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
| Any repository's CI | `npx @apliteni/slop-detector`, or a dev dependency on it. |
