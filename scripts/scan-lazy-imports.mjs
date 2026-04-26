#!/usr/bin/env node
// Tarball install scanner: every external package referenced via
// `import('<pkg>')` or `require('<pkg>')` in the *installed* dist/ must be
// resolvable from the install root. Catches the v2.1.0-class regression
// where a runtime dep is missing from package.json — which `--help` can't
// catch because the import is lazy inside the action handler.
//
// This is the install-based check, run from scripts/test-tarball.sh after
// `npm install <tarball>`. For the static (no-install) variant safe inside
// `prepublishOnly`, see scripts/verify-runtime-deps.mjs.
//
// Usage: node scan-lazy-imports.mjs <installRoot>
//   installRoot = directory where `npm install <tarball>` was run.
//   Looks for the package at <installRoot>/node_modules/@solidnumber/cli/dist.

import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { statSync } from 'node:fs';
import { externalDepsInDist } from './lib/dist-imports.mjs';

const installRoot = process.argv[2];
if (!installRoot) {
  console.error('Usage: scan-lazy-imports.mjs <installRoot>');
  process.exit(2);
}

const distDir = resolve(installRoot, 'node_modules/@solidnumber/cli/dist');
try {
  if (!statSync(distDir).isDirectory()) throw new Error('not a dir');
} catch {
  console.error(`✗ Expected installed package at ${distDir}`);
  process.exit(2);
}

const externals = externalDepsInDist(distDir);
const req = createRequire(join(installRoot, 'package.json'));

const missing = [];
for (const dep of [...externals].sort()) {
  try {
    req.resolve(dep);
  } catch {
    missing.push(dep);
  }
}

if (missing.length > 0) {
  console.error(`\n✗ Missing ${missing.length} runtime dep(s) in installed tarball:`);
  for (const dep of missing) console.error(`    - ${dep}`);
  console.error('\nThese are referenced via import()/require() in dist/ but not present');
  console.error('in node_modules after `npm install <tarball>`. Add them to');
  console.error('package.json `dependencies` (NOT devDependencies).\n');
  process.exit(1);
}

console.log(`  ✓ All ${externals.size} external deps resolved`);
