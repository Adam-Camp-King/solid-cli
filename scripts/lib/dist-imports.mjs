// Shared helper for static analysis of compiled dist/ files.
//
// Walks a directory tree of compiled JS, parses each file with acorn, and
// extracts every external package referenced via static `import`,
// `export ... from`, dynamic `import('<pkg>')`, `require('<pkg>')`, or the
// `importESM('<pkg>')` ESM-interop helper (lib/esm-import) — the last so that
// ESM-only deps loaded through it still count as "used" and must be declared.
//
// Returns ROOT package names only — `lighthouse/foo/bar` and `@scope/pkg/sub`
// normalize to `lighthouse` and `@scope/pkg`. Node builtins (`fs`,
// `node:path`, etc.) and relative paths are excluded.

import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { parse } from 'acorn';

const BUILTINS = new Set(builtinModules);

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
    try {
      ast = parse(src, { ecmaVersion: 'latest', sourceType: 'module' });
    } catch {
      return specs;
    }
  }
  walkAst(ast, (n) => {
    if ((n.type === 'ImportDeclaration' || n.type === 'ExportAllDeclaration' || n.type === 'ExportNamedDeclaration')
        && n.source && n.source.type === 'Literal' && typeof n.source.value === 'string') {
      specs.add(n.source.value);
    }
    if (n.type === 'ImportExpression' && n.source && n.source.type === 'Literal' && typeof n.source.value === 'string') {
      specs.add(n.source.value);
    }
    if (n.type === 'CallExpression'
        && n.callee && n.callee.type === 'Identifier' && n.callee.name === 'require'
        && n.arguments && n.arguments.length === 1
        && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string') {
      specs.add(n.arguments[0].value);
    }
    // importESM('<pkg>') — the ESM-interop helper. tsc compiles the call as
    // `(0, esm_import_1.importESM)('<pkg>')`, so the callee is a SequenceExpression
    // wrapping a MemberExpression; in un-transpiled src it's a bare Identifier.
    if (n.type === 'CallExpression' && n.arguments && n.arguments.length === 1
        && n.arguments[0].type === 'Literal' && typeof n.arguments[0].value === 'string') {
      let callee = n.callee;
      if (callee && callee.type === 'SequenceExpression' && callee.expressions.length) {
        callee = callee.expressions[callee.expressions.length - 1];
      }
      const calleeName = callee && (
        (callee.type === 'Identifier' && callee.name)
        || (callee.type === 'MemberExpression' && callee.property
            && callee.property.type === 'Identifier' && callee.property.name)
      );
      if (calleeName === 'importESM') specs.add(n.arguments[0].value);
    }
  });
  return specs;
}

function rootPackage(spec) {
  if (spec.startsWith('@')) return spec.split('/').slice(0, 2).join('/');
  return spec.split('/')[0];
}

/**
 * Walk distDir recursively and return the set of external package names
 * (root names, normalized) referenced by any .js file's import/require.
 */
export function externalDepsInDist(distDir) {
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

  const externals = new Set();
  for (const spec of found) {
    if (spec.startsWith('.') || spec.startsWith('/')) continue;
    if (spec.startsWith('node:')) continue;
    const root = rootPackage(spec);
    if (BUILTINS.has(root)) continue;
    externals.add(root);
  }
  return externals;
}
