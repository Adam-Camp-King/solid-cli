/**
 * Auto-JSON detection — locks the contract that an agent calling the
 * CLI over a pipe / MCP / CI gets JSON without having to remember the
 * --json flag. Humans on a TTY still see prose.
 *
 * The cascade in lib/json-output.ts is:
 *   --json (local)        → JSON
 *   --no-json (local)     → human, ALWAYS (explicit opt-out wins)
 *   SOLID_NO_JSON=1       → human, ALWAYS (explicit opt-out wins)
 *   programJson           → JSON
 *   SOLID_JSON=1          → JSON
 *   !process.stdout.isTTY → JSON  ← NEW
 *   else                  → human
 */

const ORIGINAL_TTY = process.stdout.isTTY;
const ORIGINAL_NO_JSON = process.env.SOLID_NO_JSON;
const ORIGINAL_JSON = process.env.SOLID_JSON;

function setTTY(value: boolean): void {
  Object.defineProperty(process.stdout, 'isTTY', { value, configurable: true });
}

describe('isJsonOutput — auto-detect on non-TTY', () => {
  beforeEach(() => {
    jest.resetModules();
    delete process.env.SOLID_NO_JSON;
    delete process.env.SOLID_JSON;
  });

  afterAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: ORIGINAL_TTY, configurable: true });
    if (ORIGINAL_NO_JSON !== undefined) process.env.SOLID_NO_JSON = ORIGINAL_NO_JSON;
    if (ORIGINAL_JSON !== undefined) process.env.SOLID_JSON = ORIGINAL_JSON;
  });

  it('returns true when stdout is not a TTY (pipe, redirect, agent)', () => {
    setTTY(false);
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput()).toBe(true);
  });

  it('returns false when stdout IS a TTY (human)', () => {
    setTTY(true);
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput()).toBe(false);
  });

  it('SOLID_NO_JSON=1 overrides non-TTY auto-detect', () => {
    setTTY(false);
    process.env.SOLID_NO_JSON = '1';
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput()).toBe(false);
  });

  it('explicit --no-json (json:false) overrides every other signal', () => {
    setTTY(false);
    process.env.SOLID_JSON = '1';
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput({ json: false })).toBe(false);
  });

  it('explicit --json (json:true) wins on a TTY', () => {
    setTTY(true);
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput({ json: true })).toBe(true);
  });

  it('SOLID_JSON=1 forces JSON on a TTY', () => {
    setTTY(true);
    process.env.SOLID_JSON = '1';
    const { isJsonOutput } = require('../../lib/json-output');
    expect(isJsonOutput()).toBe(true);
  });
});

describe('isNonTty', () => {
  it('true when isTTY is undefined (jest, pipes)', () => {
    setTTY(false);
    const { isNonTty } = require('../../lib/json-output');
    expect(isNonTty()).toBe(true);
  });
  it('false when isTTY is true (human terminal)', () => {
    setTTY(true);
    const { isNonTty } = require('../../lib/json-output');
    expect(isNonTty()).toBe(false);
  });
});
