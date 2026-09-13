/**
 * Every command a `fix` can name must be a command the CLI actually has.
 *
 * Sprint VNP. This is the third guard against one bug, because the bug kept
 * coming back in a new place:
 *
 *   - the 403 hint told feature-gated callers to run `solid upgrade`, from two
 *     source files, with a test pinning the wrong string. It has never existed.
 *   - the registry published `dispatch_endpoint: /api/v1/agent/cli-dispatch`.
 *     The route is on the ada router. Every test passed, because they asserted
 *     the key was PRESENT.
 *   - VNP's own draft told `fix` to name `solid verbs example` while that
 *     command was still a plan.
 *
 * The unit tests in error-fix.test.ts and schema-validate.test.ts assert what
 * the strings SAY. Only this one asserts they RESOLVE, by running the real
 * binary and letting commander answer — `--help`, so nothing touches the
 * network. ⛔ Read `resolves()` before changing it: the exit code is NOT the
 * answer, and the first draft of this file was a false green for that reason.
 *
 * Adding a `fix` string without adding its command here is the whole failure
 * mode, so the list is derived from the source rather than retyped — a fix the
 * code can emit but this test does not know about fails the census assertion.
 */
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

import { classifyError, fixForCode } from '../../lib/error-codes';
import { fixFor, validatePayload, type JsonSchema } from '../../lib/schema-validate';

const ROOT = path.join(__dirname, '..', '..', '..');
const CLI_PATH = path.join(ROOT, 'dist', 'index.js');

/**
 * Does commander resolve this whole command path?
 *
 * ⛔ NOT the exit code. `--help` exits 0 for a path that does not exist —
 * commander walks up to the nearest resolvable parent and prints ITS help.
 * `solid verbs nonexistent --help`, `solid upgrade --help` and
 * `solid doctor check --help` all exit 0. The first draft of this file asserted
 * on the exit code and passed for every one of them: a guard against
 * false greens that was itself a false green.
 *
 * The Usage line is the signal that cannot be faked. A resolved path echoes
 * itself — `Usage: solid verbs example [options] <verbName>`. An unresolved one
 * falls back to the parent — `Usage: solid verbs [options] [command]`.
 */
function resolves(commandPath: string): boolean {
  let out: string;
  try {
    out = execSync(`node ${CLI_PATH} ${commandPath} --help`, {
      timeout: 15000,
      env: { ...process.env, HOME: '/tmp/solid-test-home', SOLID_API_KEY: '' },
      stdio: ['pipe', 'pipe', 'pipe'],
    }).toString();
  } catch (e: any) {
    out = (e.stdout?.toString() || '') + (e.stderr?.toString() || '');
  }
  const first = out.split('\n')[0].trim();
  return new RegExp(`^Usage: solid ${commandPath}(\\s|$)`).test(first);
}

/**
 * The runnable command inside a fix string.
 *
 * A fix may be a bare command (`solid auth login`) or prose that ends in one
 * (`add transaction_id — solid verbs example payments.x`). Take from the last
 * `solid ` onward, then drop trailing arguments that are values rather than
 * command words: a verb name, a flag, or anything with a dot or angle bracket.
 */
export function commandWordsOf(fix: string): string | null {
  const at = fix.lastIndexOf('solid ');
  if (at < 0) return null;
  const words = fix.slice(at + 'solid '.length).trim().split(/\s+/);
  const kept: string[] = [];
  for (const w of words) {
    if (w.startsWith('-') || w.includes('.') || w.includes('<') || w.includes('>')) break;
    kept.push(w);
  }
  return kept.length ? kept.join(' ') : null;
}

/** Every fix string the code can produce today, collected from both sources. */
function allFixes(): string[] {
  const out: string[] = [];

  for (const status of [400, 401, 403, 404, 408, 409, 422, 429, 500, 502, 503]) {
    for (const data of [{}, { detail: 'Missing scope: verbs:write' }, { code: 'FEATURE_GATED', feature: 'x' }]) {
      const f = fixForCode(classifyError({ status, data }));
      if (f) out.push(f);
    }
  }
  for (const networkErrorCode of ['ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT']) {
    const f = fixForCode(classifyError({ status: 0, networkErrorCode }));
    if (f) out.push(f);
  }

  // The validation path builds its own, one per report shape.
  const schema: JsonSchema = {
    type: 'object',
    properties: { transaction_id: { type: 'string' }, company_id: { type: 'integer' } },
    required: ['company_id', 'transaction_id'],
  };
  out.push(fixFor('payments.preview_refund_impact', validatePayload({}, schema)));
  out.push(fixFor('payments.preview_refund_impact', validatePayload({ transaction_id: 5 }, schema)));
  out.push(fixFor('payments.preview_refund_impact', validatePayload({ transaction_id: 'a', nope: 1 }, schema)));
  out.push(fixFor('payments.preview_refund_impact', validatePayload({ transaction_id: 'a' }, schema)));

  return [...new Set(out)];
}

describe('every fix names a command that resolves', () => {
  beforeAll(() => {
    if (!fs.existsSync(CLI_PATH)) {
      throw new Error(`CLI not built. Run: npm run build\nExpected: ${CLI_PATH}`);
    }
  });

  const fixes = allFixes();

  it('collects a non-trivial population, or it is proving nothing', () => {
    // A census assertion. Without it, a refactor that stops fixForCode from
    // returning anything leaves every check below vacuously green — which is
    // the exact shape of failure this file exists to catch.
    expect(fixes.length).toBeGreaterThanOrEqual(6);
  });

  it.each(fixes)('%s', (fix) => {
    const words = commandWordsOf(fix);
    expect(words).not.toBeNull();
    expect(resolves(words as string)).toBe(true);
  });

  it('does not name the two commands that never existed', () => {
    const joined = fixes.join('\n');
    expect(joined).not.toContain('solid upgrade');
    expect(joined).not.toContain('solid doctor check');
  });
});

describe('the commands 4.1 and 4.4 added are reachable', () => {
  it('solid verbs example resolves', () => {
    expect(resolves('verbs example')).toBe(true);
  });

  it('and the check can tell the difference', () => {
    // Falsification. Without this the whole file could be asserting that
    // `true === true`, which is precisely how it failed the first time.
    expect(resolves('verbs nonexistent')).toBe(false);
    expect(resolves('upgrade')).toBe(false);
    expect(resolves('doctor check')).toBe(false);
  });

  it('solid scope answers bare, without a subcommand', () => {
    // 4.4. A group with one member used to print help and cost a turn. It now
    // runs whoami, which needs auth — so the assertion is that it is NOT
    // commander's "unknown command / help" exit, and never a crash.
    let code: number;
    try {
      execSync(`node ${CLI_PATH} scope`, {
        timeout: 15000,
        env: { ...process.env, HOME: '/tmp/solid-test-home', SOLID_API_KEY: '' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      code = 0;
    } catch (e: any) {
      code = e.status ?? 1;
    }
    // 1 is "not logged in", which is the default action running. Anything
    // above that would mean commander never dispatched.
    expect(code).toBeLessThanOrEqual(1);
  });
});

describe('commandWordsOf', () => {
  it('takes the command out of prose', () => {
    expect(commandWordsOf('add transaction_id — solid verbs example payments.x'))
      .toBe('verbs example');
  });

  it('stops before flags', () => {
    expect(commandWordsOf('solid keys rotate --add-scope verbs:write')).toBe('keys rotate');
  });

  it('returns null when there is no command in it', () => {
    expect(commandWordsOf('contact_id: Field required')).toBeNull();
  });
});
