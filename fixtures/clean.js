'use strict';

// Icon sizing. The rationale lives in docs/adr/0004-icon-cascade.md.

const DIMS = ['width', 'height'];
const LOGICAL = new Map([['inline-size', 'width'], ['block-size', 'height']]);

/**
 * Fold a logical dimension onto its physical counterpart.
 *
 * jsdom keeps `inline-size` in a cascade `width` never enters, so the two must
 * be compared in one spelling.
 *
 * @param {string} prop declaration name, either spelling
 * @param {object} [options]
 * @param {boolean} [options.strict] throw on an unknown name
 * @param {string} [options.mode] writing mode, defaults to horizontal
 * @returns {string} the physical name
 * @throws {TypeError} when strict and the name is unknown
 * @example fold('inline-size') // 'width'
 */
function fold(prop, options = {}) {
  const physical = LOGICAL.get(prop) || prop;
  if (options.strict && !DIMS.includes(physical)) throw new TypeError(prop);
  return physical;
}

// ─────────────────────────── measuring ───────────────────────────

function measure(el, prop) {
  return el.getPropertyValue(fold(prop));
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function normalize(rules) {
  return rules.map((rule) => fold(rule));
}

// Case-insensitive: CSS property names are, and cssstyle lower-cases them.
function lookup(style, prop) {
  return style.getPropertyValue(fold(prop).toLowerCase());
}

function widest(elements, prop) {
  return elements.reduce((max, el) => Math.max(max, Number(measure(el, prop))), 0);
}

function refuse(rules, banned) {
  return rules.filter((rule) => !banned.includes(fold(rule)));
}

module.exports = { fold, measure, clamp, normalize, lookup, widest, refuse, DIMS };
