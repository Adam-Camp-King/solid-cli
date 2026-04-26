#!/usr/bin/env node
// Static runtime-deps verifier — catches the v2.1.0-class regression
// (lighthouse declared as devDep, missing from `dependencies`, ships
// broken to npm consumers) without running `npm install`.
//
// Why static? `npm publish` runs prepublishOnly inside its locked process
// tree. An inner `npm pack`/`npm install` (the install-based scanner)
// recurses and exits 254. This pure-static check has zero npm activity,
// so it's safe to run during publish.
//
// Algorithm: walk dist/, collect every external `import('<pkg>')` /
// `require('<pkg>')`, and assert each appears in package.json
// `dependencies` (peerDependencies and optionalDependencies also count
// as legitimate declarations).
//
// Usage: node verify-runtime-deps.mjs [<projectRoot>]
//   projectRoot defaults to the script's parent (the repo root).

import { readFileSync, statSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { externalDepsInDist } from './lib/dist-imports.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(process.argv[2] ?? join(here, '..'));
const distDir = join(projectRoot, 'dist');
const pkgPath = join(projectRoot, 'package.json');

try {
  if (!statSync(distDir).isDirectory()) throw new Error('not a dir');
} catch {
  console.error(`✗ Expected built dist/ at ${distDir}. Run \`npm run build\` first.`);
  process.exit(2);
}

const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
const declared = new Set([
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys(pkg.peerDependencies ?? {}),
  ...Object.keys(pkg.optionalDependencies ?? {}),
]);

const externals = externalDepsInDist(distDir);
const undeclared = [...externals].filter((d) => !declared.has(d)).sort();

if (undeclared.length > 0) {
  console.error(`\n✗ ${undeclared.length} runtime dep(s) used in dist/ but missing from package.json:`);
  for (const d of undeclared) {
    const inDev = pkg.devDependencies && d in pkg.devDependencies;
    const tag = inDev ? ' (declared as devDependency — won\'t install for end users!)' : '';
    console.error(`    - ${d}${tag}`);
  }
  console.error('\nAdd to "dependencies" in package.json. devDependencies are stripped on');
  console.error('npm install, so a runtime dep declared as a devDep ships broken.\n');
  process.exit(1);
}

console.log(`  ✓ All ${externals.size} external deps declared in package.json dependencies`);
