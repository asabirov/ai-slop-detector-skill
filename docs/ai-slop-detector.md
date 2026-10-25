# AI Slop Detector

Reference for the optional deterministic CLI in `asabirov/ai-slop-detector-skill`.
For editorial review, follow `SKILL.md`. The CLI retains opinionated rules and
severities for compatibility with existing CI gates; its findings are not universal
judgments about good writing or design. The workflow advice below applies when
using that CLI, not to every editorial pass. The one exception is the fresh-reader
check for marketing copy, which `SKILL.md` points to.

## What it does

Catches AI **slop** — the decorative machine-tells that read as AI-generated even when the
content is right — in HTML, markdown, and plain text. It is a deterministic linter: same
input, same output, every finding explainable with a concrete fix. It is the adversarial
counterpart to writing and design guidance. Build from that guidance; run this as the last gate.

**It is not an "is-this-AI?" classifier.** That problem is probabilistic, unexplainable,
and false-positive-prone, and must never drive a decision about a person. This tool claims
only that a surface *reads as templated*, and tells you exactly where and how to fix it.

**Core principle:** structure and ornament must encode something true about the content,
never decorate it. A URI implies a real address; monospace implies code; a number implies
a sequence; an inflated adjective implies a claim. When the form makes a promise the
content doesn't keep, it reads as machine filler.

## Levels of danger

Strictness is tiered. Each level is a superset of the one below — pick by how much the
surface matters.

| Level | Name | What it adds | Use for |
|-------|------|--------------|---------|
| 1 | `ban` | Blocking rules. All `error`, except `mono-noncode`, which is a `warning`. | Required CI gates. |
| 2 | `recommended` | + strong, high-precision structural and phrase tells (`medium`, `warning`). | Default for a requested CLI scan. |
| 3 | `strict` | + opinionated stylistic tells and density-gated vocabulary. | Landing, launch post, hero surfaces. |
| 4 | `paranoid` | + statistical rules that may false-positive. | Deep pre-launch audit. |

There are three severities and two outcomes. `error` findings fail the run (exit `1`);
`medium` and `warning` findings never do (exit `0`). Level 1 is errors, except `mono-noncode`,
which is a warning, so level 1 is the block; levels 2–4 add the rest, so they are the polish.

`medium` and `warning` findings need contextual review. A pattern match establishes
what the rule detected, not whether its suggested edit helps the reader. Keep
necessary technical detail and intentional style. Required CI errors remain
blocking; report a rule conflict instead of bypassing the gate.

The verdict names the loudest thing present: `fail`, then `review` (a medium), then `warn`,
then `pass`.

## Run it

