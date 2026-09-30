#!/usr/bin/env node
'use strict';

// The README pins an install tag, and a release leaves that pin a version
// behind. `main` takes no push, so the release workflow cannot fix it in place;
// it runs this to produce the one-file change and opens a pull request with it.
//
// This compares the README against the newest release tag on the remote rather
// than against whatever tag the run just cut. The two agree on a normal
// release, and they part company when a run cut a tag but failed before its
// pull request existed: comparing against the remote retries that on the next
// run instead of losing it, and it cannot mistake a concurrent run's tag for
// its own.

const fs = require('node:fs');

const RELEASE_TAG = /^v\d+\.\d+\.\d+$/;
const RELEASE_TAG_ANYWHERE = /v\d+\.\d+\.\d+/g;

// `git ls-remote --tags` prints `<sha>\trefs/tags/<name>`. An annotated tag
// prints a second `<name>^{}` line for the commit it points at, and the release
// shape drops it along with every tag that is not a release.
function releaseTags(lsRemoteOutput) {
  const tags = new Set();
  for (const line of lsRemoteOutput.split('\n')) {
    const ref = line.split('\t')[1];
    if (!ref) continue;
    const name = ref.trim().replace(/^refs\/tags\//, '');
    if (RELEASE_TAG.test(name)) tags.add(name);
  }
  return tags;
}

function versionOrder(tag) {
  const [major, minor, patch] = tag.slice(1).split('.').map(Number);
  return major * 1e12 + minor * 1e6 + patch;
}

function latestReleaseTag(lsRemoteOutput) {
  const tags = [...releaseTags(lsRemoteOutput)];
  if (tags.length === 0) return null;
  return tags.sort((a, b) => versionOrder(b) - versionOrder(a))[0];
}

// Every `vX.Y.Z` in the README names the tag to install, in an install command,
// an `npx` git ref or the prose beside them. One replacement covers all of
// them, and a test holds the README to a single tag so a historical mention
// cannot be rewritten without somebody noticing.
function bumpReadmeTag(readme, tag) {
  if (!RELEASE_TAG.test(tag)) throw new Error(`not a release tag: ${tag}`);
  return readme.replace(RELEASE_TAG_ANYWHERE, tag);
}

// Prints the tag after rewriting the README, or nothing when the README already
// names the newest release and when there is no release to name. The caller
// opens a pull request only when something is printed.
function main(argv) {
  const flags = new Map();
  for (let i = 0; i + 1 < argv.length; i += 2) flags.set(argv[i], argv[i + 1]);
  for (const flag of ['--tags', '--readme']) {
    if (!flags.has(flag)) throw new Error(`missing ${flag}`);
  }

  const tag = latestReleaseTag(fs.readFileSync(flags.get('--tags'), 'utf8'));
  if (!tag) return '';

  const path = flags.get('--readme');
  const readme = fs.readFileSync(path, 'utf8');
  const bumped = bumpReadmeTag(readme, tag);
  if (bumped === readme) return '';
  fs.writeFileSync(path, bumped);
  return tag;
}

module.exports = { releaseTags, latestReleaseTag, bumpReadmeTag, main };

if (require.main === module) {
  process.stdout.write(main(process.argv.slice(2)));
}
