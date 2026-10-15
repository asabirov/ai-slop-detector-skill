'use strict';

// A cached declaration pass keeps each rule from reparsing the same stylesheet.
const cache = new WeakMap();
const STATE = /:(?:hover|focus|active|disabled|visited|checked)\b/i;
const MONO = /\b(?:monospace|ui-monospace|menlo|monaco|consolas|courier|[a-z]+ mono)\b/i;
const COLOR_NAMES = { purple: [128, 0, 128], violet: [238, 130, 238], pink: [255, 192, 203], blue: [0, 0, 255], red: [255, 0, 0], green: [0, 128, 0], orange: [255, 165, 0], magenta: [255, 0, 255], cyan: [0, 255, 255], white: [255, 255, 255], black: [0, 0, 0] };

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
  for (const el of elements) if (/^h[1-6]$/.test(el.tag) || inHeading.has(elements[el.parent])) inHeading.add(el);
  const result = { rows, elements, index, inHeading };
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
function cssRule(id, level, why, fix, predicate) {
  return rule(id, level, why, fix, (ctx) => data(ctx).rows.filter((r) => predicate(r.props, r, ctx)).map((r) => r.selector.slice(0, 100)));
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

function descendants(elements, index) {
  const out = [];
  for (let i = index; i < elements.length; i++) {
    if (i > index) {
      let p = elements[i].parent;
      while (p >= 0 && p !== index) p = elements[p].parent;
      if (p !== index) break;
    }
    out.push(elements[i]);
  }
  return out;
}
function visibleText(elements, index) {
  return descendants(elements, index).filter((el) => !/\baria-hidden\s*=\s*["']true["']/i.test(el.attrs || '') &&
    ![...el.classes].some((c) => /^(?:sr-only|visually-hidden)$/.test(c))).flatMap((el) => el.chunks).sort((a, b) => a[0] - b[0])
    .map((chunk) => chunk[1]).join(' ').replace(/\s+/g, ' ').trim();
}
function attribute(el, name) {
  return new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i').exec(el.attrs || '')?.[1] || '';
}
function children(elements, index) { return elements.filter((el) => el.parent === index); }
function hasAncestor(elements, index, tag, stop) {
  for (let p = elements[index].parent; p >= 0 && p !== stop; p = elements[p].parent) {
    if (elements[p].tag === tag) return true;
  }
  return false;
}
function control(el) {
  return el.tag === 'button' || /\brole\s*=\s*["']button["']/i.test(el.attrs || '') ||
    (el.tag === 'input' && /\btype\s*=\s*["'](?:button|submit|reset)["']/i.test(el.attrs || '')) ||
    (el.tag === 'a' && [...el.classes].some((c) => /^(?:btn|button)(?:-|$)/.test(c)));
}
function nearbyContext(elements, index) {
  let p = elements[index].parent;
  while (p >= 0) {
    const names = [...elements[p].classes].join(' ') + ' ' + elements[p].tag;
    if (/filter/i.test(names)) return 'filter';
    p = elements[p].parent;
  }
  return '';
}
function normalized(text) { return text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim(); }

// This label predates the rule. “Read records” is a bare verb+noun table-action label, not sentence-like.
const MULTIWORD_CONTROL_ALLOWLIST = new Set(['Read records']);

module.exports = [
  rule('multiword-control', 2, 'A multi-word action label makes a control harder to scan.', 'Use one clear verb for the action.', (ctx) => {
    const { elements } = data(ctx);
    return elements.flatMap((el, i) => {
      if (!control(el) || el.inCode) return [];
      const label = visibleText(elements, i) || attribute(el, 'aria-label') || (el.tag === 'input' ? attribute(el, 'value') : '');
      if (!label || !/\p{L}/u.test(label) || normalized(label).split(/\s+/).length < 2) return [];
      if (MULTIWORD_CONTROL_ALLOWLIST.has(label)) return [];
      if (/^clear all filters$/i.test(label) && nearbyContext(elements, i) === 'filter') return [];
      return [`<${el.tag}> ${label.slice(0, 80)}`];
    });
  }),
  cssRule('inset-accent-marker', 2, 'An inset accent stripe repeats an existing selection border.', 'Keep one selection marker.', (p) =>
    /\binset\s+[1-9]\d*(?:px|rem|em)\s+0\b|\binset\s+0\s+0\s+0\s+[1-9]\d*(?:px|rem|em)/.test(p['box-shadow'] || '') &&
    /(?:solid|outline)/.test([p.border, p['border-left'], p['border-right'], p.outline].join(' ')) &&
    chromatic([p['box-shadow'], p.border, p['border-left'], p['border-right'], p.outline].join(' '))),
  rule('repeated-field-caption', 2, 'The same caption under each field adds no field-specific information.', 'Keep only a caption that explains its own field.', (ctx) => {
    const { elements } = data(ctx), groups = new Map();
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i];
      if (!/^(?:small|p|span)$/.test(el.tag)) continue;
      const parent = elements[el.parent];
      if (!parent || !descendants(elements, el.parent).some((e) => /^(?:input|select|textarea)$/.test(e.tag))) continue;
      const key = normalized(visibleText(elements, i));
      if (!key || key.split(' ').length > 5) continue;
      groups.set(key, (groups.get(key) || 0) + 1);
    }
    return [...groups].filter(([, count]) => count >= 3).map(([caption, count]) => `${caption} under ${count} fields`);
  }),
  rule('restated-status-badge', 2, 'A status badge repeats the page title or a field state.', 'Remove the repeated badge.', (ctx) => {
    const { elements } = data(ctx);
    const titles = new Set(elements.flatMap((el, i) => /^h[1-6]$/.test(el.tag) ? [normalized(visibleText(elements, i))] : []));
    const fieldStates = new Set(elements.flatMap((el) => {
      if (!/^(?:input|option)$/.test(el.tag)) return [];
      const m = /\bvalue\s*=\s*["']([^"']+)["']/i.exec(el.attrs || '');
      return m ? [normalized(m[1])] : [];
    }));
    return elements.flatMap((el, i) => {
      if (![...el.classes].some((c) => /(?:^|[-_])(?:status|badge|pill)(?:$|[-_])/.test(c))) return [];
      const label = normalized(visibleText(elements, i));
      return label && (titles.has(label) || fieldStates.has(label)) ? [`${label} badge repeats a title or field state`] : [];
    });
  }),
  rule('marker-explainer', 2, 'A sentence explains a visible marker without adding information.', 'Remove the sentence and keep the marker clear.', (ctx) =>
    data(ctx).elements.filter((el) => /^(?:p|small)$/.test(el.tag) && !el.inCode &&
      /\b(?:accent|inset|colored|colour|color) (?:bar|stripe|line) (?:marks?|shows?|indicates?|means?)\b/i.test(el.text))
      .map((el) => el.text.trim().slice(0, 90))),
  rule('restated-control-period', 2, 'A caption repeats the selected period.', 'Remove the repeated caption.', (ctx) => {
    const { elements } = data(ctx), hits = [];
    for (let i = 0; i < elements.length; i++) {
      if (!/^(?:p|small|span)$/.test(elements[i].tag) || !/previous 12 months/i.test(elements[i].text)) continue;
      const p = elements[i].parent;
      if (p < 0) continue;
      const controls = descendants(elements, p).filter((el) =>
        (el.tag === 'button' && /^(?:1Y|12M)$/i.test(el.text.trim())) ||
        (el.tag === 'option' && /^(?:1Y|12M)$/i.test(el.text.trim()) && /\bselected\b/i.test(el.attrs || '')));
      if (controls.length) hits.push(elements[i].text.trim().slice(0, 90));
    }
    return hits;
  }),
  rule('restated-table-count', 2, 'A count line repeats the rows directly below it.', 'Remove the count line when the rows show the count.', (ctx) => {
    const { elements } = data(ctx), hits = [];
    for (let i = 0; i < elements.length; i++) {
      const el = elements[i], match = /^(\d+) of (?:the )?\d[\d,]*\b/i.exec(el.text.trim());
      if (!/^(?:p|small)$/.test(el.tag) || !match) continue;
      const siblings = children(elements, el.parent);
      const table = siblings.find((s) => s.tag === 'table' && elements.indexOf(s) > i);
      if (table) {
        const tableIndex = elements.indexOf(table);
        const rows = descendants(elements, tableIndex).filter((e) => e.tag === 'tr' &&
          !hasAncestor(elements, elements.indexOf(e), 'thead', tableIndex));
        if (rows.length === Number(match[1])) hits.push(el.text.trim().slice(0, 90));
      }
    }
    return hits;
  }),
  rule('context-noun-control', 2, 'The control repeats the noun given by its surrounding filter bar.', 'Use “Clear all” in the filter bar.', (ctx) => {
    const { elements } = data(ctx);
    return elements.flatMap((el, i) => control(el) && /^clear all filters$/i.test(visibleText(elements, i)) && nearbyContext(elements, i) === 'filter' ? ['Clear all filters'] : []);
  }),
  cssRule('gradient-text', 2, 'Gradient clipped into text is decorative emphasis.', 'Use type size or weight for emphasis.', (p) => /gradient\(/.test(background(p)) && (p['background-clip'] === 'text' || p['-webkit-background-clip'] === 'text')),
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
  rule('emoji-icon', 2, 'An isolated emoji stands in for a designed icon.', 'Use a consistent icon set when an icon helps explain the action.', (ctx) => data(ctx).elements.filter((el) => !el.inCode && !data(ctx).inHeading.has(el) && /^(?:\p{Extended_Pictographic}|\p{Emoji_Modifier}|\uFE0F|\u200D|\s){1,12}$/u.test((el.text || '').trim()) && /\p{Extended_Pictographic}/u.test(el.text || '')).map((el) => `<${el.tag}> ${(el.text || '').trim()}`)),
  rule('family-ceiling', 4, 'More than three primary font families can fragment a type system.', 'Keep only families with distinct roles.', (ctx) => {
    const families = new Set(data(ctx).rows.map((r) => (r.props['font-family'] || '').split(',')[0].trim().replace(/['"]/g, '')).filter((f) => f && !/^(?:inherit|initial|unset|var\()/.test(f)));
    return families.size > 3 ? [`${families.size} primary font families: ${[...families].slice(0, 8).join(', ')}`] : [];
  }),
  cssRule('stock-display-face', 4, 'Inter or Space Grotesk as a display face is a common default worth reviewing.', 'Keep the face if it was chosen for this subject.', (p, r) => /^(?:['"]?inter['"]?|['"]?space grotesk['"]?)(?:,|$)/.test(p['font-family'] || '') && (pixels(p['font-size']) >= 48 || /(?:^|[\s,>])h[12]\b/.test(r.selector))),
  cssRule('mono-uppercase-label', 3, 'Tracked uppercase monospace labels imitate terminal chrome.', 'Use the interface typeface and sentence case for ordinary labels.', (p, r, ctx) => MONO.test(p['font-family'] || '') && p['text-transform'] === 'uppercase' && pixels(p['letter-spacing']) > 0 && !/\b(?:code|pre|kbd|samp)\b/.test(r.selector) && !targets(ctx, r).some((el) => el.inCode)),
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
