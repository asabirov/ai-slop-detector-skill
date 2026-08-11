'use strict';

// Rule registry. Three packs — visual (markup/CSS), text (prose) and comments
// (source files) — merged into one ordered list the engine walks. Adding a rule
// is a one-line push in the relevant pack; nothing in detect.js changes.
//
// A pack declares the context its rules read, so a text rule never scores a .js
// file and a comment rule never scores a page. The engine picks the packs whose
// kind matches the file in front of it.
//
// Every rule must carry: id (unique, kebab), level (1..4), severity
// ('error' | 'warning'), why, fix, and test(ctx) -> string[] hits.

const visual = require('./visual');
const text = require('./text');
const comments = require('./comments');

const KINDS = ['artifact', 'source'];

const withKind = (kind) => (rule) => ({ ...rule, kind });

const RULES = [
  ...visual.map(withKind('artifact')),
  ...text.map(withKind('artifact')),
  ...comments.map(withKind('source')),
];

// Fail loudly on a malformed or duplicate rule — a registry mistake should never
// slip through as "0 findings".
const seen = new Set();
for (const r of RULES) {
  for (const field of ['id', 'level', 'severity', 'why', 'fix', 'test', 'kind']) {
    if (r[field] == null) throw new Error(`rule ${r.id || '?'} missing "${field}"`);
  }
  if (typeof r.test !== 'function') throw new Error(`rule ${r.id} test is not a function`);
  if (!['error', 'warning'].includes(r.severity)) throw new Error(`rule ${r.id} bad severity`);
  if (![1, 2, 3, 4].includes(r.level)) throw new Error(`rule ${r.id} bad level`);
  if (!KINDS.includes(r.kind)) throw new Error(`rule ${r.id} bad kind`);
  if (seen.has(r.id)) throw new Error(`duplicate rule id: ${r.id}`);
  seen.add(r.id);
}

module.exports = { RULES, KINDS, visual, text, comments };
