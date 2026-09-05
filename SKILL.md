---
name: ai-slop-detector
description: "Use when reviewing or polishing prose, UI, or code comments for generic AI phrasing, empty claims, or decorative clutter, and before presenting a finished artifact with those symptoms."
---

# AI Slop Detector

Make the artifact clearer and more specific while preserving its meaning, voice,
and useful detail. Judge the work itself; never infer who or what wrote it.

## One focused pass

Review the requested surface once. For an edit, inspect changed content and enough
surrounding context to understand it. For a new artifact, inspect the whole artifact.
Use content already available in the session; read files only when needed. Routine
conversation and untouched files do not need an automatic audit.

Apply the rules relevant to the surface:

1. **Say something concrete.** Replace vague praise and inflated claims with supplied
   facts, actions, or outcomes. Remove a claim that adds nothing. When a necessary
   claim lacks evidence, flag the gap; never invent a number, benefit, or guarantee.
2. **Get to the substance.** Cut stock openings, flattery, repeated conclusions,
   and rhetorical framing that delays the point. Keep contrasts that explain a real
   distinction. Preserve uncertainty when the evidence is uncertain.
3. **Give presentation a purpose.** Flag decoration when it misleads or obstructs
   reading: fake addresses, numbers suggesting a nonexistent sequence, or labels
   adding no information. Fonts, colors, punctuation, and layout patterns alone
   are insufficient grounds for a finding. Respect intentional design choices.
4. **Keep useful comments.** Explain constraints, reasons, and surprising behavior.
   Remove narration of obvious code. Keep safety and maintenance context beside
   the code that needs it; length or section dividers alone do not justify moving it.
5. **Preserve what works.** Keep facts, qualifications, terminology, quotations,
   technical values, and the author's voice. Choose the smallest edit that helps
   the reader. Leave an already effective passage alone.

Example: given only that a product exports CSV in three steps, replace
“Unlock a seamless export experience” with “Export CSV in three steps.”

For each finding, identify the passage or element, the reader's problem, and a
specific correction. Discard findings based only on resemblance to a template.
For visual findings, inspect the relevant rendered view when available; state
when the review covers source only.

When asked to edit, apply corrections within the authorized scope. When asked to
review, report actionable findings without editing. Check corrected passages for
meaning and local consistency, then stop. Another full pass needs new substantive
changes or an unresolved problem. Return the revised content or a short list of
findings; if nothing needs changing, say so. Skip scores and ritual checklists.

## Optional CLI

Use the bundled detector when requested, when the repository requires it, or when
many files justify a mechanical scan. A normal editorial pass needs no CLI,
network, installation, or additional agent.

With Node 20 or newer, resolve the command relative to this skill directory:

```bash
node <skill-dir>/bin/slop-detector.js <file> --json
```

The CLI retains its existing rules and exit codes, including opinionated style
errors. It can disagree with editorial judgment. Preserve required CI checks;
report a rule conflict instead of weakening the artifact or bypassing the gate.
For batch scanning, CSS coverage, exit codes, or rule development, read the bundled
[CLI reference](docs/ai-slop-detector.md) only when needed.
