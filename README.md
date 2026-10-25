# ai-slop-detector

An agent skill and optional command-line linter that help developers review prose, interfaces, and code comments for empty claims and distracting presentation.

This project combines editorial judgment with deterministic checks. It does not require scans after every edit or ban certain styles unconditionally: necessary safety comments and intentional native UI fonts should remain acceptable during review.

![CLI demo: a chatbot greeting fails the ban level; clean prose passes with exit code zero](assets/demo.svg)

## Quick start

You need Node.js 20 or newer and Git. The detector has no dependencies to install.

```bash
git clone https://github.com/asabirov/ai-slop-detector-skill.git
cd ai-slop-detector-skill
node bin/slop-detector.js fixtures/slop.md --level 1
node bin/slop-detector.js fixtures/clean.md --level 1
```

The first scan reports `sycophancy-opener` and exits **1**. That failure is expected, because the sample holds a chatbot greeting. The second scan reports `PASS` and exits **0**. Replace the fixture path with a file or directory to scan your own work.

## Why it exists

AI-assisted drafts can keep chatbot greetings, vague claims, and comments that only describe the code. The skill finds specific problems in a finished artifact. The optional command-line tool finds repeatable patterns across files and gives stable exit codes for CI. Neither tool can prove who wrote the work.

## Install, update, roll back, and remove

Install the tagged skill for Claude Code and Codex:

```bash
DO_NOT_TRACK=1 npx skills add https://github.com/asabirov/ai-slop-detector-skill/tree/v2.9.0 --skill ai-slop-detector --agent claude-code codex --global
```

`DO_NOT_TRACK=1` stops the skills tool from sending telemetry. The installer needs Node.js, npm and Git. It puts the skill in `~/.agents/skills/ai-slop-detector` and links it into `~/.claude/skills`. The command-line tool is in the same folder:

```bash
node ~/.agents/skills/ai-slop-detector/bin/slop-detector.js <path>
```

To update or roll back, run the install command again with another release tag. The [releases page](https://github.com/asabirov/ai-slop-detector-skill/releases) lists the newest tag. To remove the skill:

```bash
DO_NOT_TRACK=1 npx skills remove ai-slop-detector --agent claude-code codex --global
```

Without `npx skills`, clone the repository at the `v2.9.0` release tag into your agent's skills folder as `ai-slop-detector`. To update or roll back, run `git fetch --tags` there and check out another tag. To remove it, delete the folder.

After each release, a workflow opens a pull request that renames the tags in this file. Until that pull request merges, the tags here name the last release it covered.

## Using the skill

The agent checks its work before it opens a pull request or sends other finished work. It does not check routine chat replies. You can also ask: "check this README for AI slop". The skill makes one focused pass. It reports the passage, the reader's problem and a specific correction. [SKILL.md](SKILL.md) holds the agent instructions, including the editorial checks for interface copy. The skill never runs a command or reviews untouched files on its own.

## What the command-line tool checks

Three rule packs share one engine:

- **Visual** reads markup and the CSS a page applies. It finds fake protocol URIs, monospace used as decoration, emoji headings, gradients, glow shadows, nested cards, oversized stats, multi-word buttons, repeated field captions, duplicate status badges, and an explanatory line placed under or beside a table or chart.
- **Text** reads visible prose and the attributes a person reads, such as `title`, `alt` and `placeholder`. It finds "not just X, but Y", sycophancy, clusters of inflated words, and a reply that repeats the message before it.
- **Comments** reads source files. It finds design documents written into code comments.

There are four levels. Each level adds rules to the one below: `ban`, `recommended` (the default), `strict` and `paranoid`. Only `error` findings give a non-zero exit code. Level 1 is the merge gate and the higher levels are polish.

The [reference](docs/ai-slop-detector.md) lists every rule with its level and severity. It also covers the text parser, the coverage limits of the UI rules, and how to extend the tool.

## Running it in CI

Pin a release tag. An unpinned run follows `main`, and a rule that gets stricter can fail a build that passed yesterday.

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#v2.9.0" src scripts --level 1
npx -y "$REPO#v2.9.0" 'src/**/*.js' --json
```

There is no npm package. `npx` installs from this repository, so the runner needs network access to GitHub.

JavaScript and TypeScript files skip the visual rules by default, and the output says how many files skipped them. To check interface copy in such a file, add `--as artifact`. The code is then read as prose, which can cause false positives.

## Check that it works

```bash
npm test           # unit tests and fixtures
npm run lint:self  # the detector must pass its own rules
npm run verify     # both of the above, the script CI runs
```

To change a rule, open an issue that names the rule `id` and shows the case. [AGENTS.md](AGENTS.md) has the rules for changing the code. The demo image above comes from `python3 docs/render-demo.py > assets/demo.svg`.

## License

[MIT](LICENSE).
