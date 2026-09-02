# Rules for anything working in this repo

## Run the tests of what you changed

```bash
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

## The plugin's copy is generated

`skills/ai-slop-detector/SKILL.md` and `docs/ai-slop-detector.md` in
`apliteni/claude-apliteni-plugin` are written by `.github/workflows/sync-plugin.yml`
in this repo. The plugin gets those two pages and none of the code, so the page it
gets is `plugin-stub.md` rather than `SKILL.md` — `SKILL_PAGE` in that workflow picks
which, and moves the code with it. An edit made there is overwritten by the next sync
and is invisible here. Change it here.

## A rule change is tested both ways

A new or changed rule needs a triggering case in a slop fixture, and every
`fixtures/clean.*` has to stay silent at paranoid. A clean fixture that starts
firing means the rule is too aggressive. Never edit a fixture to make a test
pass; that deletes the test.
