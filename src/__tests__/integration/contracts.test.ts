/**
 * Machine-readable contract tests — the AI-agent-facing API.
 *
 * Every --json shape, every exit code, every error message that an AI
 * agent will parse is pinned here. When a contract changes, this test
 * fails BEFORE publish — not after a customer's agent breaks silently.
 *
 * Run standalone:  npm run test:contracts
 */

import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

const CLI_PATH = path.join(__dirname, '..', '..', '..', 'dist', 'index.js');

function run(args: string): string {
  return execSync(`node ${CLI_PATH} ${args}`, {
    timeout: 15000,
    env: { ...process.env, HOME: '/tmp/solid-contract-test', SOLID_API_KEY: '', SOLID_NO_TENANT_WARN: '1', NO_COLOR: '1' },
  }).toString();
}

function runSafe(args: string): { stdout: string; stderr: string; exitCode: number } {
  try {
    const stdout = execSync(`node ${CLI_PATH} ${args}`, {
      timeout: 15000,
      env: { ...process.env, HOME: '/tmp/solid-contract-test', SOLID_API_KEY: '', SOLID_NO_TENANT_WARN: '1', NO_COLOR: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
    return { stdout, stderr: '', exitCode: 0 };
  } catch (e: any) {
    return {
      stdout: e.stdout?.toString() || '',
      stderr: e.stderr?.toString() || '',
      exitCode: e.status || 1,
    };
  }
}

describe('CLI Contract Tests', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  // ===========================================================================
  // 1. JSON CONTRACT SNAPSHOT TESTS
  //
  // Pin the key set of every --json output. When a field is renamed,
  // removed, or restructured, an AI agent's parser breaks. These tests
  // catch it before npm publish.
  // ===========================================================================
  describe('JSON output shape contracts', () => {
    it('schema verbs --json has stable top-level keys', () => {
      const parsed = JSON.parse(run('schema verbs --json'));
      expect(Object.keys(parsed).sort()).toEqual(
        expect.arrayContaining(['count', 'verbs']),
      );
      expect(Array.isArray(parsed.verbs)).toBe(true);
    });

    it('schema verbs --json entry has stable fields', () => {
      const parsed = JSON.parse(run('schema verbs --json'));
      const entry = parsed.verbs[0];
      expect(entry).toHaveProperty('verb');
      expect(entry).toHaveProperty('path');
      expect(entry).toHaveProperty('description');
    });

    it('schema blocks --json has stable top-level keys', () => {
      const parsed = JSON.parse(run('schema blocks --json'));
      expect(parsed).toHaveProperty('count');
      expect(parsed).toHaveProperty('examples');
      expect(typeof parsed.count).toBe('number');
    });

    it('schema blocks --type hero --json returns typed example', () => {
      const parsed = JSON.parse(run('schema blocks --type hero --json'));
      expect(parsed).toHaveProperty('type');
      expect(parsed.type).toBe('hero');
    });

    it('--version emits bare semver (no JSON wrapper)', () => {
      const version = run('--version').trim();
      expect(version).toMatch(/^\d+\.\d+\.\d+$/);
    });
  });

  // ===========================================================================
  // 2. EXIT CODE CONTRACTS
  //
  // AI agents parse exit codes to decide whether a command succeeded.
  // Pin them: 0 = success, 1 = expected failure with user guidance.
  // ===========================================================================
  describe('exit code contracts', () => {
    describe.each([
      ['--version',                           0],
      ['--help',                              0],
      ['completion',                          0],
      ['schema verbs --json',                 0],
      ['schema blocks --json',                0],
    ])('solid %s → exit %i', (args, expectedExit) => {
      it('exits correctly', () => {
        const { exitCode } = runSafe(args);
        expect(exitCode).toBe(expectedExit);
      });
    });

    describe.each([
      ['graph --offline',          1,  'no offline context file'],
      ['push',                     1,  'no auth or manifest'],
    ])('solid %s → exit %i (%s)', (args, expectedExit, _reason) => {
      it('exits with expected failure code', () => {
        const { exitCode } = runSafe(args);
        expect(exitCode).toBe(expectedExit);
      });
    });
  });

  // ===========================================================================
  // 3. ERROR MESSAGE REGRESSION TESTS
  //
  // When an AI agent gets an error, the message is its only diagnostic.
  // Pin: recovery hints present, stack traces absent.
  // ===========================================================================
  describe('error message contracts', () => {
    it('graph --offline without context gives recovery hint', () => {
      const { stderr, stdout } = runSafe('graph --offline');
      const combined = stdout + stderr;
      expect(combined).toMatch(/solid context|\.claude|jsonld/i);
    });

    it('push without auth says to login, never a stack trace', () => {
      const { stderr, stdout } = runSafe('push');
      const combined = stdout + stderr;
      expect(combined).toMatch(/login|auth|manifest|tenant/i);
      expect(combined).not.toMatch(/at Object\.<anonymous>/);
      expect(combined).not.toMatch(/TypeError:/);
    });

    describe.each([
      ['--help'],
      ['--version'],
      ['schema verbs --json'],
      ['schema blocks --json'],
      ['completion'],
      ['graph --offline'],
      ['push'],
    ])('solid %s never shows a raw stack trace', (args) => {
      it('no stack traces in user output', () => {
        const { stderr, stdout } = runSafe(args);
        const combined = stdout + stderr;
        expect(combined).not.toMatch(/at Object\.<anonymous>/);
        expect(combined).not.toMatch(/at Module\._compile/);
        expect(combined).not.toMatch(/Cannot read prop/);
      });
    });
  });

  // ===========================================================================
  // 4. JSON ENVELOPE CONSISTENCY
  //
  // Verify that --json commands return objects (not bare arrays or strings).
  // AI agents use a generic { ...fields } parser — bare arrays break it.
  // ===========================================================================
  describe('JSON envelope consistency', () => {
    describe.each([
      ['schema verbs'],
      ['schema blocks'],
      ['schema blocks --type hero'],
    ])('solid %s --json returns an object, not a bare array', (cmd) => {
      it('is an object', () => {
        const { stdout, exitCode } = runSafe(`${cmd} --json`);
        if (exitCode === 0 && stdout.trim()) {
          const parsed = JSON.parse(stdout);
          expect(typeof parsed).toBe('object');
          expect(Array.isArray(parsed)).toBe(false);
        }
      });
    });
  });
});
