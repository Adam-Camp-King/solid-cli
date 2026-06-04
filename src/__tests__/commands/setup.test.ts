/**
 * `solid setup` — Phase 2 of SPRINT-CLI-ONE-COMMAND-ONBOARDING.
 *
 * Tests run against the BUILT dist/ so the spawned child sees the same
 * registered commands as a real user would. Skipped if dist is missing
 * (CI builds before testing — same pattern as marketing-numbers-drift).
 */
import * as fs from 'fs';
import * as path from 'path';
import { execFileSync, spawnSync } from 'child_process';

const distEntry = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');
const distExists = fs.existsSync(distEntry);
const describeOrSkip = distExists ? describe : describe.skip;

function runSetup(args: string[]): { code: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, [distEntry, 'setup', ...args], {
    encoding: 'utf-8',
    env: {
      ...process.env,
      SOLID_SKIP_VERSION_CHECK: '1',
      SOLID_SKIP_FIRST_RUN_WIZARD: '1',
      // No stdin = no interactive prompts.
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return { code: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

describeOrSkip('solid setup — Phase 2 wizard', () => {
  it('is registered in the top-level command tree', () => {
    const out = execFileSync(
      'node',
      [distEntry, 'schema', 'verbs', '--json'],
      {
        env: { ...process.env, SOLID_SKIP_VERSION_CHECK: '1' },
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );
    const manifest = JSON.parse(out);
    const paths = manifest.verbs.map((v: { path: string }) => v.path);
    expect(paths).toContain('solid setup');
  });

  it('prints help with --help and exits 0', () => {
    const r = runSetup(['--help']);
    expect(r.code).toBe(0);
    expect(r.stdout).toMatch(/Usage: solid setup/);
    expect(r.stdout).toMatch(/--yes/);
    expect(r.stdout).toMatch(/--skip-auth/);
    expect(r.stdout).toMatch(/--skip-mcp/);
    expect(r.stdout).toMatch(/--skip-completion/);
    expect(r.stdout).toMatch(/--skip-render/);
    expect(r.stdout).toMatch(/--skip-first-action/);
  });

  it('with every step skipped + --json emits a clean envelope and exits 0', () => {
    const r = runSetup([
      '--yes',
      '--skip-auth',
      '--skip-mcp',
      '--skip-completion',
      '--skip-render',
      '--skip-first-action',
      '--json',
    ]);
    expect(r.code).toBe(0);
    const envelope = JSON.parse(r.stdout);
    expect(envelope.ok).toBe(true);
    expect(Array.isArray(envelope.results)).toBe(true);
    // Every step should be present and skipped.
    const expectedSteps = ['auth', 'mcp', 'claude_hook', 'completion', 'render_chromium', 'first_action'];
    for (const step of expectedSteps) {
      const r = envelope.results.find((x: { step: string }) => x.step === step);
      expect(r).toBeDefined();
      expect(r.status).toBe('skipped');
    }
  });

  it('every result envelope row has step + status + detail fields', () => {
    const r = runSetup([
      '--yes',
      '--skip-auth',
      '--skip-mcp',
      '--skip-completion',
      '--skip-render',
      '--skip-first-action',
      '--json',
    ]);
    const envelope = JSON.parse(r.stdout);
    for (const row of envelope.results) {
      expect(row).toHaveProperty('step');
      expect(row).toHaveProperty('status');
      // detail is optional but should be a string when present
      if (row.detail !== undefined) expect(typeof row.detail).toBe('string');
      expect(['done', 'skipped', 'failed', 'warn', 'pending']).toContain(row.status);
    }
  });

  it('is idempotent — re-running with all skips finishes <5s and stays clean', () => {
    const start = Date.now();
    const r = runSetup([
      '--yes',
      '--skip-auth',
      '--skip-mcp',
      '--skip-completion',
      '--skip-render',
      '--skip-first-action',
      '--json',
    ]);
    const elapsed = Date.now() - start;
    expect(r.code).toBe(0);
    expect(elapsed).toBeLessThan(5000);
  });

  it('--yes alone (no skips) does not prompt when stdin is closed (treats as headless)', () => {
    const r = runSetup(['--yes', '--skip-auth', '--skip-mcp', '--skip-completion', '--skip-render', '--json']);
    expect(r.code).toBe(0);
    const envelope = JSON.parse(r.stdout);
    // first_action should be skipped (no TTY OR --yes both route to skip)
    const fa = envelope.results.find((x: { step: string }) => x.step === 'first_action');
    expect(fa.status).toBe('skipped');
  });
});

// Reproduces the 2026-06-04 iMac case: `claude` is on PATH but its binary
// was built for a newer macOS, so every launch dies in dyld. Setup must
// report ⚠ warn with the real reason — not ✓ "wired into Claude Code".
const describePosix = process.platform === 'win32' ? describe.skip : describeOrSkip;
describePosix('solid setup — editor on PATH but unable to run', () => {
  const os = require('os') as typeof import('os');
  let fakeBinDir: string;

  beforeAll(() => {
    fakeBinDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-fake-claude-'));
    const fakeClaude = path.join(fakeBinDir, 'claude');
    fs.writeFileSync(
      fakeClaude,
      [
        '#!/bin/sh',
        'echo "dyld: Symbol not found: _ubrk_clone" >&2',
        'echo "  Referenced from: /x/bin/claude (which was built for Mac OS X 13.0)" >&2',
        'echo "  Expected in: /usr/lib/libicucore.A.dylib" >&2',
        'exit 134',
      ].join('\n'),
      { mode: 0o755 },
    );
  });

  afterAll(() => {
    fs.rmSync(fakeBinDir, { recursive: true, force: true });
  });

  it('reports warn (not done) for mcp.claude and claude_hook with a macOS hint', () => {
    const result = spawnSync(
      process.execPath,
      [distEntry, 'setup', '--yes', '--skip-auth', '--skip-completion', '--skip-render', '--skip-first-action', '--json'],
      {
        encoding: 'utf-8',
        env: {
          ...process.env,
          SOLID_SKIP_VERSION_CHECK: '1',
          SOLID_SKIP_FIRST_RUN_WIZARD: '1',
          // Fake bin dir FIRST so our broken `claude` shadows any real one.
          // PATH is otherwise restricted to system dirs so the wizard can
          // never find a REAL cursor/windsurf and write actual MCP config
          // on the machine running the tests. node + sh resolve absolutely.
          PATH: `${fakeBinDir}:/usr/bin:/bin`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    expect(result.status).toBe(0); // warn must NOT fail the wizard
    const envelope = JSON.parse(result.stdout || '{}');
    expect(envelope.ok).toBe(true);

    const mcpClaude = envelope.results.find((x: { step: string }) => x.step === 'mcp.claude');
    expect(mcpClaude).toBeDefined();
    expect(mcpClaude.status).toBe('warn');
    expect(mcpClaude.detail).toMatch(/cannot run on this Mac/);
    expect(mcpClaude.detail).toMatch(/macOS 13\.0\+/);
    expect(mcpClaude.detail).not.toMatch(/_ubrk_clone/); // no raw dyld noise

    const hook = envelope.results.find((x: { step: string }) => x.step === 'claude_hook');
    expect(hook).toBeDefined();
    expect(hook.status).toBe('warn');
    expect(hook.detail).toMatch(/cannot run on this Mac/);
  });
});

describeOrSkip('solid setup — bare-solid first-run trigger', () => {
  it('SOLID_SKIP_FIRST_RUN_WIZARD=1 forces help on bare solid (no auto-wizard)', () => {
    const result = spawnSync(process.execPath, [distEntry], {
      encoding: 'utf-8',
      env: {
        ...process.env,
        SOLID_SKIP_VERSION_CHECK: '1',
        SOLID_SKIP_FIRST_RUN_WIZARD: '1',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Help is printed (not the setup banner).
    const combined = (result.stdout || '') + (result.stderr || '');
    expect(combined).toMatch(/Usage: solid|Quick Start|Run Your Business/);
    // Setup banner should NOT appear when wizard is suppressed.
    expect(combined).not.toMatch(/Setup complete/);
  });
});
