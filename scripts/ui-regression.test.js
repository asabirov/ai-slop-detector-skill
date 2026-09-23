'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { detect } = require('./detect');
test('native font stacks and numeric table cells pass the merge gate', { timeout: 1000 }, () => {
  const html = '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif}.num{font-family:ui-monospace,monospace}</style><table><tr><td class="num">1,204.50</td></tr></table>';
  assert.deepEqual(detect(html, { level: 1, ext: 'html' }).findings, []);
});

test('pale Tailwind backgrounds do not become saturated accents', { timeout: 1000 }, () => {
  const html = '<div class="bg-blue-50"></div><div class="bg-red-50"></div><div class="bg-green-50"></div>';
  assert.equal(detect(html, { level: 4, ext: 'html' }).findings.some((f) => f.rule === 'accent-budget'), false);
});
