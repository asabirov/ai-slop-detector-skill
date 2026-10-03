# Rules for anything working in this repo

## Run the tests of what you changed

```bash
npm run verify     # both of the below, and the one script CI runs
npm test           # unit tests and fixtures
npm run lint:self  # the detector must pass its own rules
```

## Test the function, not the process

One test per entry point proves the command line is wired. Every other
assertion calls the function directly.

An assertion taken through a subprocess costs about three orders of magnitude
more than the same assertion taken through a function call, and it proves
nothing the one wiring test has not already proved.

## Every suite has a per-test budget

A suite without one degrades where nobody is looking, and the first sign of it
is a timeout on a busy machine. Raising the budget to get a green run treats
the symptom and loses the signal.

Take `test`, `it` and `describe` from `scripts/lib/budget.js`, never straight
from `node:test`, and declare the budget as `{ timeout: ms }`. node's timeout
cancels a test that is awaiting something and cannot interrupt one that is
blocking the thread, so on its own it lets a slow synchronous test through.
The wrapper times each body as well, `describe` included, so a body over its
budget fails when it returns, synchronous work included.

The budget is measured, not interrupted, and it measures the body it was
given. A test that never returns is a hang rather than a budget breach; work
started and neither returned nor awaited is invisible to it; and the
`before`/`after` hooks carry no budget, only the tests they set up do.

## A test earns its place by failing first

Write the code, then the test, in the same change. Test-first is not the rule
here; watching the test fail before trusting it is.

The exception is a bug somebody reported. Write that test first and show it
failing, because that is the only thing proving the fix addresses what they hit
rather than something beside it.

## Prove by running, not by reading

A test asserting that a file contains the right string passes whether or not
the thing that string names actually works.

## The README is the spec

It says what this does today, and it opens by naming the choice this design
makes, the alternatives it turned down, and the fact that decided between them.
A change is finished when that file matches what shipped.

## A rule change is tested both ways

A new or changed rule needs a triggering case in a slop fixture, and every
`fixtures/clean.*` has to stay silent at paranoid. A clean fixture that starts
firing means the rule is too aggressive. Never edit a fixture to make a test
pass; that deletes the test.

## Every change ships with examples

Every change must include examples. Show one case that was fine before but
warns or fails after. Also show a similar case that stays silent both times.

Include a diff of the tool's real output before and after. A summary is not
enough.

For editorial rules there is no fixture. Run the review twice: once against the
rule text on the default branch, once against the branch's. Diff both results.
