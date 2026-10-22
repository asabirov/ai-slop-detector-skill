'use strict';

const assert = require('node:assert/strict');
const { test } = require('./budget');
const { parse } = require('./html');
const { detect } = require('../detect');

// Exact streams preserve the detector's existing leading Markdown markers.
const cases = [
  ["sibling code 1. 2. ", "1. Read `hidden\n2. ↗`", ["1. Read `hidden", "2. ↗`"], []],
  ["sibling attr 1. 2. ", "1. Read <span title=\"first\n2. second label\">shown ↗</span>", ["1. Read <span title=\"first", "2. second label\">shown ↗"], []],
  ["sibling code 1. 02. ", "1. Read `hidden\n02. ↗`", ["1. Read `hidden", "02. ↗`"], []],
  ["sibling attr 1. 02. ", "1. Read <span title=\"first\n02. second label\">shown ↗</span>", ["1. Read <span title=\"first", "02. second label\">shown ↗"], []],
  ["sibling code 1. 2) ", "1. Read `hidden\n2) ↗`", ["1. Read `hidden", "2) ↗`"], []],
  ["sibling attr 1. 2) ", "1. Read <span title=\"first\n2) second label\">shown ↗</span>", ["1. Read <span title=\"first", "2) second label\">shown ↗"], []],
  ["sibling code - 2. ", "- Read `hidden\n2. ↗`", ["Read `hidden", "2. ↗`"], []],
  ["sibling attr - 2. ", "- Read <span title=\"first\n2. second label\">shown ↗</span>", ["Read <span title=\"first", "2. second label\">shown ↗"], []],
  ["sibling code - 02. ", "- Read `hidden\n02. ↗`", ["Read `hidden", "02. ↗`"], []],
  ["sibling attr - 02. ", "- Read <span title=\"first\n02. second label\">shown ↗</span>", ["Read <span title=\"first", "02. second label\">shown ↗"], []],
  ["sibling code - 2) ", "- Read `hidden\n2) ↗`", ["Read `hidden", "2) ↗`"], []],
  ["sibling attr - 2) ", "- Read <span title=\"first\n2) second label\">shown ↗</span>", ["Read <span title=\"first", "2) second label\">shown ↗"], []],
  ["sibling code > 1. 2. ", "> 1. Read `hidden\n> 2. ↗`", ["> 1. Read `hidden", "> 2. ↗`"], []],
  ["sibling attr > 1. 2. ", "> 1. Read <span title=\"first\n> 2. second label\">shown ↗</span>", ["> 1. Read <span title=\"first", "> 2. second label\">shown ↗"], []],
  ["sibling code > 1. 02. ", "> 1. Read `hidden\n> 02. ↗`", ["> 1. Read `hidden", "> 02. ↗`"], []],
  ["sibling attr > 1. 02. ", "> 1. Read <span title=\"first\n> 02. second label\">shown ↗</span>", ["> 1. Read <span title=\"first", "> 02. second label\">shown ↗"], []],
  ["sibling code > 1. 2) ", "> 1. Read `hidden\n> 2) ↗`", ["> 1. Read `hidden", "> 2) ↗`"], []],
  ["sibling attr > 1. 2) ", "> 1. Read <span title=\"first\n> 2) second label\">shown ↗</span>", ["> 1. Read <span title=\"first", "> 2) second label\">shown ↗"], []],
  ["lazy setext code - ", "- Read `hidden\n===\n↗`", ["Read"], []],
  ["lazy setext plain - ", "- Read first\n===\nsecond ↗", ["Read first === second ↗"], []],
  ["lazy setext attr - ", "- Read <span title=\"first\n===\nsecond label\">shown ↗</span>", ["Read", "shown ↗"], ["first === second label"]],
  ["lazy setext code > ", "> Read `hidden\n===\n↗`", ["> Read"], []],
  ["lazy setext plain > ", "> Read first\n===\nsecond ↗", ["> Read first === second ↗"], []],
  ["lazy setext attr > ", "> Read <span title=\"first\n===\nsecond label\">shown ↗</span>", ["> Read", "shown ↗"], ["first === second label"]],
  ["numeric one 01. ", "Read `hidden\n01. ↗`", ["Read `hidden", "01. ↗`"], []],
  ["numeric one 0001) ", "Read `hidden\n0001) ↗`", ["Read `hidden", "0001) ↗`"], []],
  ["empty ordered marker", "Read `hidden\n1. \n↗`", ["Read"], []],
  ["unquoted raw script\"", "<script>hidden</script x=a\"b><span title=\"label value\">shown ↗</span>", ["shown ↗"], ["label value"]],
  ["inline rejected script\"", "Read <script>hidden</script x=\"</script>\"><span title=\"label value\">shown ↗</span>", ["Read \">", "shown ↗"], ["label value"]],
  ["unquoted raw script'", "<script>hidden</script x=a'b><span title=\"label value\">shown ↗</span>", ["shown ↗"], ["label value"]],
  ["inline rejected script'", "Read <script>hidden</script x='</script>'><span title=\"label value\">shown ↗</span>", ["Read '>", "shown ↗"], ["label value"]],
  ["unquoted raw style\"", "<style>hidden</style x=a\"b><span title=\"label value\">shown ↗</span>", ["shown ↗"], ["label value"]],
  ["inline rejected style\"", "Read <style>hidden</style x=\"</style>\"><span title=\"label value\">shown ↗</span>", ["Read \">", "shown ↗"], ["label value"]],
  ["unquoted raw style'", "<style>hidden</style x=a'b><span title=\"label value\">shown ↗</span>", ["shown ↗"], ["label value"]],
  ["inline rejected style'", "Read <style>hidden</style x='</style>'><span title=\"label value\">shown ↗</span>", ["Read '>", "shown ↗"], ["label value"]],
  ["inline rejected unquoted", "Read <script>hidden</script x=</script>>shown ↗", ["Read >shown ↗"], []],
  ["tab fence close", "> ~~~\n> \t~~~\n> ↗\n> ~~~", ["> ↗"], []],
  ["ordinary continuation 2. ", "Read <span title=\"first\n2. second label\">shown ↗</span>", ["Read", "shown ↗"], ["first 2. second label"]],
  ["ordinary continuation 123) ", "Read <span title=\"first\n123) second label\">shown ↗</span>", ["Read", "shown ↗"], ["first 123) second label"]],
  ["ordinary code continuation", "Read `hidden\n2. ↗`", ["Read"], []],
  ["lazy quote attribute", "> Read <span title=\"first\nsecond label\">shown ↗</span>", ["> Read", "shown ↗"], ["first second label"]],
  ["explicit quote attribute", "> Read <span title=\"first\n> second label\">shown ↗</span>", ["> Read", "shown ↗"], ["first second label"]],
  ["atx heading", "# Read <span title=\"first\nsecond label\">shown ↗</span>", ["Read <span title=\"first", "second label\">shown ↗"], []],
  ["setext heading", "Read <!--hidden\n===\nvisible ↗ -->", ["Read <!--hidden", "visible ↗ -->"], []],
  ["setext inside list", "- Read `hidden\n  ===\n  ↗`", ["Read `hidden", "↗`"], []],
  ["extra quote fence", "> ~~~\n> > ~~~\n> ↗\n> ~~~", [], []],
  ["quoted raw control script", "<script>hidden</script x=\"a>↗b\"><span title=\"label value\">shown</span>", ["shown"], ["label value"]],
  ["escaped tag control script", "Read <script>\\<x title=\"`\">hidden</script><span title=\"label value\">shown ↗</span> ` tail", ["Read"], []],
  ["escaped comment control script", "Read <script>\\<!-- ` -->hidden</script><span title=\"label value\">shown ↗</span> ` tail", ["Read"], []],
  ["quoted raw control style", "<style>hidden</style x=\"a>↗b\"><span title=\"label value\">shown</span>", ["shown"], ["label value"]],
  ["escaped tag control style", "Read <style>\\<x title=\"`\">hidden</style><span title=\"label value\">shown ↗</span> ` tail", ["Read"], []],
  ["escaped comment control style", "Read <style>\\<!-- ` -->hidden</style><span title=\"label value\">shown ↗</span> ` tail", ["Read"], []],
  ["indented child after quote 1. > code", "1. > Read `hidden\n    2. ↗`", ["1. > Read `hidden", "2. ↗`"], []],
  ["indented child after quote 1. > comment", "1. > Read <!-- hidden\n    2. ↗ -->", ["1. > Read <!-- hidden", "2. ↗ -->"], []],
  ["indented child after quote 1. > attribute", "1. > Read <span title=\"first\n    2. second label\">shown ↗</span>", ["1. > Read <span title=\"first", "2. second label\">shown ↗"], []],
  ["indented child after quote - > code", "- > Read `hidden\n    2. ↗`", ["> Read `hidden", "2. ↗`"], []],
  ["indented child after quote - > comment", "- > Read <!-- hidden\n    2. ↗ -->", ["> Read <!-- hidden", "2. ↗ -->"], []],
  ["indented child after quote - > attribute", "- > Read <span title=\"first\n    2. second label\">shown ↗</span>", ["> Read <span title=\"first", "2. second label\">shown ↗"], []],
  ["owned setext after lazy line - code", "- Read `hidden\nlazy\n  ===\n  ↗`", ["Read `hidden lazy", "↗`"], []],
  ["owned setext after lazy line - comment", "- Read <!-- hidden\nlazy\n  ===\n  ↗ -->", ["Read <!-- hidden lazy", "↗ -->"], []],
  ["owned setext after lazy line - attribute", "- Read <span title=\"first\nlazy\n  ===\n  second label\">shown ↗</span>", ["Read <span title=\"first lazy", "second label\">shown ↗"], []],
  ["owned setext after lazy line 1. code", "1. Read `hidden\nlazy\n   ===\n   ↗`", ["1. Read `hidden lazy", "↗`"], []],
  ["owned setext after lazy line 1. comment", "1. Read <!-- hidden\nlazy\n   ===\n   ↗ -->", ["1. Read <!-- hidden lazy", "↗ -->"], []],
  ["owned setext after lazy line 1. attribute", "1. Read <span title=\"first\nlazy\n   ===\n   second label\">shown ↗</span>", ["1. Read <span title=\"first lazy", "second label\">shown ↗"], []],
];

for (const [name, source, runs, attrs] of cases) {
  test(`container and close ownership: ${name}`, { timeout: 1000 }, () => {
    const actual = parse(source, { ext: 'md' });
    assert.deepEqual({ runs: actual.runs, attrs: actual.attrs }, { runs, attrs });
    const arrow = detect(source, { ext: 'md', kind: 'artifact', level: 1 })
      .findings.some(({ rule }) => rule === 'external-link-arrow');
    assert.equal(arrow, [...runs, ...attrs].some((text) => text.includes('↗')));
  });
}
