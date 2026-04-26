/**
 * Unit test for scripts/scan-lazy-imports.mjs.
 *
 * The scanner protects against the v2.1.0 regression class: a runtime dep
 * missing from `dependencies` but installed via devDependencies, so tests
 * against the dev tree pass while the published tarball crashes for users.
 *
 * We test two things:
 *  1. Real `require('<missing>')` and `await import('<missing>')` calls in
 *     the installed dist/ are flagged.
 *  2. `require('<x>')` strings embedded inside template literals (e.g.
 *     `solid init` scaffolding the user's starter project) are NOT flagged
 *     — those aren't imports, they're code we generate for the user.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const SCANNER = path.join(__dirname, '..', '..', '..', 'scripts', 'scan-lazy-imports.mjs');

interface FakeInstall {
  root: string;
  pkgDir: string;
  distDir: string;
}

function makeFakeInstall(): FakeInstall {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-lazy-'));
  const pkgDir = path.join(root, 'node_modules', '@solidnumber', 'cli');
  const distDir = path.join(pkgDir, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'host', version: '1.0.0' }));
  fs.writeFileSync(path.join(pkgDir, 'package.json'), JSON.stringify({ name: '@solidnumber/cli', version: '0.0.0', main: 'dist/index.js' }));
  return { root, pkgDir, distDir };
}

function installDep(root: string, name: string) {
  const dir = path.join(root, 'node_modules', name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), 'module.exports = {};');
}

function runScanner(installRoot: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('node', [SCANNER, installRoot], {
      stdio: ['ignore', 'pipe', 'pipe'],
      encoding: 'utf8',
    });
    return { stdout, stderr: '', status: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() ?? '',
      stderr: e.stderr?.toString() ?? '',
      status: typeof e.status === 'number' ? e.status : 1,
    };
  }
}

describe('scan-lazy-imports.mjs', () => {
  let install: FakeInstall;

  afterEach(() => {
    if (install?.root) fs.rmSync(install.root, { recursive: true, force: true });
  });

  it('flags a missing dep referenced via require()', () => {
    install = makeFakeInstall();
    fs.writeFileSync(path.join(install.distDir, 'index.js'),
      'const x = require("not-a-real-package");\nmodule.exports = x;\n');

    const { stderr, status } = runScanner(install.root);
    expect(status).toBe(1);
    expect(stderr).toContain('not-a-real-package');
  });

  it('flags a missing dep referenced via dynamic import()', () => {
    install = makeFakeInstall();
    fs.writeFileSync(path.join(install.distDir, 'audit.js'),
      'async function run() { const m = await import("missing-lighthouse-stand-in"); return m; }\nrun();\n');

    const { stderr, status } = runScanner(install.root);
    expect(status).toBe(1);
    expect(stderr).toContain('missing-lighthouse-stand-in');
  });

  it('does NOT flag string literals inside template literals (init scaffolding)', () => {
    install = makeFakeInstall();
    // This is the false-positive shape that bit us on first run: `solid init`
    // writes a starter project with require('express') in a template literal.
    // It must NOT be treated as a real import of the CLI itself.
    fs.writeFileSync(path.join(install.distDir, 'init.js'),
      'const template = `const express = require("express");\\nconst app = express();\\n`;\nmodule.exports = { template };\n');

    const { stdout, status } = runScanner(install.root);
    expect(status).toBe(0);
    expect(stdout).toContain('All 0 external deps resolved');
  });

  it('passes when all real deps are installed', () => {
    install = makeFakeInstall();
    installDep(install.root, 'real-dep');
    fs.writeFileSync(path.join(install.distDir, 'index.js'),
      'const r = require("real-dep");\nasync function load() { return await import("real-dep"); }\nload();\n');

    const { stdout, status } = runScanner(install.root);
    expect(status).toBe(0);
    expect(stdout).toContain('All 1 external deps resolved');
  });

  it('does not flag node builtins or node: prefix', () => {
    install = makeFakeInstall();
    fs.writeFileSync(path.join(install.distDir, 'b.js'),
      'const fs = require("fs");\nconst path = require("node:path");\nmodule.exports = { fs, path };\n');

    const { status } = runScanner(install.root);
    expect(status).toBe(0);
  });

  it('normalizes deep paths to root package (lighthouse/foo -> lighthouse)', () => {
    install = makeFakeInstall();
    fs.writeFileSync(path.join(install.distDir, 'a.js'),
      'const x = require("missing-pkg/lib/sub");\nmodule.exports = x;\n');

    const { stderr, status } = runScanner(install.root);
    expect(status).toBe(1);
    // Should report `missing-pkg`, not `missing-pkg/lib/sub`.
    expect(stderr).toContain('- missing-pkg\n');
    expect(stderr).not.toContain('missing-pkg/lib/sub');
  });
});
