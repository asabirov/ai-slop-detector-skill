#!/usr/bin/env node
'use strict';

// CLI: score many files in one run, so a repo can gate on it.
//
//   slop-detector site/ src/ --level 1
//   slop-detector 'src/**/*.js' --json
//   slop-detector page.html README.md
//
// Arguments are files, directories (walked) or globs (* ? **). Each file is
// routed to its pack by extension; --as overrides. Exit 1 if any error fires.

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  detect, report, resolveLevel, kindForPath, verdictFor, VERDICT_ICON, LEVELS,
} = require('../scripts/detect');

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage', 'vendor',
  '.next', '.nuxt', '.venv', '__pycache__', 'storybook-static',
]);
const ARTIFACT_EXTS = new Set(['html', 'htm', 'md', 'markdown', 'txt']);

const USAGE =
  'usage: slop-detector <path|dir|glob>... [--level N|name] [--as source|artifact]\n' +
  '                     [--root <dir>]\n' +
  '                     [--ignore <glob,glob>] [--no-git-ignore] [--json]\n';

// Files git ignores are build output, and linting build output is noise no gate
// can act on. One `git check-ignore` call over the whole list; if git is absent
// or this is not a repository, nothing is dropped.
function dropGitIgnored(files) {
  if (files.length === 0) return files;
  const res = spawnSync('git', ['check-ignore', '--stdin'], {
    input: files.join('\n'),
    encoding: 'utf8',
  });
  if (res.error || res.status > 1) return files;
  const ignored = new Set(res.stdout.split('\n').filter(Boolean));
  return files.filter((f) => !ignored.has(f));
}

function isSkippable(name) {
  return SKIP_DIRS.has(name) || /\.min\.[a-z]+$/.test(name);
}

function scannable(file) {
  const ext = path.extname(file).replace(/^\./, '').toLowerCase();
  return ARTIFACT_EXTS.has(ext) || kindForPath(file) === 'source';
}

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (isSkippable(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile() && scannable(full)) out.push(full);
  }
  return out;
}

// Turn a glob into a regex: ** spans separators, * and ? do not.
function globToRegExp(pattern) {
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const c = pattern[i];
    if (c === '*') {
      if (pattern[i + 1] === '*') {
        out += '.*';
        i += 1;
        if (pattern[i + 1] === '/') i += 1;
      } else out += '[^/]*';
    } else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

function expand(arg) {
  if (/[*?]/.test(arg)) {
    const magic = arg.search(/[*?]/);
    const rootEnd = arg.lastIndexOf('/', magic);
    const root = rootEnd === -1 ? '.' : arg.slice(0, rootEnd) || '/';
    const re = globToRegExp(arg);
    return walk(root).filter((f) => re.test(f.replace(/^\.\//, '')));
  }
  let stat;
  try {
    stat = fs.statSync(arg);
  } catch {
    process.stderr.write(`cannot read ${arg}\n`);
    process.exitCode = 2;
    return [];
  }
  return stat.isDirectory() ? walk(arg) : [arg];
}

function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(USAGE);
    process.exit(argv.length === 0 ? 2 : 0);
  }
  const flagValue = (name) => {
    const i = argv.indexOf(name);
    return i !== -1 ? argv[i + 1] : undefined;
  };
  const asJson = argv.includes('--json');
  const asKind = flagValue('--as');
  const levelArg = flagValue('--level');
  const ignoreArg = flagValue('--ignore');
  const rootArg = flagValue('--root');
  const consumed = new Set([levelArg, asKind, ignoreArg, rootArg].filter(Boolean));
  const paths = argv.filter((a) => !a.startsWith('--') && !consumed.has(a));
  const ignores = (ignoreArg ? ignoreArg.split(',') : []).map((g) => globToRegExp(g.trim()));

  let level;
  try {
    level = resolveLevel(levelArg);
  } catch (err) {
    process.stderr.write(err.message + '\n');
    process.exit(2);
  }
  if (asKind && !['source', 'artifact'].includes(asKind)) {
    process.stderr.write(`unknown --as "${asKind}" (use source or artifact)\n`);
    process.exit(2);
  }

  // Root for a page's root-relative <link href="/assets/x.css">. Defaults to the
  // directory argument, which is where a built site's own absolute hrefs resolve.
  const siteRoot =
    rootArg ||
    paths.find((p) => {
      try {
        return fs.statSync(p).isDirectory();
      } catch {
        return false;
      }
    });

  let files = [...new Set(paths.flatMap(expand))].sort().map((f) => f.replace(/^\.\//, ''));
  if (ignores.length) files = files.filter((f) => !ignores.some((re) => re.test(f)));
  if (!argv.includes('--no-git-ignore')) files = dropGitIgnored(files);
  if (files.length === 0) {
    process.stderr.write('no files matched\n');
    process.exit(2);
  }

  const results = [];
  for (const file of files) {
    const rep = detect(fs.readFileSync(file, 'utf8'), {
      level,
      kind: asKind || kindForPath(file),
      ext: path.extname(file).replace(/^\./, ''),
      filePath: file,
      root: siteRoot,
    });
    results.push({ file, ...rep });
  }

  const total = (key) => results.reduce((n, r) => n + r.stats[key], 0);
  const errors = total('errors');
  const medium = total('medium');
  const warnings = total('warnings');
  const verdict = verdictFor(results.flatMap((r) => r.findings));

  if (asJson) {
    process.stdout.write(
      JSON.stringify(
        {
          verdict,
          level: LEVELS[level - 1],
          files: results,
          stats: { files: files.length, errors, medium, warnings },
        },
        null,
        2
      ) + '\n'
    );
  } else {
    const out = [];
    for (const r of results) {
      if (!r.findings.length) continue;
      out.push(`\n${r.file}`);
      out.push(report(r).split('\n').slice(1).join('\n'));
    }
    out.push(
      `${VERDICT_ICON[verdict]} ${verdict.toUpperCase()}  [level ${LEVELS[level - 1]}]  ` +
        `${files.length} file(s), ${errors} error(s), ${medium} medium, ${warnings} warning(s)`
    );
    process.stdout.write(out.join('\n') + '\n');
  }

  // exitCode, not exit(): process.exit() drops a large report that is still
  // draining into a pipe, which is exactly how CI reads this.
  process.exitCode = verdict === 'fail' ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { globToRegExp, expand, walk };
