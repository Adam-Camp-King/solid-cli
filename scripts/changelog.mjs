#!/usr/bin/env node
/**
 * One changelog, and a release cannot leave it behind.
 *
 * ⛔ WHY — 2026-09-30. 2.24.12 shipped to npm with no CHANGELOG.md entry: the file
 * stopped at 2.24.11, the npm package did not include it, and the GitHub tag had no
 * release. An AI asked "what changed?" had to download both tarballs and diff them.
 * The website's /docs/cli/changelog had the notes; nothing else did.
 *
 * CHANGELOG.md is the source. This makes it a release gate:
 *
 *   node scripts/changelog.mjs --check
 *       exit 1 unless CHANGELOG.md has `## [<package.json version>]`.
 *       Inside the monorepo, also unless the website carries the version:
 *       /docs/cli/changelog lists it and /docs/cli is stamped with it.
 *   node scripts/changelog.mjs --notes <version>
 *       print that version's section (for the GitHub release on the tag).
 *
 * Runs in prepublishOnly, so a version without notes cannot be published.
 */
import { existsSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = join(CLI, '..');
const SITE_CHANGELOG = join(ROOT, 'solid-public/src/app/docs/cli/changelog/page.tsx');
const SITE_DOCS = join(ROOT, 'solid-public/src/app/docs/cli/page.tsx');

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function section(changelog, version) {
  const lines = changelog.split('\n');
  const start = lines.findIndex((l) => new RegExp(`^## \\[${esc(version)}\\]`).test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^## \[/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start + 1, end).join('\n').trim();
}

function main(argv) {
  const changelog = readFileSync(join(CLI, 'CHANGELOG.md'), 'utf8');

  const notesAt = argv.indexOf('--notes');
  if (notesAt >= 0) {
    const version = String(argv[notesAt + 1] || '').replace(/^v/, '');
    const body = section(changelog, version);
    if (!body) {
      console.error(`CHANGELOG.md has no section for ${version}`);
      return 1;
    }
    process.stdout.write(body + '\n\nFull history: https://solidnumber.com/docs/cli/changelog\n');
    return 0;
  }

  if (argv.includes('--check')) {
    const version = JSON.parse(readFileSync(join(CLI, 'package.json'), 'utf8')).version;
    const problems = [];
    const body = section(changelog, version);
    if (!body) problems.push(`CHANGELOG.md has no "## [${version}]" section — write the release notes first.`);
    else if (body.length < 40) problems.push(`CHANGELOG.md's ${version} section is empty.`);

    const inMonorepo = existsSync(join(ROOT, 'Owners-Manual')) && existsSync(SITE_CHANGELOG);
    if (inMonorepo) {
      if (!readFileSync(SITE_CHANGELOG, 'utf8').includes(`version: "${version}"`)) {
        problems.push(`https://solidnumber.com/docs/cli/changelog has no ${version} entry — add it to solid-public/src/app/docs/cli/changelog/page.tsx.`);
      }
      if (existsSync(SITE_DOCS) && !readFileSync(SITE_DOCS, 'utf8').includes(version)) {
        problems.push(`https://solidnumber.com/docs/cli does not show ${version} — run npm run sync:counts.`);
      }
    } else {
      console.log('  · not inside the monorepo — website changelog not checked here.');
    }

    if (problems.length) {
      console.error(`✗ release notes for ${version}:\n  - ${problems.join('\n  - ')}`);
      return 1;
    }
    console.log(`✓ release notes for ${version}: CHANGELOG.md${inMonorepo ? ', /docs/cli/changelog, /docs/cli' : ''}.`);
    return 0;
  }

  console.error('usage: changelog.mjs --check | --notes <version>');
  return 2;
}

// Always run. An "am I the entry point?" path comparison skipped the gate silently
// when the path went through a symlink (macOS /var → /private/var) — exit 0, no
// output, nothing checked.
process.exit(main(process.argv.slice(2)));
