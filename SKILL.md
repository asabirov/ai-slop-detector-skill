---
name: ai-slop-detector
description: "Check a finished artifact before delivering it and report what to fix: empty claims, stock phrasing, decorative clutter, narrated code comments. Covers prose, UI and code. Use when asked to check for AI slop. Reports findings; does not rewrite for readability (humanize)."
---

# AI Slop Detector

Make the artifact clearer and more specific without changing its meaning, voice, or useful detail. Judge the work itself; do not infer who or what wrote it.

## One focused pass

Review the requested surface once. For edits, inspect changed content and enough surrounding context to understand it. For new artifacts, inspect the whole artifact. Use content already available in the session; read files only when needed. Do not automatically audit routine conversation or untouched files.

Apply the relevant rules:

1. **Say something concrete.** Replace vague praise and inflated claims with supplied facts, actions, or outcomes. Remove claims that add nothing. If a necessary claim lacks evidence, flag the gap; never invent numbers, benefits, or guarantees.
2. **Get to the substance.** Cut stock openings, flattery, repeated conclusions, and rhetorical framing that delays the point. Keep contrasts that explain real distinctions and preserve uncertainty when the evidence is uncertain.
3. **Give presentation a purpose.** Flag decoration that misleads or obstructs reading, such as fake addresses, numbers implying a nonexistent sequence, or labels with no information. Fonts, colors, punctuation, and layout alone are not enough. Respect intentional design.
4. **Keep useful comments.** Explain constraints, reasons, and surprising behavior. Remove narration of obvious code. Keep safety and maintenance context beside the code that needs it; length or dividers alone do not justify moving it.
5. **Preserve what works.** Keep facts, qualifications, terminology, quotations, technical values, and voice. Make the smallest helpful edit and leave effective passages unchanged.

Example: given only that a product exports CSV in three steps, replace “Unlock a seamless export experience” with “Export CSV in three steps.”

For each finding, identify the passage or element, the reader's problem, and a specific correction. Discard findings based only on resemblance to a template. For visual findings, inspect the relevant rendered view when available and state when the review covers source only.

When asked to edit, apply corrections within the authorized scope. When asked to review, report actionable findings without editing. Check corrected passages for meaning and local consistency, then stop. Do another full pass only for new substantive changes or an unresolved problem. Return the revised content or a short list of findings; if nothing needs changing, say so. Skip scores and ritual checklists.

## Optional CLI

Use the bundled detector when requested, required by the repository, or justified by many files. A normal editorial pass needs no CLI, network, installation, or additional agent.

With Node 20 or newer, resolve the command relative to this skill directory:

```bash
node <skill-dir>/bin/slop-detector.js <file> --json
```

The CLI keeps stable exit codes and shared UI rules, including opinionated style findings. Native font stacks and numeric table data are allowed. It can disagree with editorial judgment. Preserve required CI checks; report a rule conflict instead of weakening the artifact or bypassing the gate.

For batch scanning, CSS coverage, exit codes, or rule development, read the bundled
[CLI reference](docs/ai-slop-detector.md) only when needed.
