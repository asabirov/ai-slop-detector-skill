'use strict';
const { test } = require('./lib/budget');
const assert = require('node:assert/strict');
const { pageOf, measure } = require('./bench');

test('bench builds a page of the asked size from a fixture body', { timeout: 1000 }, () => {
  const page = pageOf('slop.html', 0.1);
  assert.ok(page.length >= 0.1 * 1024 * 1024);
  assert.ok(page.length < 0.2 * 1024 * 1024);
  assert.match(page, /<\/body>\s*<\/html>\s*$/i);
});

test('bench reports positive ms per MB for the parse step and the rules', { timeout: 5000 }, () => {
  const figures = measure({ fixture: 'clean.html', mb: 0.05, runs: 1 });
  assert.ok(figures.parse > 0 && Number.isFinite(figures.parse));
  assert.ok(figures.rules >= 0 && Number.isFinite(figures.rules));
});
