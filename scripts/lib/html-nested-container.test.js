'use strict';

const assert = require('node:assert/strict');
const { test } = require('./budget');
const { parse } = require('./html');
const { detect } = require('../detect');

function check(source, runs, attrs) {
  const actual = parse(source, { ext: 'md' });
  assert.deepEqual({ runs: actual.runs, attrs: actual.attrs }, { runs, attrs });
  assert.equal(detect(source, { ext: 'md', kind: 'artifact', level: 1 })
    .findings.some(({ rule }) => rule === 'external-link-arrow'),
  [...runs, ...attrs].some((text) => text.includes('↗')));
}

for (const fence of ['~~~', '```']) {
  for (const tag of ['div', 'section', 'script']) {
    test(`fence outside a list owns ${tag} with ${fence}`, { timeout: 1000 }, () => {
      const content = tag === 'script' ? '<script>hidden</script><span title="visible label">shown ↗</span>' :
        `<${tag} title="visible label">shown ↗</${tag}>`;
      check(`- Read\n${fence}\n${content}\n${fence}`, ['Read'], []);
      check(`- Read\n  ${fence}\n  ${content}\n  ${fence}`, ['Read'], []);
    });
  }
}

for (const tag of ['script', 'style', 'textarea']) {
  test(`same-line nested list owns raw ${tag}`, { timeout: 1000 }, () => {
    const source = `- - <${tag}>hidden\n    ~~~\n    </${tag}><span title="visible label">shown ↗</span>`;
    check(source, tag === 'textarea' ? ['hidden ~~~', 'shown ↗'] : ['shown ↗'], ['visible label']);
  });

  test(`same-line nested list accepts raw ${tag} closing slash`, { timeout: 1000 }, () => {
    const source = `- - <${tag}>hidden</${tag}/><span title="visible label">shown ↗</span>`;
    check(source, tag === 'textarea' ? ['hidden', 'shown ↗'] : ['shown ↗'], ['visible label']);
  });

  for (const content of ['~~~', `\`</${tag}>\``, `\\</${tag}>`]) {
    test(`list indentation retains quote for ${tag} ${content}`, { timeout: 1000 }, () => {
      const rest = content === '~~~' ? `~~~\n{p}</${tag}>` : `${content}\n{p}`;
      const source = (prefix) => `- > <${tag}>hidden\n${prefix}` +
        rest.replaceAll('{p}', prefix) + '<span title="visible label">shown ↗</span>';
      const expected = content === '~~~' ? [] : content.startsWith('`') ? ['`', '>'] : ['>'];
      if (tag === 'textarea') {
        if (content === '~~~') expected.push('hidden ~~~');
        else expected.splice(0, content.startsWith('`') ? 1 : 0,
          content.startsWith('`') ? 'hidden ` `' : 'hidden \\');
      }
      expected.push('shown ↗');
      check(source('    > '), expected, ['visible label']);
      check(source('  > '), expected, ['visible label']);
    });
  }
}

for (const source of [
  '- > - <script>hidden\n  > `</script>`\n  > <span title="visible label">shown ↗</span>',
  '- > - <script>hidden\n    ~~~\n    </script><span title="visible label">shown ↗</span>',
]) {
  test(`a nested raw item ends before its next leaf: ${source}`, { timeout: 1000 }, () => {
    check(source, [], []);
  });
}

test('a list fence ends before an unindented inline tag', { timeout: 1000 }, () => {
  check('- > Read\n  ~~~\n<span title="visible label">shown ↗</span>',
    ['> Read', 'shown ↗'], ['visible label']);
});

for (const close of ['`</script>`', '~~~\n>   </script>']) {
  test(`ending an outer item ends its descendants: ${close}`, { timeout: 1000 }, () => {
    check(`- > - <script>hidden\n>   ${close}\n>   <span title="visible label">shown ↗</span>`, [], []);
  });
}

for (const tag of ['script', 'textarea']) {
  test(`empty ancestor items retain the raw ${tag} owner`, { timeout: 1000 }, () => {
    const source = `-\n  -\n    - <${tag}>hidden\n      \`</${tag}>\`\n` +
      '      <span title="visible label">shown ↗</span>';
    check(source, ['-', '-', ...(tag === 'textarea' ? ['hidden ` `'] : ['`']), 'shown ↗'], ['visible label']);
  });
}
