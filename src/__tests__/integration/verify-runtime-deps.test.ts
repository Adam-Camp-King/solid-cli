/**
 * Unit test for scripts/verify-runtime-deps.mjs.
 *
 * The static verifier protects against the v2.1.0 regression class
 * (lighthouse missing from `dependencies`, shipped broken) WITHOUT
 * needing `npm install`. That makes it safe to run inside `npm publish`'s
 * prepublishOnly chain, where the install-based scanner would recurse
 * into npm's locked process and exit 254.
 *
 * We test:
 *  1. A real `require('<missing>')` not declared anywhere → flagged.
 *  2. A real `require('<missing>')` declared as devDep → flagged WITH a
 *     callout (the v2.1.0 case — the lying-test-tree foot-gun).
 *  3. peerDependencies and optionalDependencies count as declarations.
 *  4. Template-literal strings (the `solid init` scaffolding shape) are
 *     NOT flagged.
 *  5. Node builtins are not flagged.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const VERIFIER = path.join(__dirname, '..', '..', '..', 'scripts', 'verify-runtime-deps.mjs');

interface FakeProject {
  root: string;
  pkgPath: string;
  distDir: string;
}

function makeFakeProject(pkg: Record<string, any>): FakeProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'verify-deps-'));
  const distDir = path.join(root, 'dist');
  fs.mkdirSync(distDir, { recursive: true });
  const pkgPath = path.join(root, 'package.json');
  fs.writeFileSync(pkgPath, JSON.stringify({ name: 'fixture', version: '0.0.0', ...pkg }));
  return { root, pkgPath, distDir };
}

function writeDist(project: FakeProject, name: string, body: string) {
  fs.writeFileSync(path.join(project.distDir, name), body);
}

function runVerifier(projectRoot: string): { stdout: string; stderr: string; status: number } {
  try {
    const stdout = execFileSync('node', [VERIFIER, projectRoot], {
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

describe('verify-runtime-deps.mjs', () => {
  let project: FakeProject;

  afterEach(() => {
    if (project?.root) fs.rmSync(project.root, { recursive: true, force: true });
  });

  it('flags a runtime dep used in dist/ but missing from package.json entirely', () => {
    project = makeFakeProject({ dependencies: {} });
    writeDist(project, 'a.js', 'const x = require("ghost-pkg");\nmodule.exports = x;\n');

    const { stderr, status } = runVerifier(project.root);
    expect(status).toBe(1);
    expect(stderr).toContain('ghost-pkg');
  });

  it('flags a dep declared as devDependency only — the v2.1.0 lighthouse case', () => {
    project = makeFakeProject({
      dependencies: {},
      devDependencies: { 'devonly-pkg': '^1.0.0' },
    });
    writeDist(project, 'audit.js', 'async function r() { return await import("devonly-pkg"); }\nr();\n');

    const { stderr, status } = runVerifier(project.root);
    expect(status).toBe(1);
    expect(stderr).toContain('devonly-pkg');
    expect(stderr).toContain('declared as devDependency');
  });

  it('accepts deps declared under peerDependencies', () => {
    project = makeFakeProject({
      dependencies: {},
      peerDependencies: { 'peer-pkg': '*' },
    });
    writeDist(project, 'a.js', 'const x = require("peer-pkg");\nmodule.exports = x;\n');

    const { status } = runVerifier(project.root);
    expect(status).toBe(0);
  });

  it('accepts deps declared under optionalDependencies', () => {
    project = makeFakeProject({
      dependencies: {},
      optionalDependencies: { 'optional-pkg': '^1.0.0' },
    });
    writeDist(project, 'a.js', 'const x = require("optional-pkg");\nmodule.exports = x;\n');

    const { status } = runVerifier(project.root);
    expect(status).toBe(0);
  });

  it('does NOT flag string literals inside template literals (init scaffolding)', () => {
    project = makeFakeProject({ dependencies: {} });
    writeDist(project, 'init.js',
      'const template = `const express = require("express");\\nconst app = express();\\n`;\nmodule.exports = { template };\n');

    const { stdout, status } = runVerifier(project.root);
    expect(status).toBe(0);
    expect(stdout).toContain('All 0 external deps');
  });

  it('does not flag node builtins or node: prefix', () => {
    project = makeFakeProject({ dependencies: {} });
    writeDist(project, 'b.js',
      'const fs = require("fs");\nconst path = require("node:path");\nmodule.exports = { fs, path };\n');

    const { status } = runVerifier(project.root);
    expect(status).toBe(0);
  });

  it('reports root packages (lighthouse), not deep paths (lighthouse/lib/x)', () => {
    project = makeFakeProject({ dependencies: {} });
    writeDist(project, 'a.js', 'const x = require("missing-pkg/lib/sub");\nmodule.exports = x;\n');

    const { stderr, status } = runVerifier(project.root);
    expect(status).toBe(1);
    expect(stderr).toMatch(/- missing-pkg(\s|\()/);
    expect(stderr).not.toContain('missing-pkg/lib/sub');
  });

  it('passes when every external is declared in dependencies', () => {
    project = makeFakeProject({
      dependencies: { 'real-dep': '^1.0.0', 'second-dep': '*' },
    });
    writeDist(project, 'a.js', 'const r = require("real-dep");\nconst s = require("second-dep");\n');

    const { stdout, status } = runVerifier(project.root);
    expect(status).toBe(0);
    expect(stdout).toContain('All 2 external deps declared');
  });
});
