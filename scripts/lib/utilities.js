'use strict';

// Static utility values only: project configuration and runtime expressions
// need the generated CSS. Synthetic classes bind each declaration to its node.
const COLORS = { purple: '#9333ea', violet: '#8b5cf6', pink: '#ec4899', fuchsia: '#d946ef', blue: '#3b82f6', indigo: '#6366f1', cyan: '#06b6d4', red: '#ef4444', green: '#22c55e', orange: '#f97316', white: '#ffffff', black: '#000000', gray: '#9ca3af', slate: '#94a3b8' };
const SIMPLE = {
  'bg-clip-text': 'background-clip:text', 'backdrop-blur': 'backdrop-filter:blur(8px)',
  'rounded-full': 'border-radius:9999px', rounded: 'border-radius:4px',
  'rounded-lg': 'border-radius:8px', 'rounded-xl': 'border-radius:12px',
  'rounded-2xl': 'border-radius:16px', 'rounded-3xl': 'border-radius:24px',
  'text-center': 'text-align:center', 'text-left': 'text-align:left',
  'text-start': 'text-align:start', 'text-justify': 'text-align:justify',
  grid: 'display:grid', flex: 'display:flex', border: 'border:1px solid #9ca3af',
  'font-mono': 'font-family:ui-monospace,monospace',
  'font-bold': 'font-weight:700', 'font-extrabold': 'font-weight:800',
  'text-5xl': 'font-size:48px', 'text-6xl': 'font-size:60px',
  'text-7xl': 'font-size:72px', 'text-8xl': 'font-size:96px',
  'animate-bounce': 'animation:bounce 1s infinite', uppercase: 'text-transform:uppercase',
};
function color(value) {
  if (value.startsWith('[') && value.endsWith(']')) return value.slice(1, -1).replaceAll('_', ' ');
  const shade = /-(\d+)$/.exec(value);
  if (shade && (Number(shade[1]) < 300 || Number(shade[1]) > 700)) return null;
  return COLORS[value.split('-')[0]];
}
function elementCss(elements) {
  const blocks = [];
  elements.forEach((el, index) => {
    const declarations = [];
    const stops = [];
    let gradient = false;
    let borderColor = 'currentColor';
    for (const token of el.classes) {
      const match = /^border-([a-z]+-\d+)$/.exec(token);
      if (match && color(match[1])) borderColor = color(match[1]);
    }
    for (const token of el.classes) {
      // Variants can apply conditionally; keep them out of aggregate defaults.
      if (token.includes(':') && !token.startsWith('[')) continue;
      if (SIMPLE[token]) declarations.push(SIMPLE[token]);
      else if (/^backdrop-blur-(?:sm|md|lg|xl|2xl|3xl)$/.test(token)) declarations.push('backdrop-filter:blur(12px)');
      else if (/^bg-(?:gradient-to|linear-to)-/.test(token)) gradient = true;
      else if (/^(?:from|via|to)-/.test(token)) {
        const c = color(token.slice(token.indexOf('-') + 1));
        if (c) stops.push(c);
      } else {
        const arbitrary = /^(rounded|shadow|ease|backdrop-blur|text|bg)-\[([^\]]{1,512})\]$/.exec(token);
        if (arbitrary) {
          const prop = { rounded: 'border-radius', shadow: 'box-shadow', ease: 'transition-timing-function', 'backdrop-blur': 'backdrop-filter', text: 'font-size', bg: 'background' }[arbitrary[1]];
          const value = arbitrary[2].replaceAll('_', ' ');
          declarations.push(`${prop}:${arbitrary[1] === 'backdrop-blur' ? `blur(${value})` : value}`);
        }
        const bg = /^bg-([a-z]+(?:-\d+)?)$/.exec(token);
        if (bg && color(bg[1])) declarations.push(`background-color:${color(bg[1])}`);
        const size = /^(h|p)-(\d+)$/.exec(token);
        if (size) declarations.push(`${size[1] === 'h' ? 'height' : 'padding'}:${Number(size[2]) * 4}px`);
        const border = /^border-([lrtb])-(\d+)$/.exec(token);
        if (border) declarations.push(`border-${{ l: 'left', r: 'right', t: 'top', b: 'bottom' }[border[1]]}:${border[2]}px solid ${borderColor}`);
      }
    }
    if (gradient && stops.length >= 2) declarations.push(`background:linear-gradient(90deg,${stops.join(',')})`);
    if (el.style) declarations.push(el.style);
    if (!declarations.length) return;
    const cls = `__slop_inline_${index}`;
    el.classes.add(cls);
    blocks.push(`.${cls}{${declarations.join(';')}}`);
  });
  return blocks.join('\n');
}
module.exports = { elementCss };
