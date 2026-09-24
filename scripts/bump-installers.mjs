#!/usr/bin/env node
// postpublish: make Homebrew and scoop serve the version we just published.
//
// Both channels bump themselves on a 4-hour cron (solidnumber/homebrew-tap,
// solidnumber/scoop-bucket — "Auto-bump from npm"). GitHub delays scheduled runs,
// so a release could sit hours behind npm: 2.24.7 published 20:19Z, the tap had
// run at 19:59Z, and `install.sh` on a brew machine installed 2.24.6. The cron
// stays as the fallback; this kicks both jobs the moment npm serves the version.
//
// Never fails the publish: the package is already on npm when this runs.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { name, version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const REPOS = ['solidnumber/homebrew-tap', 'solidnumber/scoop-bucket'];
const WORKFLOW = 'Auto-bump from npm';

async function registryVersion() {
  try {
    const r = await fetch(`https://registry.npmjs.org/${name}`, { headers: { 'cache-control': 'no-cache' } });
    return (await r.json())?.['dist-tags']?.latest ?? null;
  } catch {
    return null;
  }
}

// The bump jobs read npm; wait until the registry serves this version or they
// will re-read the old one and report "already current".
let seen = null;
for (let i = 0; i < 24 && seen !== version; i++) {
  seen = await registryVersion();
  if (seen !== version) await new Promise((r) => setTimeout(r, 5000));
}
if (seen !== version) {
  console.warn(`[bump-installers] npm still serves ${seen ?? 'nothing'} for ${name}, not ${version}.`);
}

for (const repo of REPOS) {
  try {
    execFileSync('gh', ['workflow', 'run', WORKFLOW, '--repo', repo], { stdio: 'pipe' });
    console.log(`[bump-installers] ${repo}: "${WORKFLOW}" started for ${version}`);
  } catch (e) {
    console.warn(`[bump-installers] ${repo}: could not start "${WORKFLOW}" (${String(e.stderr || e.message).trim()}).`);
    console.warn(`  Run it by hand: gh workflow run "${WORKFLOW}" --repo ${repo}`);
  }
}
