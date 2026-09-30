---
name: ai-slop-detector
description: "Use before delivering a finished PR body, issue, UI copy, document or code comment, even unasked. Not for chat replies."
---

# AI Slop Detector

Make the artifact clearer and more specific without changing its meaning, voice, or useful detail. Judge the work itself; do not infer who or what wrote it.

## One focused pass

Review the requested surface once. For edits, inspect changed content and enough surrounding context to understand it. For new artifacts, inspect the whole artifact. Use content already available in the session; read files only when needed. Do not automatically audit routine conversation or untouched files.

Apply the relevant rules:

1. **Say something concrete.** Replace vague praise and inflated claims with supplied facts, actions, or outcomes. Remove claims that add nothing. If a necessary claim lacks evidence, flag the gap; never invent numbers, benefits, or guarantees.
2. **Get to the substance.** Cut stock openings, flattery, repeated conclusions, and rhetorical framing that delays the point. Keep contrasts that explain real distinctions and preserve uncertainty when the evidence is uncertain.
3. **Give presentation a purpose.** Flag decoration that misleads or obstructs reading, such as fake addresses, numbers implying a nonexistent sequence, or labels with no information. Respect intentional design; use the UI checks below for specific presentation problems. Flag a list whose sections use different kinds of category, such as one by priority and one by status. An item can fit several sections but shows up in only one. Group by one kind; use sorting, filters or labels for the rest.
4. **Keep useful comments.** Explain constraints, reasons, and surprising behavior. Remove narration of obvious code. Keep safety and maintenance context beside the code that needs it; length or dividers alone do not justify moving it.
5. **Preserve what works.** Keep facts, qualifications, terminology, quotations, technical values, and voice. Make the smallest helpful edit and leave effective passages unchanged.

Example: given only that a product exports CSV in three steps, replace “Unlock a seamless export experience” with “Export CSV in three steps.”

For each finding, identify the passage or element, the reader's problem, and a specific correction. Discard findings based only on resemblance to a template. For visual findings, inspect the relevant rendered view when available and state when the review covers source only.

When asked to edit, apply corrections within the authorized scope. When asked to review, report actionable findings without editing. Check corrected passages for meaning and local consistency, then stop. Do another full pass only for new substantive changes or an unresolved problem. Return the revised content or a short list of findings; if nothing needs changing, say so. Skip scores and ritual checklists.

## UI and interface copy

Apply these checks to rendered pages and copy files, using labels and surrounding context to distinguish headlines, captions and body text. For source-only reviews, flag identifiable copy problems and leave visual judgments pending a rendered view.

- **Headline full stops.** Flag a terminal full stop on a display headline, such as “Launch your next project.” Remove it: “Launch your next project”. Preserve ordinary sentence punctuation in body copy, quotations, abbreviations and technical values.
- **Middot separators.** Flag UI text that strings separate facts together with middots, such as “Release · Active” or “contact@example.com · Verified”. Separate the label, value and status with layout or use a sentence in copy files. Preserve middots with a semantic meaning, such as multiplication or names.
- **Qualification badge clutter.** Flag repeated “Example data” or “Example workflow” badges on illustrations. Consolidate repeated qualifications into a clear caption covering the relevant illustrations; retain nearby qualifications when separation would mislead. Never remove a needed disclosure just to reduce clutter.
- **Implementation captions.** Flag captions that explain plumbing without helping a user decide, such as “Loads from the video host after you press play”. Remove them, or state a relevant consequence in plain language. Keep useful privacy, consent, accessibility and operational information where the user needs it.
- **Repeated state.** Flag a title or label that restates the value a nearby control already shows as chosen, such as a period selector on “Sep” with a “September 2026” heading beside it. Let the control carry the state; give the heading the subject of the screen, or drop it.
- **The same fact twice.** Flag one fact stated in two places on a screen, such as “Change against August 2026” above the cards and “changes are against August 2026” in the ledger caption below them. Keep it where the reader needs it and delete the other.
- **Explanation wrapped around a live value.** Flag a long sentence built around a number that changes, such as “4 rows would move to Software. Each amount shows how much the move adds to or removes from Software.” Put the count in a short label beside what it counts and let the table show the rest.
- **Tooltip text as a line.** Flag supplementary explanation laid out as visible body text, such as “Compared with August 2026” printed beside the period selector. Move it into the control, its tooltip, or the column header that carries the comparison.
- **Style consistency.** Check each distinct component against the surrounding rendered page, including workflow strips and diagrams. Flag unexplained changes in typography, color, spacing or component treatment; align them with the existing system. A useful diagram can still clash: flag a workflow strip with ornate borders and a new typeface on an otherwise plain page. Keep its content and align its styling; a different content type alone does not justify the mismatch. Preserve intentional functional distinctions supported by context; route uncertain cases to design-review with the component and surrounding view. Copy alone cannot establish a visual mismatch.

The CLI carries a narrow static form of the repeated-state, same-fact, live-value and tooltip checks: a control marked selected in markup, a restatement that repeats a number or date, a line opening on a count, and a helper line opening on a comparison. Selection that only a rendered view shows, and a restatement that shares no value with the line it repeats, are review findings only.

## Fresh-reader check for marketing copy

Run this when asked to test marketing lines, or when a line's problem or product promise seems unclear. It is the one check that needs another agent or a person.

1. Get the author's stated problem and what the product concretely does. If either is missing, ask; do not infer it from the copy.
2. Give a fresh reader (a person or an agent with no prior product context) only the exact copy being checked, without the ground truth, explanation or suggested answer. Ask: “What problem is this? What exactly does the product do about it? Do you believe it, and why? What is vague, confusing or hype?” Keep each candidate in a separate fresh context.
3. Compare with the author's facts. A line passes when the reader correctly states the problem and what the product does, and finds no hype, overclaim, unexplained jargon or gap between them. Scope questions such as “which login methods?” do not fail a line; note them for the rest of the page.
4. Report each line, the reader's answers, pass or fail, and why. Without a fresh reader or ground truth, report the check as incomplete.

## Optional CLI

Use the bundled detector when requested, required by the repository, or justified by many files. A normal editorial pass needs no CLI, network, installation, or additional agent.

With Node 20 or newer, resolve the command relative to this skill directory:

```bash
node <skill-dir>/bin/slop-detector.js <file> --json
```

When scanning UI source, a skipped-visual-rules notice means the copy was not checked. Rerun with `--as artifact` to include it; this also treats code as prose, so check findings in context. CSS and component files already receive visual checks.

The CLI keeps stable exit codes and shared UI rules, including opinionated style findings. Native font stacks and numeric table data are allowed. It can disagree with editorial judgment. Preserve required CI checks; report a rule conflict instead of weakening the artifact or bypassing the gate.

For batch scanning, CSS coverage, exit codes, or rule development, read the bundled
[CLI reference](docs/ai-slop-detector.md) only when needed.