Straight from the source repository, which is how a repository's CI runs it. There is no
npm package, so `npx` installs from GitHub and the runner needs network. Pin a release tag.
An unpinned run tracks `main`, and a rule that tightens fails a build that passed yesterday.
The README names a recent tag, and the newest is on the
[releases page](https://github.com/asabirov/ai-slop-detector-skill/releases).

```bash
REPO=github:asabirov/ai-slop-detector-skill
npx -y "$REPO#<tag>" <file>
npx -y "$REPO#<tag>" src scripts --level 1
npx -y "$REPO#<tag>" 'src/**/*.js' --json
```

To use the skill in an agent, install it with `npx skills add` as the README shows. The CLI
is then at `~/.agents/skills/ai-slop-detector/bin/slop-detector.js`.

Arguments are files, directories (walked) or globs. Each file is routed by its extension —
`.html`/`.md`/`.txt` to the visual and text packs, source files to the comments pack.
CSS and component files also receive visual checks, without prose scoring. The option
`--as source|artifact` overrides that. Git-ignored files are skipped (`--no-git-ignore` to
stop that), and `--ignore 'vendor/**,*.gen.js'` drops more: a gate that reports findings in
build output is a gate nobody can act on.

`scripts/detect.js` takes exactly one file and is the older entry point; `bin/slop-detector.js`
is the same engine over many.

## Text parser and decoding

Text reaches a rule decoded. The table is the standard's own, in `scripts/lib/entities.js`. So `&middot;`,
`&nbsp;` and `&#8599;` reach a rule as the characters a browser shows.

Four places outside the text streams also decode. The `style` attribute decodes before the visual
rules read it as CSS. A MathML `annotation-xml` encoding value decodes before the parser compares it with
`text/html`. The heading markup that `emoji-heading` and `heading-period` read in `scripts/rules/visual.js`
decodes. So do the label and heading text that `labelsAboveHeadings` in `scripts/lib/html.js` reads.
Standalone CSS keeps references literal.

One pass resolves an entity, and it runs last, after the tags or the markdown syntax are
gone, so nothing reads what it produced: `&#38;middot;` is the text `&middot;` on the page
and stays that, and `&#35; x` is a paragraph printing `# x` rather than a heading. Names are
case-sensitive, because `&Aacute;` and `&aacute;` are different letters. A name the standard
does not list, a code point past Unicode's last, and the surrogate range are left as
written, and so are the forms a browser accepts without the semicolon (`&amp` for `&`). The
one stream that drops an unresolved name rather than keeping it is the whole-page prose
stream of an HTML page, which did that before, so no prose rule reads it as a word; the
markdown side keeps it. In Markdown prose, an escaped ampersand stays literal after an odd
number of backslashes. An even number lets the reference decode. Markdown prose accepts
1 to 7 decimal digits or 1 to 6 hexadecimal digits in a numeric reference. Longer forms
stay literal there. Raw HTML blocks use HTML reference rules, including longer numeric forms.
Markdown code syntax does not remove text from raw HTML blocks or readable attributes.

Every prose stream a rule reads — a page's visible runs, its prose, its
paragraphs, its readable attributes, and the same for markdown and plain text —
decodes semicolon-terminated character references, including every HTML5 name and both
numeric forms. So a dotted chain written `&middot;` and one typed with the dot are
the same line. Numeric C1 references use HTML's replacement glyphs, so `&#149;`
reads as `•` and `&#146;` reads as `’`. The scans that read markup for class
names, selectors and tag shapes work on the page as written.
Standalone CSS keeps character references literal. HTML decodes references in
style attributes before the visual rules read them. Quoted attribute data,
including `>`, stays outside visible prose. Readable attributes have separate
prose streams. Each HTML token scan moves forward through comments, tags, and
raw text for its consumer. A quoted closing tag inside an attribute cannot end
hidden script or code content. A trailing slash inside an unquoted attribute
value stays part of that value. It cannot close the element.
A slash flag cannot close a known non-void HTML element. Foreign elements and unknown component names retain self-closing syntax.
Component files, including JSX and TSX, also keep self-closing native tags. Namespace lookups use recorded stack positions.
HTML paragraph starts leave foreign content. An HTML encoding on MathML `annotation-xml` supplies an HTML integration point.
The first encoding attribute supplies its decoded value.
Markdown prose keeps references literal after an odd number of backslashes,
even when the file contains raw HTML. References after an even number decode.
Markdown prose accepts 1 to 7 decimal digits or 1 to 6 hexadecimal digits.
Longer references stay literal in Markdown prose. Inside raw HTML blocks,
HTML decodes them without these Markdown limits. The parser also reads
human-readable attributes in raw HTML, including single-quoted values.
Raw HTML in Markdown still supplies markup and CSS to visual rules. Inline
`<style>` contents count, while commented or fenced styles do not. Inline HTML
keeps its text, so numeric table cells retain the monospace exemption.
The simple Markdown link scanner skips unfinished suffixes without repeated
searches. Lazy list continuations keep their owners without copying the complete stack.
Tests measure public parse growth for unfinished links, raw HTML, and lazy lists.
These checks do not establish a bound for every possible input. Markdown
syntax is removed before references are decoded, so
an encoded bracket cannot turn visible text into a link destination.
The parser excludes script, style, and code
contents from Markdown prose. Autolinks and literal angle-bracket text remain
visible to text rules. A comment marker inside a quoted HTML attribute stays
attribute data. A raw HTML comment can end with `--!>`.
When Markdown escapes that sequence, the comment stays open.
Textarea content keeps tag and comment spellings as text.
Raw HTML blocks can start after completed headings and fences. Script, style,
and textarea state stays active across a Markdown block boundary. A list-shaped
line inside an active fence or raw HTML block keeps that block open. A raw HTML
region ends when its list item ends. The parser determines Markdown leaf blocks
before it reads inline comments, tags, and code spans. Sibling list items end
separate inline blocks, including items numbered `2.` or `02.`.
Blank paragraphs end inline comment candidates, including blank lines inside lists and quotes.
A new ordered list interrupts an open paragraph only with content and a start
value of one, including `01.`. An empty marker cannot interrupt a paragraph.
A line without its list indentation or quote marker can continue a paragraph.
Such a lazy line keeps its list owner. A setext underline must belong to that
owner and retain the quote markers. An unindented `===` stays paragraph text
inside a list. An ATX or setext heading ends its inline block before the next
paragraph starts. A fence treats extra quote markers as content after it removes
its owning container prefix. Fence indentation expands tabs at source columns
before it removes that prefix. Five spaces after a list marker leave four
spaces of code indentation. Short `<!-->` and
`<!--->` comments end before later code spans. Backticks in tags and comments
do not open code spans. In raw HTML blocks, script and style closing tags can
contain quoted `>` characters, attributes, or a trailing slash. A quote inside
an unquoted attribute value stays data and does not hide the next `>`.
This also applies after an equals sign inside that value.
A rejected Markdown closing candidate cannot consume a nested valid close.
Inline raw closes accept a form-feed separator. Vertical tab and nonbreaking space are not
closing-tag separators. The text parser remains approximate for malformed HTML
tags across a blank line and unfinished tags at the end of a file. Malformed
HTML nesting also remains approximate. Some raw HTML block closers with a
different tag name remain a known limit. An unclosed `pre` block can stay hidden
after a list or quote ends.

A code element can stay hidden after a Markdown block boundary, while the new block uses Markdown
reference rules. Markdown code syntax does not take ownership of an earlier comment or textarea.

In markup, `p`, `div`, headings, `span`, `li`, table cells, `section`, `header`,
`footer`, `text`, `a`, `dl`, `dt`, `dd`, and `br` end a visible text run. This keeps
definition values separate. Other tags stay in the surrounding run, so inline
`svg` and `label` content can still complete a chain. This split does not use
CSS layout or a DOM, so it can differ from browser text boundaries. Files not
read as markup use the earlier boundary list, without `dl`, `dt`, `dd`, or `br`.
The boundary names must match complete tags, so `dt-label` and `dd-value` stay inline.
Code is not prose. In Markdown regions, fenced blocks, indented code blocks, and inline code spans come out
before decoration rules read them. Raw HTML blocks and readable HTML attributes keep backticks as text.
Spans use matching runs of N backticks, and the HTML sniff runs after Markdown code removal. A Markdown
file that names `<style>` in a code span stays Markdown. An escaped backtick stays visible, and a fenced
block inside a blockquote stays code.

`--level` accepts a number (`1`–`4`) or a name (`ban`, `recommended`, `strict`,
`paranoid`). `--json` emits `{ verdict, level, files[], stats }` for chaining.

Two pairs of rules can name the same element for the same reason: `gradient-text` with
`purple-blue-hero`, and `eyebrow-kicker` with `mono-uppercase-label`. The CLI then reports one
finding. The first rule of the pair keeps it and the finding gets an `alsoFlaggedBy` array with
the ID of the second rule. Both rule IDs stay valid. A script that counts findings by the second
rule ID finds fewer, and an allowlist for the first ID also hides the folded finding.

### Static UI coverage

Visual rules also read standalone `.css`, quoted `style` attributes, and literal
`class` / `className` attributes in HTML, JSX, TSX, Vue, Svelte, and Astro.
Supported Tailwind utilities cover gradients and color stops, text clipping,
backdrop blur, radii, typography, alignment, borders, and bounce animation.
Selected arbitrary values (radius, shadow, easing, blur, size, background) are
read directly. Conditional variants, computed class expressions, custom utility
configuration, JSX style objects, and CSS variable resolution need generated CSS.
Color utilities at shades 300–700 use representative palette hues. Other shade
values are left unresolved so pale backgrounds do not count as saturated accents.
The scanner does not implement cascade, layout, or contrast calculations.

### How `nested-cards` decides

`nested-cards` counts a `card`, `panel`, or `tile` class only when an applied
declaration gives the element a border, background, or box shadow. A rounded
element with one of those styles also counts, even without a card-like class.
The rule expands the side values in `border-width`, `border-style`, and
`border-color` across CSS whitespace outside color functions. An omitted
`border-width` uses the initial medium width when a visible style is set.
The rule checks border styles outside color functions, so a missing color
channel does not disable a solid border. It ignores transparent color tokens,
nonpainting background shorthands with numeric positions, sizes, and empty
layers. This includes `50% 50% transparent`, `center / 100% 100% transparent`,
and `none, none transparent`. It recognizes unsigned decimal zero alpha in
RGB, HSL, HWB, Lab, LCH, OKLab, OKLCH, and `color()` values. Signed zero,
exponent forms, and missing alpha channels remain outside this check.
It checks shadow lengths outside balanced
color functions and ignores shadows with zero geometry. Complex color
expressions remain painted when their final alpha is unknown.
Class names alone do not establish a painted card.
This static check cannot resolve inherited styles, complex selectors, later
cascade resets, or dynamic classes. Review those cases in the rendered page.

### Built HTML and linked CSS

Relative stylesheet links resolve against the HTML file. Root-relative links
resolve against the directory argument or `--root`. For a built page:

```bash
node <skill-dir>/bin/slop-detector.js dist/index.html --root dist --no-git-ignore --json
```

Use `--no-git-ignore` when build output is ignored. Explicitly named directories
can be scanned, but nested build/vendor directories and minified files are skipped.
A missing or remote stylesheet produces `css-unreadable` at level 2 and above;
level 1 does not report that coverage gap. Report unread CSS as incomplete coverage,
not proof that the page is clean. Inspect or obtain missing assets when the task
requires a complete visual check.

## Rule catalogue

Three packs, one engine. Structural tells are weighted above vocabulary because vocabulary
lists decay every model generation (delve → showcasing → …) while structure holds. `id`
values are stable — reference them in allowlists and PR notes.

### Visual pack — markup and CSS

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `fake-uri` | 1 | error | Fake protocol URI (`acme://goal`) — links to nothing. Skips code. |
| `mono-noncode` | 1 | warning | Monospace font on prose or a label — fake-terminal decoration. |
| `external-link-arrow` | 1 | error | Diagonal `↗` open-in-new-tab arrow on a link — decorative cosplay. Skips code. |
| `table-footnote` | 1 | error | An explanatory line under a table or a chart — basis, source, exclusion or an “as of” date. |
| `table-aside` | 1 | error | A lede, subtitle or basis line set beside the heading that names a table or a chart. |
| `css-unreadable` | 2 | medium | A linked stylesheet could not be read, so its CSS rules did not run. |
| `middot-chain` | 2 | warning | `a · b · c` metadata chain — templated polish. |
| `middot-two-facts` | 2 | warning | One value holding two facts (`4 April · 3 days late`, `Unpaid · 3 days overdue`) — a number on each side with the words around them changing, or a word or two facing a number that opens its side. |
| `decor-numbering` | 2 | warning | `01 — label` eyebrow where the number indexes nothing. |
| `eyebrow-kicker` | 2 | warning | Uppercase wide-tracked micro-label pre-announcing a heading. |
| `emoji-heading` | 2 | warning | Emoji as a section marker, standing in for type hierarchy. |
| `purple-blue-hero` | 2 | warning | The default purple→blue gradient hero. |
| `ai-palette` | 2 | warning | Warm-cream (`#F4F1EA`) + terracotta — the most common AI palette. |
| `heading-italic` | 3 | warning | Italicised word inside a heading — decorative polish. |
| `heading-period` | 3 | warning | Short display heading ending in a lone period (`Ship it.`). |
| `decor-bullet-dot` | 3 | warning | Empty colored round element prefixing a label — encodes nothing. |
| `radius-monotony` | 4 | warning | One `border-radius` on every surface — templated sameness. |
| `multiword-control` | 2 | warning | A button-like control has a multi-word visible label, except a verb followed only by `all`. An icon-only control's accessible name (`aria-label` or screen-reader-only text) is never read. |
| `inset-accent-marker` | 2 | warning | A 2px-or-more inset stripe on one side repeats another selection marker — a chromatic border or outline anywhere in the element's cascade, or a chromatic background on a selector that itself names a selection state (`.active`, `.selected`, `.current`, `[aria-selected]`, `[aria-current]`, `:checked`). |
| `repeated-field-caption` | 2 | warning | The same short caption, after its field, appears under three or more distinct fields. Never a radio or checkbox's own label. |
| `restated-status-badge` | 2 | warning | A badge repeats the page title (compared page-wide) or a same-section heading or field value. |
| `marker-explainer` | 2 | warning | A sentence only explains an accent marker. Silent inside a figure, a chart-class container, a legend, or a plain container that also holds a `<canvas>`. |
| `restated-control-period` | 2 | warning | A period caption repeats the one `nM`, `nY` or `nD` control selected in its nearest enclosing container. |
| `restated-table-count` | 2 | warning | A simple count line (an optional leading "Showing") repeats the number of body rows — excluding header and footer rows — in the next table. |
| `context-noun-control` | 2 | warning | A `Clear all` label repeats the noun in its `noun-bar` or `noun-toolbar` container class. |
| `restated-title-subline` | 2 | warning | A short `p` or `small` line right after a heading names the heading noun again and adds no digit, verb, proper noun, time or condition. |
| `gradient-text` | 2 | warning | Gradient clipped into text is decorative emphasis. |
| `ai-gradient` | 2 | warning | Pink, violet and purple gradient combinations are a common generated UI default. |
| `glow-shadow` | 2 | warning | A colored zero-offset shadow creates a decorative halo. |
| `glassmorphism` | 2 | warning | Backdrop blur is a common decorative glass effect. |
| `nested-cards` | 2 | warning | Painted cards inside painted cards add redundant containers. Class names alone do not count. |
| `bounce-easing` | 2 | warning | Bounce or elastic motion adds ornamental overshoot. |
| `accent-bar` | 3 | warning | A colored side stripe decorates a container boundary. |
| `pill-radius` | 3 | warning | Pill-shaped buttons or cards can become a default shape without a purpose. |
| `big-number-stat` | 3 | warning | Oversized numeric stats can substitute a hero template for useful evidence. |
| `emoji-icon` | 2 | warning | An isolated emoji stands in for a designed icon. |
| `family-ceiling` | 4 | warning | More than three primary font families can fragment a type system. |
| `stock-display-face` | 4 | warning | Inter or Space Grotesk as a display face is a common default worth reviewing. |
| `mono-uppercase-label` | 3 | warning | Tracked uppercase monospace labels imitate terminal chrome. |
| `accent-budget` | 4 | warning | Several unrelated accent colors can obscure emphasis. |
| `hairline-grid` | 4 | warning | Repeated hairline boxes in a grid can make every item look like the same card. |
| `double-edge` | 4 | warning | Repeated boxes separate themselves with both a border and a fill. |
| `button-drift` | 4 | warning | Several unrelated button sizes or radii weaken control consistency. |
| `everything-centred` | 4 | warning | Centering most of a page weakens the alignment hierarchy. |
| `stock-palette` | 4 | warning | Near-black with acid green, or cream with terracotta and serif type, are common generated palettes. |

`restated-control-period` reads numeric period tokens and their explicit selected
state. It compares `nM`, `nY` or `nD` with a caption naming the previous, last,
past, prior or trailing number of months, years or days. `context-noun-control`
reads `Clear all <plural>` labels inside a matching `noun-bar` or `noun-toolbar`
class.
`repeated-field-caption` only matches a caption of five words or fewer. The
count rule accepts only a short count and scope line; it leaves extra
instructions such as an approval deadline alone.

`multiword-control` and `context-noun-control` read a `<button>`, anything
with `role="button"`, a submit/button/reset `<input>`, or an `<a>` carrying a
`btn`/`button` class — not a plain `<a href>`. A link styled only by the
surrounding page (no button role or class) is left to the editorial rule.

`table-footnote` reads position, not wording. The data above it is a `<table>`, a
tag ending in a data word (`DataTable`, `LineChart`, `BarGraph`), or a container
whose class names a chart (`chart`, `graph`, `plot`, `sparkline`) — either as the
element directly before the candidate, or as the last child of a plain wrapper
around one. Last child, not anywhere inside: an article body with a table in the
middle is not a table.

It fires when the element under that data either states a basis in four words or
more, or is set subordinate to the data in six or more. A basis is what the
numbers are counted in, what they exclude, how they were rounded, an “as of”
date, or a `Source:`. Set subordinate means a `<small>`, a tag naming a note,
basis, hint, footnote or disclaimer (`<Basis>`, `<TableNote>`), or a class naming
one of those plus caption, help, fineprint, muted, subtle or meta — on the
element, or on anything prose-bearing inside it.

These stay silent: a count line by its shape (`Showing 1 to 10 of 57 entries`), a
chart legend and a product description (neither `legend` nor `description` is a
marker), a `<caption>` or `<figcaption>` element unless it states a basis rather
than naming its figure, a candidate that carries its own heading or its own table, a
`<section>`, `<nav>`, `<footer>` or `<main>`, and a line whose prose is under the
floor once the words inside its links and buttons are removed — which is what a
pager is.

A control's own feedback is outside the styling half of both rules. A line with
`role="status"`, `role="alert"`, `aria-live="polite"` or `"assertive"` can carry feedback.
The parser reads actual attributes. It does not treat quoted text, a token list
(`role="status alert"`), or a JSX expression (`role={"status"}`) as a live region.

Without a live region, the sentence must start with an action that matches a
control in the same block. The supported pairs are Save/Saving, Change/Changing,
Move/Moving, Select/Selecting, Choose/Choosing, Submit/Submitting, Send/Sending,
Filter/Filtering, and Search/Searching. Move booking also matches Saving because
the reported booking action saves the new room or time. The parser reads nested
visible button text and the value of a submit or button input. It reads quoted
and unquoted `type` and `value` attributes at their actual boundaries. Hidden
button text and SVG metadata do not name the action. A link does not count as a
control.

Feedback exempts its own line only. Completion can name numeric, quoted, and
longer booking groups. A clause that lists or shows records is a data note.
A different note in the same wrapper still counts, including inside a nested
live region. Text outside a live region does not change its feedback exemption.
Inline children form one prose line.
Button text and live-region text do not become part of that prose. Styling on
the note still counts when its words are in an inline child.
For example, an Export button does not hide
`<small class="text-muted"><span>Updated nightly, so yesterday stays open.</span></small>`.
A basis stated in words counts even inside a live region or its wrapper.

A `<ul>`, a `<dl>` and a bare `<svg>` are out of the rule, measured rather than
assumed. Over 1,264 HTML files on one machine, every `<ul>` an earlier draft
reached was a navigation menu or an ordinary bulleted list with the next paragraph
after it (65 hits, none real), and every bare `<svg>` was an illustration with its
caption under it (395 hits, none real). A `<p class="cloud-paragraph-align-right">`
matched the chart class, because `paragraph` contains `graph`. A chart drawn as an
unclassed `<svg>` is therefore missed here, as is a note that sits outside the card
holding its table. The editorial check in `SKILL.md` still covers a list and a
chart, because a reader can tell a data list from a menu and this parser cannot.

`table-aside` is the same test read forwards. The candidate is a line between
an `h2`–`h6` and the data that heading names: the heading's following siblings, or,
when the heading and the line share a head row whose class says so (`head`,
`header`, `heading`, `hd`, `title`), that row's next sibling. The data is found on
the first-child chain, the mirror of `table-footnote`'s last child. At most two
lines sit between a heading and its data, and a candidate over 40 elements is
content rather than a line.

Beside a heading a total, a count, a unit and a control all sit legitimately, so
the line has to say what it is. Each floor is measured on the line carrying the
marker, not the row holding it. It fires when that line either names itself a
basis, note, footnote, disclaimer or fineprint, at any length; or is a `<small>` or
carries a class naming a sub, subtitle, subheading, description, lede, lead, dek,
standfirst, tagline, intro, hint, help, muted, subtle or small, on three words or
more ending in `.`, `!` or `?`; or states a basis by wording, the five patterns
`table-footnote` uses, on three words or more.

These stay silent: an `<h1>`, which names the page; a `<small>` holding a unit
(`EUR`, `ms, p95`); a `caption` or a `meta` class, because a caption above its
figure belongs there and `meta` is a byline; a count line by shape; a list; a link
or a button; a candidate carrying its own heading or data; and the table in the
next grid column or table cell, which is what the head-row class test keeps out.

A page lede under the page title is out of reach when a row of controls sits between the
`<h1>` and the first table. `SKILL.md` covers it editorially. A group subtitle that a JSX
expression renders is reached only in a rendered page.

New UI checks are warnings, `table-footnote` and `table-aside` excepted: they are
the merge gate because two reviewers ran `--level strict` over real screens
and got a pass.
Aggregate checks use conservative thresholds: more
than three primary font families, at least three distinct accents, three
hairline-bordered grid items, five border-plus-fill rules, or three button sizes
or radii. Centering warns on a document root or four elements covering at least
a third of the page, unless left/start/justify alignment exists. Display-face
checks only inspect explicit headings or type at least 48px; choosing Inter for
body text is allowed. Structural counts resolve simple tag, class, and ID
selectors; complex selectors and inherited styles need rendered review.

### Text pack — prose

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `sycophancy-opener` | 1 | error | Chat residue (`Certainly!`, `I'd be happy to…`) leaked into copy. |
| `reply-echo` | 2 | warning | A thanked-for clause repeats details from an adjacent `Incoming:` line. |
| `negative-parallelism` | 2 | warning | `not just X, but Y` / `it's not X, it's Y` — the top structural tell. |
| `hedge-opener` | 2 | warning | `it's important to note`, `at its core`, `when it comes to`. |
| `world-opener` | 2 | warning | `in today's fast-paced world / digital age` scene-setting. |
| `formulaic-closer` | 2 | warning | Paragraph opening `In conclusion / In summary / Overall,`. |
| `scope-template` | 2 | warning | `whether you're a X or a Y` / `from X to Y` enumerating-scope cliché. |
| `meta-label-opener` | 2 | warning | `Here's how it works:` / `Our recommended tier:` — the outline's label, shipped as copy. |
| `plainness-boast` | 3 | warning | `straight answers`, `no fluff`, `in plain English` — copy advertising its own candour. |
| `vocab-density` | 3 | warning | ≥3 inflated terms (robust, seamless, leverage…) clustered in one paragraph. |
| `empty-transition-density` | 3 | warning | ≥3 sentence-initial `Moreover / Furthermore / Additionally`. |
| `bold-header-list` | 3 | warning | `**Header:** text` markdown list items — the top formatting tell. |
| `em-dash-density` | 4 | warning | Em-dashes above human baseline (>2 per 100 words). |
| `low-burstiness` | 4 | warning | Metronomic sentence length (low variance). |

`reply-echo` reads adjacent `Incoming:` and `Reply:`, `Comment:`, or `Message:`
lines. It also accepts `(RU)` and `(EN)` after each label. It needs two shared
content words in a “Thanks for” or “Спасибо, что” clause joined with “and” or
“и”. A brief acknowledgement stays silent. Different wording can hide a recap,
so review the conversation when the lines are not in the file.

Prose means prose wherever a reader meets it. The text pack reads the visible text **and**
the human-readable attributes — `title`, `alt`, `placeholder`, `aria-label`, `data-tip` — plus
the meta description. It used to read only the first: stripping tags with `<[^>]+>` deletes an
attribute along with the tag it sits in. On one pricing page that hid 26 values and 324 of
the page's 934 words — the entire compare table — and the gate called the page clean at
paranoid while its owner called it slop. Addresses and identifiers
(`href`, `src`, `class`, `id`) are still not prose, and a one-word value is a control name.

Vocabulary is **density-gated** — flagged only when several inflated terms cluster in one
paragraph. One "robust" is fine; a pile of them is machine register. This is the single
biggest false-positive killer, and the reason single-word puffery does not fire on its own.

### Comments pack — source files

The slop here is the comment: a design document written into the file being edited,
because the project offered nowhere else to put an argument. It has no date, no author and
no reviewer, and it starts going stale the moment the code around it moves.

| id | Level | Severity | Tell |
|----|-------|----------|------|
| `comment-chaptered` | 1 | error | 8+ comment lines with one heading or interior divider in a single block, or two in total across joined blocks. |
| `comment-essay` | 2 | medium | One block carrying 12+ prose lines. |
| `comment-ratio` | 2 | warning | More than one prose line per two lines of code (files of 20+ code lines). |

For `comment-chaptered` only, blocks separated by exactly one blank line
(including whitespace-only lines) form one document. Code or two or more blank
lines end the run. Separator lines do not count toward the 8-line floor, and
headings and interior dividers are counted across the blocks. A single block
of 8+ lines requires at least one signal and keeps firing inside a joined run;
qualification through joining requires at least two signals.
One title in a joined run is a label; two chapter signals make chapters.
Dividers framing an individual block remain frames; joining does not turn them
into chapters.
`comment-essay` still measures individual blocks, and `comment-ratio` is unchanged.

**Length is `medium`, and chaptering is the only ban.** Chaptering is a shape: a comment
either has an interior divider or it does not, so a gate can be certain about it. Length is
a population, and the pack has no honest place to cut it. Measured across twelve
repositories, 1,511 comment blocks carry 12 or more prose lines, and the mass
of them sits at 12–17 — so a ban anywhere in that range draws a line through the middle of
one population rather than at its edge, and calls two sides of a distribution by two
different names. `comment-essay` covers all of it at one severity instead: certain about
what it found, and not a merge blocker.

The pack measures shape, never wording, and it is deliberately blind to the things a
comment is for. API tag lines (`@param`, `@returns`) never count toward length, so a fully
documented signature costs nothing. A divider on the first or last line **frames** a
comment — the CSS banner-header convention — while a divider in the middle **chapters**
one, and only the second fires. A trailing `// note` is not a block at all, because the
first non-space character of the line has to open the comment.

Two candidate rules were measured against a 12,708-line codebase and dropped. A
`restates-code` rule (a comment that only repeats the line under it) fired twice, and both
were false positives. An argument-marker density rule ("which is why", "the obvious
implementation", "that has happened twice") caught six blocks whose average length was 92
lines — every one of them already caught by `comment-essay`. Length and chaptering carry
the whole signal; vocabulary adds noise.

Languages: `//` and `/* */` (JS/TS, Go, Rust, Java, C-family, SCSS), `#` (Python, shell,
YAML, TOML, Ruby), and CSS block comments.

Review what the comment contributes before following the CLI's suggested move.
Keep constraints needed to maintain the adjacent code. Move broader decision
history to an issue or project docs only when that improves its usefulness, and
leave a pointer. Preserve the information in either case.

## Fresh-reader check for marketing copy

Run this when asked to test marketing lines, or when a line's problem or product promise seems unclear. It is the one check that needs another agent or a person.

1. Get the author's stated problem and what the product concretely does. If either is missing, ask; do not infer it from the copy.
2. Give a fresh reader (a person or an agent with no prior product context) only the exact copy being checked, without the ground truth, explanation or suggested answer. Ask: “What problem is this? What exactly does the product do about it? Do you believe it, and why? What is vague, confusing or hype?” Keep each candidate in a separate fresh context.
3. Compare with the author's facts. A line passes when the reader correctly states the problem and what the product does, and finds no hype, overclaim, unexplained jargon or gap between them. Scope questions such as “which login methods?” do not fail a line; note them for the rest of the page.
4. Report each line, the reader's answers, pass or fail, and why. Without a fresh reader or ground truth, report the check as incomplete.

## The detector reads its own documentation

Every markdown file this repo ships is scored at level 1 by the test suite, and passes. A
catalogue explains a rule by quoting what it catches, so put the example in a code span or
a fenced block: `fake-uri` and `external-link-arrow` do not read there. That is the whole
exemption, and it is per span, so a stray backtick earlier in the file does not shift it.

Above level 1 these documents still warn — `negative-parallelism` and `world-opener` fire
on the sentences that name those patterns, in prose where quoting them would read as
pedantry. Warnings exit 0. Do not "fix" either kind by deleting the example: a catalogue
that cannot name what it catches is worth less than a clean run.

## Deliberate exceptions

A false positive that nags is itself slop. Warnings are defaults to follow-or-justify, not
gates. When a warning fires on a genuinely deliberate choice, record the reason in the PR
(never in the artifact) and move on. If a rule is simply wrong, fix the rule — see below.

Native UI fonts are valid choices. The `system-font` rule was
removed, so no rule flags a native font stack. All other IDs and exit codes are unchanged. `mono-noncode` permits
numeric content in table cells, including descendant spans.

## Extending it

Rules live in `scripts/rules/visual.js`, `scripts/rules/ui.js`, and `scripts/rules/text.js`. Adding one is a
one-line push into the pack; nothing in `detect.js` changes. A rule is:

```js
{ id: 'kebab-id', level: 1 | 2 | 3 | 4, severity: 'error' | 'medium' | 'warning',
  why: 'why this reads as slop', fix: 'the concrete fix',
  test(ctx) { /* ctx: { html, isHtml, css, runs, styleBodies, cssRules, text, paragraphs } */
    return [/* one string per occurrence */]; } }
```

Before adding a rule, it must earn its place — high signal, and a pattern you can point to
in real AI output — and it must be tested both ways:

1. Add a triggering case to a slop fixture. `scripts/detect.test.js` asserts every rule
   fires in at least one fixture.
2. Confirm `fixtures/clean.html` and `fixtures/clean.md` stay silent. If a new rule makes
   the good page fire, the rule is too aggressive — fix the rule, not the good page.

```bash
npm run verify
```

That runs the suite and then `npm run lint:self`, and it is the script the
required `test` check on `main` runs, so a rule change that breaks the suite
cannot merge. Paste its full output in the PR: the check says pass or fail and
nothing about which assertions ran.

## Disagree with a rule, or want to tune it?

The rule set is a shared contract — everyone's audit stays consistent only if the rules
stay the same for everyone. So don't fork or silence rules locally. If you think a rule is
wrong, too aggressive, missing, or should sit at a different level, **open an issue in the
source repo**
([asabirov/ai-slop-detector-skill](https://github.com/asabirov/ai-slop-detector-skill/issues/new)):

- name the rule `id` (e.g. `heading-period`),
- show the case it fires on (or misses), and
- say what you'd change — remove it, re-level it, or narrow the pattern.

Rule changes land through a PR with the fixture updated both ways (the new case fires, the
clean fixtures stay silent), so the change is reviewed and can't quietly regress. A one-off
deliberate choice doesn't need an issue — record the reason in your PR and move on; open an
issue only when the rule itself should change for everyone.

## Where it fits

The visual and text packs were built for a launch-copy audit gate: the pass every
customer-facing surface clears before a public launch. They are grounded in a 2025–2026
survey of AI-slop detection (Wikipedia "Signs of AI writing", the *Measuring AI Slop*
taxonomy, slop-gate, Vale).

The comments pack was added when the same agents that write the copy turned out to be
writing design documents into source files — 33% of the lines in one repository were comments,
and its longest single comment block ran to 117 lines.

The rules live in `asabirov/ai-slop-detector-skill`. A CI job uses a pinned git
version through `npx`; a session uses the standalone skill checkout.
