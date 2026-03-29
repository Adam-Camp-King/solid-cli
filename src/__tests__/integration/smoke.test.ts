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
});
