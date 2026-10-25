'use strict';

const { subtreeEnds, boundaryText: rawBoundaryText, CHART_CLASS } = require('../lib/table-position');

// A cached declaration pass keeps each rule from reparsing the same stylesheet.
const cache = new WeakMap();
const STATE = /:(?:hover|focus|active|disabled|visited|checked)\b/i;
const MONO = /\b(?:monospace|ui-monospace|menlo|monaco|consolas|courier|[a-z]+ mono)\b/i;
const COLOR_NAMES = { purple: [128, 0, 128], violet: [238, 130, 238], pink: [255, 192, 203], blue: [0, 0, 255], red: [255, 0, 0], green: [0, 128, 0], orange: [255, 165, 0], magenta: [255, 0, 255], cyan: [0, 255, 255], white: [255, 255, 255], black: [0, 0, 0] };
// Page copy names a selection marker by a colour word as often as by the
// designer words "accent"/"inset"; a chart legend saying "line" instead of
// "bar"/"stripe" never matches this, whatever colour it names.
const MARKER_BAR = new RegExp(`\\b(?:accent|inset|${Object.keys(COLOR_NAMES).join('|')})\\s+(?:bars?|stripes?)\\b`, 'i');
// "changed" names something that happened to the marker itself; the bare
// present tense "change"/"changes" is as often an unrelated instruction
// ("change the date") as it is an explanation of the marker.
const MARKER_EXPLAINS = /\b(?:marks?|shows?|indicates?|means?|changed)\b/i;
// A selector that names a selection state, for the background-highlight
// branch of `inset-accent-marker`: an ordinary painted surface is not a
// selected option just because it also carries a colored inset stripe.
const STATE_SELECTOR = /\.(?:active|selected|current)\b|\[aria-(?:selected|current)\b|:checked\b/i;
// A one-side inset stripe, horizontal (`inset <x> 0`) or vertical
// (`inset 0 <y> 0`, a bar above or below), with no blur: the width is
// whichever offset is non-zero.
const STRIPE = /\binset\s+(-?[\d.]+)(px|rem|em)\s+0\b|\binset\s+0(?:px|rem|em)?\s+(-?[\d.]+)(px|rem|em)\s+0\b/;

function colours(value) {
  const out = [];
  const tokens = value.toLowerCase().match(/#[a-f0-9]{3,8}\b|rgba?\([^)]{1,100}\)|\b[a-z]+\b/g) || [];
  for (const token of tokens) {
    if (COLOR_NAMES[token]) out.push(COLOR_NAMES[token]);
    else if (token[0] === '#') {
      let h = token.slice(1);
      if (h.length === 3 || h.length === 4) h = [...h.slice(0, 3)].map((c) => c + c).join('');
      if (h.length === 6 || h.length === 8) out.push([0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)));
    } else if (token.startsWith('rgb')) {
      const parts = token.slice(token.indexOf('(') + 1, -1).split(/[, /]+/).filter(Boolean);
      if (parts.length >= 3) {
        const rgb = parts.slice(0, 3).map((p) => parseFloat(p) * (p.endsWith('%') ? 2.55 : 1));
        if (rgb.every(Number.isFinite)) out.push(rgb);
      }
    }
  }
  return out;
}
function saturation(rgb) {
  const hi = Math.max(...rgb) / 255, lo = Math.min(...rgb) / 255;
  return hi === lo ? 0 : (hi - lo) / (1 - Math.abs(hi + lo - 1));
}
function hue([r, g, b]) {
  const hi = Math.max(r, g, b), lo = Math.min(r, g, b), delta = hi - lo;
  if (!delta) return 0;
  const degrees = hi === r ? (g - b) / delta : hi === g ? (b - r) / delta + 2 : (r - g) / delta + 4;
  return (degrees * 60 + 360) % 360;
}
function chromatic(value) { return colours(value).some((c) => saturation(c) >= 0.45); }
function splitOutsideFunctions(value, delimiter) {
  const parts = [];
  let depth = 0, quote = '', start = 0;
  for (let i = 0; i < value.length; i++) {
    const ch = value[i];
    if (ch === '\\') { i++; continue; }
    if (quote) { if (ch === quote) quote = ''; continue; }
    if (ch === '"' || ch === "'") quote = ch;
    else if (ch === '(') depth++;
    else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0 && (delimiter === 'whitespace' ? /\s/.test(ch) : ch === delimiter)) {
      if (start < i) parts.push(value.slice(start, i));
      start = i + 1;
    }
  }
  if (start < value.length || delimiter !== 'whitespace') parts.push(value.slice(start));
  return parts;
}
function pixels(value) {
  const m = /^([\d.]+)(px|rem|em)$/.exec(value || '');
  return m ? Number(m[1]) * (m[2] === 'px' ? 1 : 16) : 0;
}
function data(ctx) {
  if (cache.has(ctx)) return cache.get(ctx);
  const index = new Map();
  const elements = ctx.elements || [];
  for (const el of elements) {
    for (const key of [el.tag, ...[...(el.classes || [])].map((c) => '.' + c), ...(el.id ? ['#' + el.id] : [])]) {
      if (!index.has(key)) index.set(key, []);
      index.get(key).push(el);
    }
  }
  const rows = (ctx.cssRules || []).filter(([s]) => !s.trim().startsWith('@')).map(([selector, body, element]) => {
    const props = Object.create(null);
    for (const part of splitOutsideFunctions(body, ';')) {
      const colon = part.indexOf(':');
      if (colon < 0) continue;
      const name = part.slice(0, colon).trim().toLowerCase();
      if (!name.startsWith('--')) props[name] = part.slice(colon + 1).trim().replace(/!important$/i, '').trim().toLowerCase();
    }
    return { selector, props, element };
  });
  const inHeading = new Set();
  // The nearest ancestor that scopes a badge to a part of the page, so a
  // title or field far away in a different nav/section/row never counts as
  // "the same state" just because it sits somewhere on the same document.
  const BADGE_SCOPE_TAGS = /^(?:section|nav|article|aside|main|header|footer|form|tr)$/;
  // A heading comparison walks all the way to the document root, because a
  // page title and a badge under it are the same part of the page whatever
  // landmark separates them — `<header><h1>` and a badge nested in
  // `<main><section>`, `<main><article>` or `<main><form>` must still match.
  // The walk stops only at `tr`, `nav` and `aside`, which keep their own
  // scope: a table row's own badge, a nav pill naming the current page, and
  // a help card's own heading, must not read a heading from outside their
  // own row, nav or aside as the page title. A field state keeps the
  // narrower, same-section `sectionOf` below.
  const HEADING_SCOPE_STOP = /^(?:tr|nav|aside)$/;
  const sectionOf = new Int32Array(elements.length).fill(-1);
  const headingScopeOf = new Int32Array(elements.length).fill(-1);
  for (const el of elements) if (/^h[1-6]$/.test(el.tag) || inHeading.has(elements[el.parent])) inHeading.add(el);
  const ends = subtreeEnds(elements);
  const hidden = new Uint8Array(elements.length);
  // Whether a live region (or a descendant of one) owns the element, computed
  // the same way `hidden` is: a prefix array set once per element, read in
  // the rule instead of climbing the parent chain for every candidate, which
  // made `repeated-field-caption` quadratic on deeply nested captions.
  const live = new Uint8Array(elements.length);
  // Whether a figure, a chart-class container or a legend owns the element,
  // computed the same way: a caption inside one of these names what the
  // chart already shows, so a sentence explaining its marker there carries
  // no information a reader does not already have from the chart itself.
  const chart = new Uint8Array(elements.length);
  const fieldId = new Int32Array(elements.length).fill(-1);
  const manyFields = new Uint8Array(elements.length);
  const selectedPeriod = new Int32Array(elements.length);
  const contextNoun = new Array(elements.length);
  const bodyRows = new Uint32Array(elements.length);
  const tableOf = new Int32Array(elements.length).fill(-1);
  const inThead = new Uint8Array(elements.length);
  const inTfoot = new Uint8Array(elements.length);
  const hasTdChild = new Uint8Array(elements.length);
  const containsBadge = new Uint8Array(elements.length);
  // Whether a <header> landmark owns the element: an h1, or any heading
  // inside <header>, is the page title and is compared page-wide; every
  // other heading keeps the narrower, same-section scope a field state uses.
  const inHeader = new Uint8Array(elements.length);
  for (let i = 0; i < elements.length; i++) {
    const el = elements[i], parent = el.parent;
    hidden[i] = (parent >= 0 && hidden[parent]) || el.hidden ||
      [...el.classes].some((c) => /^(?:sr-only|visually-hidden)$/.test(c)) ? 1 : 0;
    live[i] = (parent >= 0 && live[parent]) || el.live ? 1 : 0;
    chart[i] = (parent >= 0 && chart[parent]) || el.tag === 'figure' ||
      [...el.classes].some((c) => CHART_CLASS.test(c) || /(?:^|[-_])legend(?:$|[-_])/.test(c)) ? 1 : 0;
    inHeader[i] = (parent >= 0 && inHeader[parent]) || el.tag === 'header' ? 1 : 0;
    fieldId[i] = /^(?:input|select|textarea)$/.test(el.tag) ? i : -1;
    selectedPeriod[i] = selectedPeriodMonths(el);
    contextNoun[i] = nounFromClasses(el.classes) || (parent >= 0 ? contextNoun[parent] : '');
    tableOf[i] = el.tag === 'table' ? i : parent >= 0 ? tableOf[parent] : -1;
    inThead[i] = el.tag === 'table' ? 0 : el.tag === 'thead' || (parent >= 0 && inThead[parent]) ? 1 : 0;
    inTfoot[i] = el.tag === 'table' ? 0 : el.tag === 'tfoot' || (parent >= 0 && inTfoot[parent]) ? 1 : 0;
    if (el.tag === 'td' && parent >= 0) hasTdChild[parent] = 1;
    sectionOf[i] = parent >= 0 ? (BADGE_SCOPE_TAGS.test(elements[parent].tag) ? parent : sectionOf[parent]) : -1;
    headingScopeOf[i] = parent >= 0 ?
      (HEADING_SCOPE_STOP.test(elements[parent].tag) ? parent : headingScopeOf[parent]) : -1;
  }
  // A header row with no <thead> still has only <th> cells; count only a
  // row that holds at least one <td>, which needs every cell's own tag
  // decided first, so this runs after the forward pass above. A <tfoot>
  // row (a totals row) is excluded the same way a <thead> row is.
  for (let i = 0; i < elements.length; i++) {
    if (elements[i].tag === 'tr' && tableOf[i] >= 0 && !inThead[i] && !inTfoot[i] && hasTdChild[i]) bodyRows[tableOf[i]]++;
  }
  const nextTable = new Int32Array(elements.length).fill(-1);
  const latestTable = new Int32Array(elements.length).fill(-1);
  // The first <table> inside each element's own subtree, so a table wrapped
  // for layout (a responsive `.wrap` div) still counts as the sibling's table.
  const firstTable = new Int32Array(elements.length).fill(elements.length);
  // The first <canvas> inside each element's own subtree, so a chart drawn
  // with <canvas> silences a caption that only shares its own container,
  // not only one named by a chart class or wrapped in <figure>.
  const firstCanvas = new Int32Array(elements.length).fill(elements.length);
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i], parent = el.parent;
    if (el.tag === 'table') firstTable[i] = i;
    if (el.tag === 'canvas') firstCanvas[i] = i;
    if (isBadge(el)) containsBadge[i] = 1;
    if (parent < 0) continue;
    if (firstTable[i] < firstTable[parent]) firstTable[parent] = firstTable[i];
    if (firstCanvas[i] < firstCanvas[parent]) firstCanvas[parent] = firstCanvas[i];
    if (containsBadge[i]) containsBadge[parent] = 1;
    nextTable[i] = latestTable[parent];
    if (firstTable[i] !== elements.length) latestTable[parent] = firstTable[i];
    if (fieldId[i] >= 0) {
      if (fieldId[parent] < 0) fieldId[parent] = fieldId[i];
      else if (fieldId[parent] !== fieldId[i]) manyFields[parent] = 1;
    }
    if (manyFields[i]) manyFields[parent] = 1;
    if (selectedPeriod[i] < 0) selectedPeriod[parent] = -1;
    else if (selectedPeriod[i] > 0 && selectedPeriod[parent] >= 0) {
      if (!selectedPeriod[parent]) selectedPeriod[parent] = selectedPeriod[i];
      else if (selectedPeriod[parent] !== selectedPeriod[i]) selectedPeriod[parent] = -1;
    }
  }
  // One level of climb: a count line nested beside its own heading (for
  // example inside a <header>, next to its <h2>) reaches the table beside
  // that wrapper, not only a table that is the line's own sibling.
  const nextTableOrAbove = new Int32Array(elements.length).fill(-1);
  // The one selected period of an element's nearest enclosing container,
  // pushed down from the bottom-up `selectedPeriod` above: a caption in any
  // sibling wrapper of the control group (a `<footer>` beside a `<div
  // class="chart">`) reads the same period as a caption that is a direct
  // child of that container.
  const periodScope = new Int32Array(elements.length);
  for (let i = 0; i < elements.length; i++) {
    const parent = elements[i].parent;
    nextTableOrAbove[i] = nextTable[i] >= 0 ? nextTable[i] : (parent >= 0 ? nextTable[parent] : -1);
    periodScope[i] = selectedPeriod[i] > 0 ? selectedPeriod[i] :
      selectedPeriod[i] < 0 ? -1 : (parent >= 0 ? periodScope[parent] : 0);
  }
  const result = { rows, elements, index, inHeading, ends, hidden, live, chart, fieldId, manyFields,
    selectedPeriod, contextNoun, bodyRows, nextTable: nextTableOrAbove, sectionOf, headingScopeOf,
    firstCanvas, containsBadge, inHeader, periodScope };
  cache.set(ctx, result);
  return result;
}
function targets(ctx, row) {
  if (row.targets) return row.targets;
  const { elements, index } = data(ctx);
  if (Number.isInteger(row.element)) return (row.targets = elements[row.element] ? [elements[row.element]] : []);
  const out = new Set();
  // Structural counts use simple selectors only; unsupported selectors stay unknown.
  for (const part of row.selector.split(',')) {
    const selector = part.trim();
    if (!/^(?:[a-z][a-z0-9-]*)?(?:[.#][a-z0-9_-]+)*$/i.test(selector)) continue;
    const keys = selector.match(/^[a-z][a-z0-9-]*|[.#][a-z0-9_-]+/gi) || [];
    const candidates = keys.map((k) => index.get(k) || []).sort((a, b) => a.length - b.length)[0] || [];
    for (const el of candidates) {
      if (keys.every((k) => k[0] === '.' ? el.classes.has(k.slice(1)) : k[0] === '#' ? el.id === k.slice(1) : el.tag === k.toLowerCase())) out.add(el);
    }
  }
  return (row.targets = [...out]);
}
function rule(id, level, why, fix, test) { return { id, level, severity: 'warning', why, fix, test }; }
function cssRule(id, level, why, fix, predicate, keyed) {
  return rule(id, level, why, fix, (ctx) => data(ctx).rows.filter((r) => predicate(r.props, r, ctx)).map((r) => {
    const span = r.selector.slice(0, 100);
    return keyed ? { span, keys: selectorKeys(r.selector) } : span;
  }));
}
// What a selector names: each comma part, and each class in it as `class:.name`. Two rules that
// flag the same part or class flag the same element for detect() to fold.
function selectorKeys(selector) {
  const keys = new Set();
  for (const part of selector.toLowerCase().split(',')) {
    keys.add(part.trim());
    for (const cls of part.match(/\.[-_a-z0-9]+/g) || []) keys.add(`class:${cls}`);
  }
  return [...keys];
}
const background = (p) => p.background || p['background-image'] || p['background-color'] || '';
const bordered = (p) => /^1px\s+solid\b/.test(p.border || '');
const colorFunction = (token) => /^(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix)\(/.test(token) && token.endsWith(')');
const zeroAlpha = (token) => /^(?:0(?:\.0+)?|\.0+)%?$/.test(token.trim());
function invisibleColor(value) {
  for (const token of splitOutsideFunctions(value, 'whitespace')) {
    if (token === 'transparent' || /^#[a-f0-9]{3}0$|^#[a-f0-9]{6}00$/.test(token)) return true;
    if (!colorFunction(token) || token.startsWith('color-mix(')) continue;
    const name = token.slice(0, token.indexOf('('));
    const args = token.slice(name.length + 1, -1);
    const slash = splitOutsideFunctions(args, '/');
    if (slash.length === 2 && zeroAlpha(slash[1])) return true;
    if (/^(?:rgba?|hsla?)$/.test(name)) {
      const comma = splitOutsideFunctions(args, ',');
      if (comma.length === 4 && zeroAlpha(comma[3])) return true;
    }
  }
  return false;
}
const backgroundLayout = new Set(['none', 'center', 'top', 'right', 'bottom', 'left', 'repeat',
  'no-repeat', 'repeat-x', 'repeat-y', 'space', 'round', 'scroll', 'fixed', 'local',
  'border-box', 'padding-box', 'content-box', 'cover', 'contain', 'auto']);
const backgroundLength = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[a-z%]+)?$/;
const backgroundMath = /^(?:calc|min|max|clamp)\(/;
function paintedBackground(v) {
  if (!v || /^(?:inherit|initial|unset)$/.test(v)) return false;
  return splitOutsideFunctions(v, ',').some((layer) =>
    splitOutsideFunctions(layer, 'whitespace').flatMap((part) => splitOutsideFunctions(part, '/'))
      .some((token) => {
        if (!token || backgroundLayout.has(token) || backgroundLength.test(token) || backgroundMath.test(token)) return false;
        if (invisibleColor(token)) return false;
        // A remaining token can be a color or image. Function arguments stay together.
        return /^(?:#[a-f0-9]+|[a-z][a-z-]*(?:\(.*\))?)$/s.test(token);
      }));
}
const paintedBorder = (v) => !!v && splitOutsideFunctions(v, 'whitespace')
  .some((token) => /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(token)) &&
  !/^0(?:px|rem|em)?(?:\s|$)/.test(v) && !invisibleColor(v);
function paintedLonghandBorder(p) {
  if (!p['border-style']) return false;
  const expand = (values) => [values[0], values[1] || values[0], values[2] || values[0], values[3] || values[1] || values[0]];
  const widths = expand((p['border-width'] || 'medium').split(/\s+/));
  const styles = expand(p['border-style'].split(/\s+/));
  const colors = p['border-color'] ? expand(splitOutsideFunctions(p['border-color'], 'whitespace')) : [];
  return widths.some((width, side) => !/^0(?:\.0+)?(?:px|rem|em)?$/.test(width) &&
    /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset)$/.test(styles[side]) &&
    (!colors.length || !invisibleColor(colors[side])));
}
function paintedShadow(v) {
  if (!v || v === 'none' || invisibleColor(v)) return false;
  const lengths = splitOutsideFunctions(v, 'whitespace').filter((token) =>
    token !== 'inset' && !/^[a-z]+$/.test(token) && !/^#[a-f0-9]{3,8}$/.test(token) && !colorFunction(token));
  return !(lengths.length >= 2 && lengths.length <= 4 &&
    lengths.every((token) => /^0(?:\.0+)?(?:px|rem|em)?$/.test(token)));
}
const buttonish = (s) => /(?:^|[\s,.#>])(?:button|btn|cta)(?:$|[\s,.#:_-])/.test(s);
const cardish = (s) => /(?:^|[\s,.#>])(?:card|panel|tile|callout|alert)(?:$|[\s,.#:_-])/.test(s);

// The parser's own primitive, read with this rule file's `info` shape.
function boundaryText(info, index, isBoundary, excludeCode = false) {
  return rawBoundaryText(info.elements, info.ends, info.hidden, index, isBoundary, excludeCode);
}
// Same-kind boundaries for `boundaryText`, one per label shape: a heading
// stops at a nested heading, a badge at a nested badge, an option at a
// nested option, a caption (`p`/`small`) at a nested caption. Each keeps the
// read linear when that shape nests inside itself, the same way `control`
// keeps `multiword-control` linear, with no subtree-size cap to miss a large,
// ordinary, non-text subtree such as an inline SVG.
const isHeading = (el) => /^h[1-6]$/.test(el.tag);
const isBadge = (el) => [...el.classes].some((c) => /(?:^|[-_])(?:status|badge|pill)(?:$|[-_])/.test(c));
const isOption = (el) => el.tag === 'option';
const isCaption = (el) => /^(?:p|small)$/.test(el.tag);
// Words that make a sub-line state a fact: a verb, the reader, or a time
// or condition. `restated-title-subline` stays silent on a line with one.
const INFORMATIVE_WORD = /^(?:is|are|was|were|be|been|has|have|had|can|will|may|must|should|do|does|did|need|needs|show|shows|arrive|arrives|you|your|until|after|before|since|when|unless|if|by|on)$/i;
// A period as a single comparable number: a day count and a month-or-year
// count (years normalized to months) never collide, because every day count
// carries the low decimal digit 1 and every month/year count carries 0.
const periodCode = (count, unit) => unit === 'days' ? count * 10 + 1 : count * (unit === 'years' ? 12 : 1) * 10;
// The whole caption: an optional lead-in phrase, the period phrase, and
// nothing after it but an optional full stop. A caption that adds its own
// fact around the period phrase is not anchored by this and stays silent.
const PERIOD_CAPTION = /^(?:change against|compared (?:with|to)|against|relative to|vs\.?)\s+the\s+(?:previous|last|past|prior|trailing)\s+(\d+)\s+(months?|years?|days?)\.?$/i;
function selectedPeriodMonths(el) {
  if (!/^(?:button|option)$/.test(el.tag)) return 0;
  const value = el.tag === 'option' ? el.attributes.value || el.text.trim() : el.text.trim();
  const match = /^(\d+)([MYD])$/i.exec(value);
  if (!match) return 0;
  const selected = el.tag === 'option' ? Object.hasOwn(el.attributes, 'selected') :
    el.attributes['aria-pressed'] === 'true' || el.attributes['aria-selected'] === 'true' ||
    el.attributes['aria-current'] === 'true' || el.attributes['data-state'] === 'active' ||
    [...el.classes].some((c) => /^(?:active|selected|current)$/.test(c));
  if (!selected) return 0;
  const unit = { M: 'months', Y: 'years', D: 'days' }[match[2].toUpperCase()];
  return periodCode(Number(match[1]), unit);
}
function nounFromClasses(classes) {
  for (const name of classes) {
    const match = /^([a-z][a-z0-9]*)[-_](?:bar|toolbar)$/.exec(name);
    if (match) return match[1];
  }
  return '';
}
function singular(word) {
  if (word.endsWith('ies')) return word.slice(0, -3) + 'y';
  return word.endsWith('s') ? word.slice(0, -1) : word;
}
function redundantContextNoun(label, noun) {
  const match = /^clear all ([\p{L}]+)$/iu.exec(label.trim());
  return !!match && !!noun && singular(match[1].toLowerCase()) === singular(noun);
}
function control(el) {
  return el.tag === 'button' || el.attributes.role === 'button' ||
    (el.tag === 'input' && /^(?:button|submit|reset)$/.test(el.inputType)) ||
    (el.tag === 'a' && [...el.classes].some((c) => /^(?:btn|button)(?:-|$)/.test(c)));
}
function normalized(text) { return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

// A verb with no object ("Clear all") names the action completely; adding the
// object back ("Clear all filters") is what the rule still flags.
const VERB_ALL_ONLY = /^\p{L}+ all$/u;

module.exports = [
  rule('multiword-control', 2, 'A multi-word action label makes a control harder to scan.', 'Use one clear verb for the action.', (ctx) => {
    const info = data(ctx), { elements } = info;
    return elements.flatMap((el, i) => {
      if (!control(el) || el.inCode) return [];
      // Read only the visible label (and, for an `<input>`, its rendered
      // value): an accessible name given through `aria-label` is allowed to
      // be more descriptive than a visible one-word label, so a control with
      // no visible text at all — an icon with an accessible name, #63's own
      // expected shape — is never counted here.
      const label = boundaryText(info, i, control, true) || (el.tag === 'input' ? el.attributes.value : '') || '';
      if (!label) return [];
      const normalizedLabel = normalized(label);
      // Count words on the label's own text, not the fully normalized copy:
      // normalizing turns an internal hyphen or apostrophe into a space, so
      // "Re-run" or "Don't" would otherwise count as two words.
      const words = label.toLowerCase().replace(/[^\p{L}\p{N}'-]+/gu, ' ').trim()
        .split(/\s+/).filter((w) => /\p{L}/u.test(w));
      if (words.length < 2) return [];
      if (VERB_ALL_ONLY.test(normalizedLabel)) return [];
      if (redundantContextNoun(label, info.contextNoun[i])) return [];
      return [`<${el.tag}> ${label.slice(0, 80)}`];
    });
  }),
  rule('inset-accent-marker', 2, 'An inset accent stripe repeats another selection marker.', 'Keep one selection marker.', (ctx) => {
    const { rows } = data(ctx);
    // A cascade usually spreads the two markers across declarations: a base
    // selector gives the border its style, a more specific one (`.active`)
    // recolors it or adds the stripe. Read each property across every
    // selector that reaches an element, not only its own declaration block.
    const stripeEls = new Set(), solidEls = new Set(), coloredBorderEls = new Set(),
      coloredHighlightEls = new Set(), namedEls = new Set();
    for (const row of rows) {
      const p = row.props;
      const styleValue = [p.border, p['border-left'], p['border-right'], p.outline,
        p['border-style'], p['border-left-style'], p['border-right-style'], p['outline-style']].join(' ');
      const colorValue = [p.border, p['border-left'], p['border-right'], p.outline,
        p['border-color'], p['border-left-color'], p['border-right-color'], p['outline-color']].join(' ');
      const highlightValue = p.background || p['background-color'] || '';
      const stripe = STRIPE.exec(p['box-shadow'] || '');
      const width = stripe ? Math.abs(parseFloat(stripe[1] ?? stripe[3])) * ((stripe[2] ?? stripe[4]) === 'px' ? 1 : 16) : 0;
      const isSolid = /(?:solid|outline)/.test(styleValue);
      const isColoredBorder = chromatic(colorValue);
      const isColoredHighlight = chromatic(highlightValue);
      const isNamed = STATE_SELECTOR.test(row.selector);
      if (!(width >= 2) && !isSolid && !isColoredBorder && !isColoredHighlight && !isNamed) continue;
      for (const el of targets(ctx, row)) {
        if (width >= 2) stripeEls.add(el);
        if (isSolid) solidEls.add(el);
        if (isColoredBorder) coloredBorderEls.add(el);
        if (isColoredHighlight) coloredHighlightEls.add(el);
        if (isNamed) namedEls.add(el);
      }
    }
    const hits = [];
    for (const el of stripeEls) {
      const borderMarker = solidEls.has(el) && coloredBorderEls.has(el);
      // A plain background highlight counts as the second marker only on an
      // element some selector names as a selection state; an ordinary button
      // or badge with a colored fill and an edge glow is not a selected option.
      const highlightMarker = namedEls.has(el) && coloredHighlightEls.has(el);
      if (borderMarker || highlightMarker) {
        hits.push(`<${el.tag}>${el.id ? '#' + el.id : [...el.classes].slice(0, 2).map((c) => '.' + c).join('')}`);
      }
    }
    return hits;
  }),
  rule('repeated-field-caption', 2, 'The same caption under each field adds no field-specific information.', 'Keep only a caption that explains its own field.', (ctx) => {
    const info = data(ctx), { elements, fieldId, manyFields } = info;
    const groups = new Map(), seenFields = new Set();
    const words = new Uint8Array(elements.length);
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (!info.hidden[i]) {
        for (const [, run] of el.chunks) {
          const text = normalized(run.replace(/\{[^{}]*\}/g, ' '));
          if (text) words[i] = Math.min(6, words[i] + text.split(' ').length);
        }
      }
      if (el.parent >= 0) words[el.parent] = Math.min(6, words[el.parent] + words[i]);
    }
    for (let i = elements.length - 1; i >= 0; i--) {
      const el = elements[i];
      if (!/^(?:small|p|span)$/.test(el.tag)) continue;
      // A validation message or other live-region caption tells its own field
      // something nothing else on the screen shows; it is not a repeat.
      if (info.live[i]) continue;
      const field = el.parent >= 0 ? fieldId[el.parent] : -1;
      if (field < 0 || manyFields[el.parent] || seenFields.has(field) || words[i] > 5) continue;
      const fieldEl = elements[field];
      // A radio or checkbox's own label — the text beside it that a reader
      // clicks to select it — is never a repeated caption, whichever side of
      // the control it sits on. For every other field, only a caption that
      // comes after it in the markup is a trailing note; one before it is
      // the field's own label ("Quantity" beside its input).
      if (/^(?:radio|checkbox)$/.test(fieldEl.inputType)) continue;
      if (el.start < fieldEl.start) continue;
      const key = normalized(boundaryText(info, i, isCaption));
      if (!key || key.split(' ').length > 5) continue;
      seenFields.add(field);
      if (!groups.has(key)) groups.set(key, new Set());
      groups.get(key).add(field);
    }
    return [...groups].filter(([, parents]) => parents.size >= 3).map(([caption, parents]) => `${caption} under ${parents.size} fields`);
  }),
  rule('restated-status-badge', 2, 'A status badge repeats the page title or a field state.', 'Remove the repeated badge.', (ctx) => {
    const info = data(ctx), { elements, sectionOf, headingScopeOf, containsBadge, inHeader } = info;
    const addTo = (map, key, value) => {
      if (!map.has(key)) map.set(key, new Set());
      map.get(key).add(value);
    };
    // Only the page title — an h1, or any heading inside the <header>
    // landmark — is compared page-wide. Any other heading (an h2 naming its
    // own section, such as a dashboard section named after a state) keeps
    // the same narrower, same-section scope a field state uses: a badge in
    // a different section must not read an unrelated heading as its title.
    const pageTitlesByScope = new Map();
    const sectionHeadingsBySection = new Map();
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      // A heading that is itself styled as a badge, or that contains one (a
      // badge given as the heading, such as `<h2><span class="pill">Beta
      // </span></h2>`), is not a separate page title: without this, a badge
      // nested in or styled as its own heading repeats itself.
      if (!isHeading(el) || isBadge(el) || containsBadge[i]) continue;
      const text = normalized(boundaryText(info, i, isHeading));
      if (el.tag === 'h1' || inHeader[i]) addTo(pageTitlesByScope, headingScopeOf[i], text);
      else addTo(sectionHeadingsBySection, sectionOf[i], text);
    }
    const fieldStatesBySection = new Map();
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      let value = '';
      if (el.tag === 'option') value = Object.hasOwn(el.attributes, 'selected') ? el.attributes.value || boundaryText(info, i, isOption) : '';
      else if (el.tag === 'select') value = el.attributes.value || '';
      else if (el.tag === 'input') {
        // A field's visible state is what a reader sees: a checked radio or
        // checkbox, or a text-like value. An unchecked option shows nothing, and
        // `type="hidden"` shows nothing by definition — reading either reports a
        // badge as repeating a state the page never actually renders.
        const type = el.inputType || 'text';
        if (type === 'hidden') value = '';
        else if (/^(?:radio|checkbox)$/.test(type) && !Object.hasOwn(el.attributes, 'checked')) value = '';
        else value = el.attributes.value || '';
      }
      if (value) addTo(fieldStatesBySection, sectionOf[i], normalized(value));
    }
    return elements.flatMap((el, i) => {
      if (!isBadge(el)) return [];
      const label = normalized(boundaryText(info, i, isBadge));
      if (!label || !/\p{L}/u.test(label)) return [];
      // A field state and a section heading are compared only within the
      // badge's own section (its nearest <section>/<nav>/<tr>/… ancestor): a
      // cart badge or a table row's own badge must not read a field value or
      // an unrelated section's heading as its own state. The page title is
      // compared more widely, through <header>/<main>/<footer>: those sit
      // side by side as one page, so a page title in <header><h1> still
      // repeats in a badge under <main>.
      const titles = pageTitlesByScope.get(headingScopeOf[i]);
      const sectionHeadings = sectionHeadingsBySection.get(sectionOf[i]);
      const fields = fieldStatesBySection.get(sectionOf[i]);
      return (titles?.has(label) || sectionHeadings?.has(label) || fields?.has(label)) ?
        [`${label} badge repeats a title or field state`] : [];
    });
  }),
  rule('marker-explainer', 2, 'A sentence explains a visible marker without adding information.', 'Remove the sentence and keep the marker clear.', (ctx) => {
    const info = data(ctx), { elements, firstCanvas } = info;
    return elements.flatMap((el, i) => {
      if (!isCaption(el) || el.inCode || info.chart[i]) return [];
      // A caption beside a <canvas>-drawn chart in the same plain container
      // (a `.card` with no chart class) names what that chart already
      // shows, the same as one inside <figure> or a chart-class container.
      if (el.parent >= 0 && firstCanvas[el.parent] < elements.length) return [];
      const text = boundaryText(info, i, isCaption);
      // Page copy names a marker by its colour as often as by "accent"/"inset";
      // a chart legend saying "line" instead of "bar"/"stripe" stays silent.
      // A caption inside a figure or a chart-class container names what the
      // chart already shows, so it carries no information the chart lacks.
      return MARKER_BAR.test(text) && MARKER_EXPLAINS.test(text) ? [text.slice(0, 90)] : [];
    });
  }),
  rule('restated-control-period', 2, 'A caption repeats the selected period.', 'Remove the repeated caption.', (ctx) => {
    const info = data(ctx), { elements, periodScope } = info, hits = [];
    for (let i = 0; i < elements.length; i++) {
      if (!/^(?:p|small|span)$/.test(elements[i].tag)) continue;
      // The whole caption, not a phrase anywhere inside it: a caption that
      // adds its own fact around the period ("Revenue grew 20% against the
      // previous 12 months.") is not only the repeated period, and must stay
      // silent even when it sits near an active period control.
      const text = boundaryText(info, i, isCaption);
      const period = PERIOD_CAPTION.exec(text);
      if (!period) continue;
      const unit = /^day/i.test(period[2]) ? 'days' : /^year/i.test(period[2]) ? 'years' : 'months';
      const code = periodCode(Number(period[1]), unit);
      // The nearest enclosing container's one selected period, not only the
      // caption's direct parent: a caption in a sibling wrapper of the
      // control group (a footer beside a chart) still reads it.
      if (periodScope[i] === code) hits.push(text.slice(0, 90));
    }
    return hits;
  }),
  rule('restated-table-count', 2, 'A count line repeats the rows directly below it.', 'Remove the count line when the rows show the count.', (ctx) => {
    const info = data(ctx), { elements, bodyRows, nextTable } = info, hits = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!isCaption(el)) continue;
      const text = boundaryText(info, i, isCaption);
      const match = /^(?:showing\s+)?(\d+)\s+of\s+(?:the\s+)?\d[\d,]*\s+[\p{L}-]+(?:\s+(?:this|last)\s+(?:year|month|week|quarter))?\.?$/iu.exec(text);
      if (!match) continue;
      const table = nextTable[i];
      if (table >= 0 && bodyRows[table] === Number(match[1])) hits.push(text.slice(0, 90));
    }
    return hits;
  }),
  rule('restated-title-subline', 2, 'The line under a title only restates the title.', 'Remove the line, or replace it with a fact the title does not give.', (ctx) => {
    const info = data(ctx), { elements } = info, hits = [], lastChild = new Map();
    const stem = (w) => w.toLowerCase().replace(/(?:es|s)$/, '');
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i], prev = lastChild.get(el.parent);
      lastChild.set(el.parent, i);
      if (!isCaption(el) || prev === undefined || !isHeading(elements[prev])) continue;
      const nouns = new Set((boundaryText(info, prev, isHeading).match(/\p{L}{3,}/gu) || []).map(stem));
      const text = boundaryText(info, i, isCaption), words = text.match(/[\p{L}\d'’-]+/gu) || [];
      // A digit, a verb, a later proper noun or a time or condition word
      // gives the reader a fact, so only a verbless, short noun phrase
      // that names the title noun again counts as a restatement.
      if (!words.length || words.length > 14 || /\d/.test(text)) continue;
      if (words.some((w, k) => (k > 0 && /^\p{Lu}/u.test(w)) || /ed$/i.test(w) || INFORMATIVE_WORD.test(w))) continue;
      if (words.some((w) => nouns.has(stem(w)))) hits.push(text.slice(0, 90));
    }
    return hits;
  }),
  rule('context-noun-control', 2, 'The control repeats the noun given by its surrounding bar.', 'Use “Clear all” when the bar names the objects.', (ctx) => {
    const info = data(ctx), { elements } = info;
    return elements.flatMap((el, i) => {
      if (!control(el)) return [];
      const label = boundaryText(info, i, control);
      return redundantContextNoun(label, info.contextNoun[i]) ? [label] : [];
    });
  }),
  cssRule('gradient-text', 2, 'Gradient clipped into text is decorative emphasis.', 'Use type size or weight for emphasis.', (p) => /gradient\(/.test(background(p)) && (p['background-clip'] === 'text' || p['-webkit-background-clip'] === 'text'), true),
  cssRule('ai-gradient', 2, 'Pink, violet and purple gradient combinations are a common generated UI default.', 'Choose colors from the subject or an established palette.', (p) => {
    const g = background(p);
    if (!/gradient\(/.test(g)) return false;
    // Leave purple-to-blue to its established rule ID.
    if (/#[89ab][0-9a-f]{2}[cf][0-9a-f]|purple|violet|indigo|#7c3aed|#6d28d9|#9333ea|#a855f7|#8b5cf6|#6366f1/.test(g) && /blue|#[0-6][0-9a-f]{2}[ef][0-9a-f]|#2563eb|#3b82f6/.test(g)) return false;
    const cs = colours(g);
    return cs.length >= 2 && cs.some(([r, g, b]) => r > g * 1.2 && b > g * 1.2 && Math.max(r, b) > 100);
  }),
  cssRule('glow-shadow', 2, 'A colored zero-offset shadow creates a decorative halo.', 'Use an offset shadow for elevation, or remove the glow.', (p) => ['box-shadow', 'text-shadow'].some((k) => {
    return splitOutsideFunctions(p[k] || '', ',').some((v) => {
      const uncolored = v.replace(/#[a-f0-9]{3,8}\b|rgba?\([^)]{1,100}\)|\b(?:purple|violet|pink|blue|red|green|orange|magenta|cyan|white|black)\b/g, '');
      const m = /^\s*(?:inset\s+)?0(?:px)?\s+0(?:px)?\s+([\d.]+)(px|rem|em)\b/.exec(uncolored);
      return !!m && Number(m[1]) > 0 && chromatic(v);
    });
  })),
  cssRule('glassmorphism', 2, 'Backdrop blur is a common decorative glass effect.', 'Keep blur only where layering needs it.', (p) => /blur\(/.test(p['backdrop-filter'] || p['-webkit-backdrop-filter'] || '')),
  rule('nested-cards', 2, 'Cards inside cards add redundant containers.', 'Use spacing or a divider within the outer card.', (ctx) => {
    const { elements, rows } = data(ctx);
    const painted = new Set(), rounded = new Set();
    for (const row of rows) {
      const p = row.props;
      const hasPaint = [p.background, p['background-image'], p['background-color']].some(paintedBackground) ||
        [p.border, p['border-top'], p['border-right'], p['border-bottom'], p['border-left']].some(paintedBorder) ||
        paintedLonghandBorder(p) ||
        splitOutsideFunctions(p['box-shadow'] || '', ',').some(paintedShadow);
      if (!hasPaint && pixels(p['border-radius']) <= 0) continue;
      for (const el of targets(ctx, row)) {
        if (hasPaint) painted.add(el);
        if (pixels(p['border-radius']) > 0) rounded.add(el);
      }
    }
    const cards = new Set(elements.filter((el) => painted.has(el) &&
      ([...el.classes].some((c) => /^(?:card|panel|tile)(?:$|[-_])/.test(c)) || rounded.has(el))));
    const inside = [];
    const hits = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i], parent = elements[el.parent];
      inside[i] = !!parent && (cards.has(parent) || inside[el.parent]);
      if (cards.has(el) && inside[i]) hits.push(`<${el.tag}> card inside card`);
    }
    return hits;
  }),
  cssRule('bounce-easing', 2, 'Bounce or elastic motion adds ornamental overshoot.', 'Use a non-overshooting easing unless motion communicates a state.', (p) => Object.entries(p).some(([k, v]) => {
    if (!/^(?:transition|animation)/.test(k)) return false;
    if (/\b(?:bounce|elastic|easeOutBack|easeInBack|easeInOutBack)\b/i.test(v)) return true;
    for (const m of v.matchAll(/cubic-bezier\(([^)]{1,100})\)/g)) {
      const n = m[1].split(',').map(Number);
      if (n.length === 4 && n.every(Number.isFinite) && (n[1] < 0 || n[1] > 1 || n[3] < 0 || n[3] > 1)) return true;
    }
    return false;
  })),
  cssRule('accent-bar', 3, 'A colored side stripe decorates a container boundary.', 'Use hierarchy or spacing to emphasize the content.', (p) => ['border-left', 'border-right', 'border-inline-start', 'border-inline-end', 'border-top'].some((k) => {
    const value = p[k] || '', width = /^([\d.]+)(px|rem|em)\s+solid\b/.exec(value);
    return !!width && pixels(width[1] + width[2]) > 1 && chromatic(value);
  })),
  cssRule('pill-radius', 3, 'Pill-shaped buttons or cards can become a default shape without a purpose.', 'Choose a radius that fits the control or surface.', (p, row, ctx) => {
    const v = p['border-radius'];
    if (!(pixels(v) >= 100 || v === '50%' || v === '100%')) return false;
    return buttonish(row.selector) || cardish(row.selector) || targets(ctx, row).some((el) => el.tag === 'button');
  }),
  rule('big-number-stat', 3, 'Oversized numeric stats can substitute a hero template for useful evidence.', 'Put the measure and its context together at a readable scale.', (ctx) => {
    const found = new Set();
    for (const row of data(ctx).rows) {
      if (pixels(row.props['font-size']) < 48) continue;
      for (const el of targets(ctx, row)) {
        const text = (el.text || '').trim();
        if (!el.inCode && !el.inTable && !['td', 'th'].includes(el.tag) && /^[$€£]?\d[\d,.]*(?:[%xXkKmMbB+]|\/\d+)?$/.test(text)) found.add(text);
      }
    }
    return [...found];
  }),
  rule('emoji-icon', 2, 'An isolated emoji stands in for a designed icon.', 'Use a consistent icon set when an icon helps explain the action.', (ctx) => data(ctx).elements.filter((el) => !el.inCode && !data(ctx).inHeading.has(el) && !(el.inTable && /^[\u2714\uFE0F\s]+$/.test(el.text || '')) && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D|\s){1,12}$/u.test((el.text || '').trim()) && /\p{Extended_Pictographic}/u.test(el.text || '')).map((el) => `<${el.tag}> ${(el.text || '').trim()}`)),
  rule('family-ceiling', 4, 'More than three primary font families can fragment a type system.', 'Keep only families with distinct roles.', (ctx) => {
    const families = new Set(data(ctx).rows.map((r) => (r.props['font-family'] || '').split(',')[0].trim().replace(/['"]/g, '')).filter((f) => f && !/^(?:inherit|initial|unset|var\()/.test(f)));
    return families.size > 3 ? [`${families.size} primary font families: ${[...families].slice(0, 8).join(', ')}`] : [];
  }),
  cssRule('stock-display-face', 4, 'Inter or Space Grotesk as a display face is a common default worth reviewing.', 'Keep the face if it was chosen for this subject.', (p, r) => /^(?:['"]?inter['"]?|['"]?space grotesk['"]?)(?:,|$)/.test(p['font-family'] || '') && (pixels(p['font-size']) >= 48 || /(?:^|[\s,>])h[12]\b/.test(r.selector))),
  cssRule('mono-uppercase-label', 3, 'Tracked uppercase monospace labels imitate terminal chrome.', 'Use the interface typeface and sentence case for ordinary labels.', (p, r, ctx) => MONO.test(p['font-family'] || '') && p['text-transform'] === 'uppercase' && pixels(p['letter-spacing']) > 0 && !/\b(?:code|pre|kbd|samp)\b/.test(r.selector) && !targets(ctx, r).some((el) => el.inCode), true),
  rule('accent-budget', 4, 'Several unrelated accent colors can obscure emphasis.', 'Reserve accents for clear roles and keep the remaining colors neutral.', (ctx) => {
    const accents = [];
    for (const row of data(ctx).rows) {
      if (STATE.test(row.selector)) continue;
      for (const [name, value] of Object.entries(row.props)) {
        if (!/^(?:color|background|border|outline|fill|stroke)/.test(name)) continue;
        for (const c of colours(value)) {
          if (saturation(c) < 0.45 || Math.max(...c) < 60 || Math.min(...c) >= 192) continue;
          if (!accents.some((a) => Math.hypot(...c.map((n, i) => n - a[i])) < 24)) accents.push(c);
          if (accents.length >= 3) return ['at least 3 distinct accent colors'];
        }
      }
    }
    return [];
  }),
  rule('hairline-grid', 4, 'Repeated hairline boxes in a grid can make every item look like the same card.', 'Let spacing group items unless their boundaries carry meaning.', (ctx) => {
    const { rows } = data(ctx);
    if (!rows.some((r) => /^(?:grid|flex)$/.test(r.props.display || ''))) return [];
    const boxes = new Set();
    for (const row of rows) if (bordered(row.props) && colours(row.props.border).some((c) => saturation(c) < 0.2)) for (const el of targets(ctx, row)) boxes.add(el);
    return boxes.size >= 3 ? [`${boxes.size} hairline-bordered items in a grid or flex layout`] : [];
  }),
  rule('double-edge', 4, 'Repeated boxes separate themselves with both a border and a fill.', 'Use one boundary treatment for ordinary surfaces.', (ctx) => {
    const count = data(ctx).rows.filter((r) => bordered(r.props) && background(r.props) && !/^(?:none|transparent|inherit)$|gradient\(|url\(/.test(background(r.props))).length;
    return count >= 5 ? [`${count} rules combine a hairline border and fill`] : [];
  }),
  rule('button-drift', 4, 'Several unrelated button sizes or radii weaken control consistency.', 'Use a documented size and corner scale for buttons.', (ctx) => {
    const sizes = new Set(), radii = new Set();
    for (const row of data(ctx).rows) {
      if (STATE.test(row.selector) || !(buttonish(row.selector) || targets(ctx, row).some((el) => el.tag === 'button'))) continue;
      const p = row.props;
      if (p.height || p.padding) sizes.add(p.height || p.padding);
      if (p['border-radius']) radii.add(p['border-radius']);
    }
    return [sizes.size >= 3 ? `${sizes.size} button sizes` : '', radii.size >= 3 ? `${radii.size} button radii` : ''].filter(Boolean);
  }),
  rule('everything-centred', 4, 'Centering most of a page weakens the alignment hierarchy.', 'Center short focal content and give longer text a consistent reading edge.', (ctx) => {
    const { rows, elements } = data(ctx);
    if (rows.some((r) => /^(?:left|start|justify)$/.test(r.props['text-align'] || ''))) return [];
    const centred = rows.filter((r) => r.props['text-align'] === 'center');
    if (centred.some((r) => /^(?:body|html|:root)$/.test(r.selector.trim()))) return ['document-wide centered text'];
    const reached = new Set();
    for (const row of centred) for (const el of targets(ctx, row)) reached.add(el);
    return reached.size >= 4 && reached.size >= elements.length / 3 ? [`${reached.size} of ${elements.length} elements center text`] : [];
  }),
  rule('stock-palette', 4, 'Near-black with acid green, or cream with terracotta and serif type, are common generated palettes.', 'Choose the palette for the subject or keep an intentional established system.', (ctx) => {
    let dark = false, acid = false, cream = false, terra = false;
    const terracotta = [[193, 101, 63], [224, 122, 95], [184, 92, 56], [217, 119, 87], [204, 115, 81]];
    for (const row of data(ctx).rows) for (const [name, value] of Object.entries(row.props)) {
      if (!/^(?:color|background|border)/.test(name)) continue;
      for (const [r, g, b] of colours(value)) {
        if (Math.max(r, g, b) <= 28 && Math.max(r, g, b) - Math.min(r, g, b) < 12) dark = true;
        if (g >= 220 && b <= 145 && (r >= 150 || r <= 75)) acid = true;
        const c = [r, g, b], h = hue(c), light = (Math.max(...c) + Math.min(...c)) / 510;
        if (saturation(c) >= 0.2 && h >= 24 && h <= 54 && light >= 0.81) cream = true;
        if (terracotta.some((t) => Math.hypot(...c.map((n, i) => n - t[i])) <= 45)) terra = true;
      }
    }
    const serif = data(ctx).rows.some((row) => /(?:^|[^\w-])(?:serif|georgia|times|playfair|lora|merriweather|garamond|spectral|newsreader|instrument serif|dm serif)\b/.test(row.props['font-family'] || ''));
    const existingCream = /#f4f1ea|#faf6f0|#f5f1e8/i.test(ctx.css || '') && /#e07a5f|#cc6b49|#d4744f|terracotta/i.test(ctx.css || '');
    return [dark && acid ? 'near-black and acid-green palette' : '', cream && terra && serif && !existingCream ? 'cream, terracotta and serif palette' : ''].filter(Boolean);
  }),
];
