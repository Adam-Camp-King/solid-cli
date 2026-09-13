/**
 * stdout formatting: indented for a person, compact for a program.
 *
 * Sprint VNP 1.1. Indentation was 35% of the verb manifest — 171,089 tokens of
 * leading spaces, measured, on the one payload an agent must read to discover
 * anything. A terminal is the only reader that benefits.
 *
 * Both directions are asserted. A test for the compact case alone would still
 * pass if the TTY branch were deleted, and losing pretty output at a terminal
 * is a real regression for the humans who use this.
 *
 * `isTTY` is swapped with defineProperty rather than assignment: run on its
 * own it is a writable property, but in the full suite something earlier
 * redefines it read-only and a plain assignment throws. The failure only
 * appeared in the whole-suite run, which is the reason to run the suite rather
 * than the file you just touched.
 */
import { stringifyForStdout } from '../../lib/json-output';

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, 'isTTY', {
    value,
    configurable: true,
    writable: true,
  });
}

describe('stringifyForStdout', () => {
  const original = process.stdout.isTTY;
  afterEach(() => setTTY(original));

  it('is compact when stdout is not a TTY — the agent and script case', () => {
    setTTY(false);
    expect(stringifyForStdout({ a: 1, b: [2, 3] })).toBe('{"a":1,"b":[2,3]}');
  });

  it('is indented at a terminal — the human case', () => {
    setTTY(true);
    expect(stringifyForStdout({ a: 1 })).toBe('{\n  "a": 1\n}');
  });

  it('round-trips identically either way', () => {
    const value = { name: 'x', nested: { list: [1, 2], flag: true }, nul: null };

    setTTY(false);
    const compact = stringifyForStdout(value);
    setTTY(true);
    const pretty = stringifyForStdout(value);

    expect(JSON.parse(compact)).toEqual(value);
    expect(JSON.parse(pretty)).toEqual(value);
    expect(compact.length).toBeLessThan(pretty.length);
  });
});
