'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { releaseTags, latestReleaseTag, bumpReadmeTag, main } = require('./release-readme-tag');

const SCRIPT = path.join(__dirname, 'release-readme-tag.js');
const README = path.join(__dirname, '..', 'README.md');

function lsRemote(...tags) {
  return tags.map((t) => `0000000000000000000000000000000000000000\trefs/tags/${t}`).join('\n') + '\n';
}

function scratch(readme, ...tags) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-readme-tag-'));
  fs.writeFileSync(path.join(dir, 'README.md'), readme);
  fs.writeFileSync(path.join(dir, 'tags'), lsRemote(...tags));
  return dir;
}

test('the newest release on the remote is the one to install', { timeout: 1000 }, () => {
  assert.equal(latestReleaseTag(lsRemote('v2.3.0', 'v2.2.0', 'v1.0.0')), 'v2.3.0');
});

test('a double-digit minor sorts above a single-digit one', { timeout: 1000 }, () => {
  assert.equal(latestReleaseTag(lsRemote('v2.9.0', 'v2.10.0')), 'v2.10.0');
});

test('a remote with no release tag names nothing', { timeout: 1000 }, () => {
  assert.equal(latestReleaseTag(lsRemote('nightly', 'v2.4.0-rc.1')), null);
});

test('a peeled annotated tag is not a tag of its own', { timeout: 1000 }, () => {
  assert.deepEqual([...releaseTags(lsRemote('v2.4.0', 'v2.4.0^{}'))], ['v2.4.0']);
});

test('the bump rewrites the install command and the prose beside it', { timeout: 1000 }, () => {
  const bumped = bumpReadmeTag(fs.readFileSync(README, 'utf8'), 'v9.9.9');
  assert.match(bumped, /skills add https:\/\/github\.com\/asabirov\/ai-slop-detector-skill\/tree\/v9\.9\.9 /);
  assert.match(bumped, /clone the repository at the `v9\.9\.9` release tag/);
  assert.match(bumped, /npx -y "\$REPO#v9\.9\.9"/);
  assert.equal(/v(?!9\.9\.9)\d+\.\d+\.\d+/.test(bumped), false);
});

test('the bump refuses anything that is not a release tag', { timeout: 1000 }, () => {
  assert.throws(() => bumpReadmeTag('# x', 'main'), /not a release tag/);
});

// The bump rewrites every vX.Y.Z in the README, so a sentence naming an older
// version would be rewritten into a false claim. This keeps that sentence out.
test('the README names one release tag and no other version', { timeout: 1000 }, () => {
  const found = new Set(fs.readFileSync(README, 'utf8').match(/v\d+\.\d+\.\d+/g));
  assert.equal(found.size, 1, `README names ${[...found].join(', ')}`);
});

test('a README behind the newest release is rewritten and the tag named', { timeout: 1000 }, () => {
  const dir = scratch('install .../tree/v2.3.0 --skill x\n', 'v2.3.0', 'v2.4.0');
  assert.equal(main(['--tags', path.join(dir, 'tags'), '--readme', path.join(dir, 'README.md')]), 'v2.4.0');
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'install .../tree/v2.4.0 --skill x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

// Without this the release workflow would try to commit an unchanged README on
// every merge to main and fail the job.
test('a README already naming the newest release names nothing', { timeout: 1000 }, () => {
  const dir = scratch('install .../tree/v2.4.0 --skill x\n', 'v2.3.0', 'v2.4.0');
  assert.equal(main(['--tags', path.join(dir, 'tags'), '--readme', path.join(dir, 'README.md')]), '');
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'install .../tree/v2.4.0 --skill x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('a remote with no release leaves the README alone', { timeout: 1000 }, () => {
  const dir = scratch('install .../tree/v2.3.0 --skill x\n', 'nightly');
  assert.equal(main(['--tags', path.join(dir, 'tags'), '--readme', path.join(dir, 'README.md')]), '');
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'install .../tree/v2.3.0 --skill x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});

// The only test here that spawns anything. It proves the command line reaches
// main(); every other case above calls main() or its parts directly, because a
// second spawn would cost a hundred times more and prove nothing new.
test('the command line reaches main and prints what it returns', { timeout: 2000 }, () => {
  const dir = scratch('install .../tree/v2.3.0 --skill x\n', 'v2.3.0', 'v2.4.0');
  const printed = execFileSync(process.execPath, [
    SCRIPT, '--tags', path.join(dir, 'tags'), '--readme', path.join(dir, 'README.md'),
  ], { encoding: 'utf8' });

  assert.equal(printed, 'v2.4.0');
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'install .../tree/v2.4.0 --skill x\n');
  fs.rmSync(dir, { recursive: true, force: true });
});
