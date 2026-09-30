// Throwaway: asserts something false so the required `test` check has to go
// red on this head. Reverted in the next commit; see pull request #49.
const { test } = require('./lib/budget');
const assert = require('node:assert');

test('deliberately broken, to prove the required check fails a red suite', () => {
  assert.equal(1, 2);
});
