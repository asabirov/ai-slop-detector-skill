---
name: ai-slop-detector
description: "Pointer, not the linter. The AI-slop linter no longer ships in this plugin — it lives in asabirov/ai-slop-detector-skill and runs straight from there. Read this to install it or to run it in CI; it cannot score anything itself. Trigger on: ai slop, slop check, slop detector, install the slop detector, how do I run the linter, does this look ai-generated."
---

# AI Slop Detector — not installed here

This plugin used to carry the linter's source. It does not any more, because a plugin
installs into a directory named after its version, so nothing outside a Claude Code session
could install the rules. Two repositories copied the files by hand instead, and one deleted
three rule files out of its copy to get past CodeQL.

**This page cannot lint anything.** It says where the linter is and how to get it.

## In a session

Clone it where Claude Code looks for personal skills, then restart the session:

```bash
git clone https://github.com/asabirov/ai-slop-detector-skill.git \
  ~/.claude/skills/ai-slop-detector
```

The skill loads as `ai-slop-detector`, and its `SKILL.md` is the real one: a focused editorial
pass with five core rules. The CLI is optional for editorial work; run it when
requested or required by the repository:

```bash
node ~/.claude/skills/ai-slop-detector/bin/slop-detector.js <path> --level 2
```

Update it with `git pull` in that directory. Nothing here updates it for you.

## In CI, or once and away

No checkout, no copy of the rules in your repository. There is no npm package; `npx`
installs from the repository, so the runner needs network and GitHub:

```bash
npx -y github:asabirov/ai-slop-detector-skill#v2.0.0 <path> --level 1
```

Pin the tag. Unpinned tracks `main`, and a rule that tightens fails a build that passed
yesterday. `v2.0.0` was current when this page was generated; the newest is on the
[releases page](https://github.com/asabirov/ai-slop-detector-skill/releases).

Level 1 is the merge gate: hard bans only, exit 1 on any of them. Levels 2 to 4 add
warnings that never fail a run.

## Disagree with a rule

Open an issue in
[asabirov/ai-slop-detector-skill](https://github.com/asabirov/ai-slop-detector-skill/issues/new),
naming the rule `id`, the case it fires on, and what you would change. The rule set is a
shared contract; a repository that silences a rule locally is auditing to different rules
than everyone else.
