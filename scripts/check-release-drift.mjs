#!/usr/bin/env node
/**
 * Refuse to ship code under a version that is already published.
 *
 * ⛔ WHY — reported by Adam 2026-09-15, in these words:
 *
 *   "your repaired source and installed CLI both claim to be v2.23.0, but
 *    contain different code. That is why solid update cannot know an update
 *    exists."
 *
 * Exactly right, and it is the defect that hid all the others. 2.23.0 went to
 * npm on 2026-09-14. Six commits then landed on top of it — including the two
 * that re-point the MCP credential on login and switch — and the version was
 * never bumped. So:
 *
 *   • `solid update` compares 2.23.0 to 2.23.0 and correctly reports "current"
 *   • the operator's machine runs code WITHOUT the fixes
 *   • the repo demonstrably HAS the fixes
 *   • both are "2.23.0", so no one can tell which one they are looking at
 *
 * A fix that exists only in git is not a fix. This makes that state fail loudly
 * at publish time instead of silently at the user's terminal.
 *
 * Checks, in order of how much they can prove:
 *   1. Have any src/ commits landed since the last `chore(release):` commit?
 *   2. If so, does package.json still carry the same version that release set?
 *   3. (network, best-effort) Is this exact version already on npm?
 *
 * Exit 1 on drift. `--warn` downgrades to a warning for local runs.
 */

import { execFileSync } from 'child_process';
import { readFileSync } from 'fs';

const WARN_ONLY = process.argv.includes('--warn');

const sh = (cmd, args, opts = {}) =>
  execFileSync(cmd, args, { encoding: 'utf8', ...opts }).trim();

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const version = pkg.version;

const fail = [];
const note = [];

// 1 + 2 — git: is there unreleased source since the last release commit?
let releaseCommit = '';
try {
  // ⛔ NO --extended-regexp HERE. In ERE the parens in "chore(release):" are a
  // capture group, so the pattern matches "chorerelease:" and nothing real —
  // the check then silently found no release commit and passed. Git's default
  // basic regex treats them as literals, which is what we want.
  releaseCommit = sh('git', ['log', '-1', '--format=%H', '--grep=^chore(release):']);
} catch { /* no git, or no release commits yet */ }

if (releaseCommit) {
  const releasedVersion = (() => {
    try {
      const blob = sh('git', ['show', `${releaseCommit}:package.json`]);
      return JSON.parse(blob).version;
    } catch { return null; }
  })();

  let changed = [];
  try {
    changed = sh('git', ['diff', '--name-only', `${releaseCommit}..HEAD`, '--', 'src'])
      .split('\n').filter(Boolean);
  } catch { /* shallow clone */ }

  if (changed.length && releasedVersion === version) {
    fail.push(
      `${changed.length} source file(s) changed since the ${releasedVersion} release commit ` +
      `(${releaseCommit.slice(0, 8)}), but package.json still says ${version}.\n` +
      `    Published ${version} and this tree are DIFFERENT CODE under the SAME NAME.\n` +
      `    Bump the version before publishing.\n` +
      changed.slice(0, 12).map((f) => `      ${f}`).join('\n') +
      (changed.length > 12 ? `\n      … and ${changed.length - 12} more` : ''),
    );
  } else if (changed.length) {
    note.push(`${changed.length} source file(s) changed since ${releasedVersion}; version is now ${version}. Good.`);
  }
}

// 3 — npm, best effort. A publish into an existing version is rejected by the
// registry anyway; catching it here gives a readable reason instead of E403.
try {
  // stdio 'pipe' keeps npm's own E404 block off our output — for THIS check a
  // 404 is the success case, and printing a red error under it is how a passing
  // guard gets read as a failing one.
  const published = sh('npm', ['view', `${pkg.name}@${version}`, 'version'], { stdio: 'pipe' });
  if (published === version) {
    fail.push(
      `${pkg.name}@${version} is ALREADY on npm. Publishing would be refused, and ` +
      `anyone on ${version} has no way to discover this build. Bump the version.`,
    );
  }
} catch (e) {
  // ⛔ DISTINGUISH THE TWO FAILURES. A 404 means "this version is free" — the
  // outcome we want. Anything else means we could not ask. Reporting the first
  // as "registry not reachable" tells the operator the check was skipped when
  // it in fact passed, which is precisely the sort of confidently-wrong status
  // line this whole release exists to delete.
  const out = `${e?.stderr ?? ''}${e?.stdout ?? ''}`;
  if (/E404|No match found for version|is not in this registry/i.test(out)) {
    note.push(`${version} is not on npm yet — free to publish.`);
  } else {
    note.push('Could not reach the npm registry — skipped the published-version check.');
  }
}

for (const n of note) console.log(`  · ${n}`);

if (fail.length === 0) {
  console.log(`  ✓ release drift: none — ${pkg.name}@${version} is unpublished and matches this tree.`);
  process.exit(0);
}

console.error('');
console.error(`  ✗ RELEASE DRIFT — ${pkg.name}@${version}`);
console.error('');
for (const f of fail) console.error(`    ${f}\n`);

if (WARN_ONLY) {
  console.error('  (--warn: not failing the run)');
  process.exit(0);
}
process.exit(1);
