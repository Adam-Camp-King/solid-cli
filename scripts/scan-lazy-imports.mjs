#!/usr/bin/env node
// Static scan: every `import('<pkg>')` and `require('<pkg>')` string in the
// installed tarball must resolve. Catches the v2.1.0-class regression where
// a runtime dep (lighthouse) was missing from package.json — which `--help`
// can't catch because the import is lazy inside the action handler.
//
// Uses acorn AST walking so template literals (e.g., `solid init` scaffolds
// `require('express')` into the user's starter project, not ours) don't
// produce false positives.
//
// Usage: node scan-lazy-imports.mjs <installRoot>
//   installRoot = directory where `npm install <tarball>` was run.
//   Looks for the package at <installRoot>/node_modules/@solidnumber/cli/dist.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { builtinModules, createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { parse } from 'acorn';

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

const builtins = new Set(builtinModules);

function walkAst(node, visit) {
  if (!node || typeof node !== 'object') return;
  visit(node);
  for (const key of Object.keys(node)) {
    if (key === 'loc' || key === 'range' || key === 'parent') continue;
    const child = node[key];
    if (Array.isArray(child)) for (const c of child) walkAst(c, visit);
    else if (child && typeof child.type === 'string') walkAst(child, visit);
  }
}

function specsInFile(src) {
  const specs = new Set();
  let ast;
  try {
    ast = parse(src, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
  } catch {
    // Fall back to module mode (some files may be ESM-compiled).
    try {
      ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
      return specs;
    }
  }
  walkAst(ast, (n) => {
    // Static `import 'x'` / `import x from 'x'` / `export ... from 'x'`
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration')
        && n.source && n.source.type === 'Literal' && typeof n.source.value === 'string') {
      specs.add(n.source.value);
    }
    // Dynamic `import('x')`
    if (n.type === 'ImportExpression' && n.source && n.source.type === 'Literal' && typeof n.source.value === 'string') {
      specs.add(n.source.value);
    }
    // CommonJS `require('x')`
    if (n.type === 'CallExpression'
        && n.callee && n.callee.type === 'Identifier' && n.callee.name === 'require'
        && n.arguments && n.arguments.length === 1
        && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string') {
      specs.add(n.arguments[0].value);
    }
  });
  return specs;
}

const found = new Set();
function walkFs(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walkFs(p);
    else if (entry.name.endsWith('.js')) {
      const src = readFileSync(p, 'utf8');
      for (const s of specsInFile(src)) found.add(s);
    }
  }
}
walkFs(distDir);

// Normalize `pkg/sub` -> `pkg`, `@scope/pkg/sub` -> `@scope/pkg`.
function rootPackage(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

const externals = new Set();
for (const spec of found) {
  if (spec.startsWith('.') || spec.startsWith('/')) continue;
  if (spec.startsWith('node:')) continue;
  const root = rootPackage(spec);
  if (builtins.has(root)) continue;
  externals.add(root);
}

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
