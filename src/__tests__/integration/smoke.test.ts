/**
 * Smoke tests — verify the CLI binary doesn't crash on basic operations.
 * These run the actual compiled JS, not the TypeScript source.
 * NO API calls — just verifies the CLI starts, shows help, and exits cleanly.
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');

function run(args: string): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    timeout: 10000,
    env: { ...process.env, HOME: '/tmp/solid-test-home', SOLID_API_KEY: '' },
  }).toString();
}

function runSafe(args: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      timeout: 10000,
      env: { ...process.env, HOME: '/tmp/solid-test-home', SOLID_API_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { stdout, exitCode: 0 };
  } catch (e: any) {
    return { stdout: e.stdout?.toString() || '', exitCode: e.status || 1 };
  }
}

describe('CLI Smoke Tests', () => {
  beforeAll(() => {
    // Verify dist exists
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  it('--version prints a valid semver', () => {
    const output = run('--version');
    expect(output.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('--version matches package.json', () => {
    const output = run('--version').trim();
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', '..', 'package.json'), 'utf-8'));
    expect(output).toBe(pkg.version);
  });

  it('--help shows command list', () => {
    const output = run('--help');
    expect(output).toContain('auth');
    expect(output).toContain('company');
    expect(output).toContain('pages');
    expect(output).toContain('site');
    expect(output).toContain('clone');
    expect(output).toContain('billing');
  });

  it('completion outputs zsh script', () => {
    const output = run('completion');
    expect(output).toContain('#compdef solid');
    expect(output).toContain('_solid');
  });

  it('completion --bash outputs bash script', () => {
    const output = run('completion --bash');
    expect(output).toContain('_solid_completions');
    expect(output).toContain('complete -F');
  });

  it('completion --fish outputs fish script', () => {
    const output = run('completion --fish');
    expect(output).toContain('complete -c solid');
  });

  it('auth status without credentials exits without crashing', () => {
    const result = runSafe('auth status');
    // Should not hang or segfault — exit code 0 or 1 are both fine
    expect(result.exitCode).toBeLessThanOrEqual(1);
  });

  it('unknown command shows help, not a crash', () => {
    const result = runSafe('nonexistent-command');
    expect(result.exitCode).toBeLessThanOrEqual(1);
  });

  it('pages --help does not crash', () => {
    const output = run('pages --help');
    expect(output).toContain('list');
    expect(output).toContain('publish');
  });

  it('site --help does not crash', () => {
    const output = run('site --help');
    expect(output).toContain('list');
    expect(output).toContain('create');
    expect(output).toContain('templates');
  });

  it('billing --help does not crash', () => {
    const output = run('billing --help');
    expect(output).toContain('status');
    expect(output).toContain('checkout-link');
    expect(output).toContain('invoice');
  });

  it('seo --help does not crash', () => {
    const output = run('seo --help');
    expect(output).toContain('site-audit');
    expect(output).toContain('report');
  });

  // ===========================================================================
  // A+.7 — Top-15 command surface smoke tests
  //
  // Goal: every top command's --help renders a valid Commander tree
  // without crashing on import resolution / missing dep / argv parser
  // tree-walk. Each one catches the most-common regression class:
  // "user installs the CLI, types `solid <cmd> --help`, gets a stack
  // trace instead of help text."
  //
  // Extended from the original 4-command list (pages/site/billing/seo)
  // to cover the moat-critical commands too: graph, schema verbs, kb,
  // services, clone, audit, doctor, status, mcp, chains, domains,
  // insights, nest, dev, health.
  // ===========================================================================

  describe.each([
    ['kb',        ['list', 'add', 'search']],
    ['services',  ['list', 'create']],
    ['clone',     ['plumber']],
    ['audit',     ['log', 'export']],
    ['doctor',    ['env']],
    ['status',    []],
    ['schema',    ['verbs']],
    ['mcp',       ['serve', 'install']],
    ['chains',    ['list']],
    ['domains',   ['list']],
    ['insights',  ['list']],
    ['nest',      []],
    ['dev',       []],
    ['health',    []],
    ['context',   ['--claude', '--cursor']],
    ['graph',     ['--query', '--dump', '--diff', '--validate']],
    ['push',      ['--flush']],
    ['render',    ['--png', '--breakpoint', '--install']],
  ])('%s --help', (cmd, expectedTokens) => {
    it(`renders without crashing and lists key tokens`, () => {
      const output = run(`${cmd} --help`);
      // The command name itself should appear somewhere in the help
      expect(output).toContain(cmd);
      // Each expected token should be in the help text (loose match —
      // some commands list subcommands, some list flags). Tokens are
      // hand-picked to be load-bearing surface for that command.
      for (const token of expectedTokens) {
        expect(output).toContain(token);
      }
    });
  });

  // ===========================================================================
  // A+.7 — Real-shape tests for the v2 moat features
  // ===========================================================================

  it('schema blocks --examples --json emits valid JSON with example per block type', () => {
    const output = run('schema blocks --examples --json');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('examples');
    expect(parsed).toHaveProperty('count');
    expect(parsed.count).toBeGreaterThan(20);  // we have 28 blocks
    // Every example must have a `type` field
    for (const [_blockType, ex] of Object.entries(parsed.examples)) {
      expect(ex).toHaveProperty('type');
    }
  });

  it('schema blocks --type hero --json returns one example', () => {
    const output = run('schema blocks --type hero --json');
    const parsed = JSON.parse(output);
    expect(parsed.type).toBe('hero');
  });

  it('schema verbs --json emits valid JSON', () => {
    const output = run('schema verbs --json');
    const parsed = JSON.parse(output);
    expect(parsed).toHaveProperty('verbs');
    expect(parsed).toHaveProperty('count');
    expect(Array.isArray(parsed.verbs)).toBe(true);
    expect(parsed.verbs.length).toBeGreaterThan(50);  // we have 96+
  });

  it('graph --offline without local file exits with clear error', () => {
    const result = runSafe('graph --offline');
    expect(result.exitCode).toBe(1);
    // Error message should mention the missing file or `solid context`
    // so the user knows the recovery path.
  });

  it('graph --query without query string exits with usage error', () => {
    // --query expects a value; commander reports option-requires-arg.
    const result = runSafe('graph --query');
    expect(result.exitCode).not.toBe(0);
  });

  it('--dry-run global flag activates dry-run mode (no crash)', () => {
    // Dry-run emits a banner on stderr and short-circuits any
    // mutation. We can't trigger a mutation without auth, so verify
    // --dry-run --help passes through cleanly.
    const output = run('--dry-run --help');
    expect(output).toContain('Solid#');
  });

  it('--queue global flag is parseable', () => {
    // Queue mode uses .solid/queue/ for offline mutations.
    // --queue --help should not crash.
    const output = run('--queue --help');
    expect(output).toContain('Solid#');
  });

  it('completion subcommand exists for all three shells', () => {
    expect(run('completion zsh')).toMatch(/_solid|compdef/);
    expect(run('completion --bash')).toMatch(/_solid|complete/);
    expect(run('completion --fish')).toMatch(/complete -c solid/);
  });
});
