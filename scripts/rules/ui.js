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
    else if (ch === delimiter && depth === 0) { parts.push(value.slice(start, i)); start = i + 1; }
  }
  parts.push(value.slice(start));
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
const buttonish = (s) => /(?:^|[\s,.#>])(?:button|btn|cta)(?:$|[\s,.#:_-])/.test(s);
const cardish = (s) => /(?:^|[\s,.#>])(?:card|panel|tile|callout|alert)(?:$|[\s,.#:_-])/.test(s);

module.exports = [
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
    const cards = new Set(elements.filter((el) => [...el.classes].some((c) => /^(?:card|panel|tile)(?:$|[-_])/.test(c))));
    for (const row of rows) if (pixels(row.props['border-radius']) > 0 && (background(row.props) || row.props.border || row.props['box-shadow'])) for (const el of targets(ctx, row)) cards.add(el);
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
