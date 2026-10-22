'use strict';
const { test } = require('./lib/budget');
const assert = require('node:assert/strict');
const { pageOf } = require('./bench');

test('bench builds a page of the asked size from a fixture body', { timeout: 1000 }, () => {
  const page = pageOf('slop.html', 0.1);
  assert.ok(page.length >= 0.1 * 1024 * 1024);
  assert.ok(page.length < 0.2 * 1024 * 1024);
  assert.match(page, /<\/body>\s*<\/html>\s*$/i);
});
