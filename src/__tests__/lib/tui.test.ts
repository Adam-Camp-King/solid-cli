/**
 * TUI primitives tests.
 *
 * We don't spin up a real TTY — instead we control `process.stdout.isTTY`
 * and the environment flags that control interactivity, then assert the
 * fallback behavior is correct.
 */

import { isInteractive, confirm, progressBar, select, input, live } from '../../lib/tui';

describe('isInteractive', () => {
  const origCI = process.env.CI;
  const origNoInt = process.env.SOLID_NO_INTERACTIVE;
  const origStdinTty = process.stdin.isTTY;
  const origStdoutTty = process.stdout.isTTY;

  afterEach(() => {
    process.env.CI = origCI;
    process.env.SOLID_NO_INTERACTIVE = origNoInt;
    Object.defineProperty(process.stdin, 'isTTY', { value: origStdinTty, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutTty, configurable: true });
  });

  it('false when CI=true', () => {
    process.env.CI = 'true';
    expect(isInteractive()).toBe(false);
  });

  it('false when SOLID_NO_INTERACTIVE=1', () => {
    delete process.env.CI;
    process.env.SOLID_NO_INTERACTIVE = '1';
    expect(isInteractive()).toBe(false);
  });

  it('false when stdin is not a TTY', () => {
    delete process.env.CI;
    delete process.env.SOLID_NO_INTERACTIVE;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    expect(isInteractive()).toBe(false);
  });
});

describe('confirm', () => {
  const origCI = process.env.CI;
  beforeAll(() => {
    process.env.CI = 'true';
  });
  afterAll(() => {
    process.env.CI = origCI;
  });

  it('returns autoConfirm short-circuit', async () => {
    await expect(confirm('msg', { autoConfirm: true })).resolves.toBe(true);
  });

  it('returns defaultTo when non-interactive', async () => {
    await expect(confirm('msg', { defaultTo: true })).resolves.toBe(true);
    await expect(confirm('msg', { defaultTo: false })).resolves.toBe(false);
    await expect(confirm('msg')).resolves.toBe(false);
  });
});

describe('select / input — non-TTY fallback', () => {
  const origCI = process.env.CI;
  beforeAll(() => {
    process.env.CI = 'true';
  });
  afterAll(() => {
    process.env.CI = origCI;
  });

  it('select returns fallback when non-interactive', async () => {
    const v = await select('pick one', [{ name: 'a', value: 'a' }], { fallback: 'a' });
    expect(v).toBe('a');
  });

  it('select throws when non-interactive and no fallback', async () => {
    await expect(select('pick one', [{ name: 'a', value: 'a' }])).rejects.toThrow(/non-TTY/);
  });

  it('input returns fallback when non-interactive', async () => {
    await expect(input('enter name', { fallback: 'world' })).resolves.toBe('world');
  });

  it('input throws when non-interactive and no fallback', async () => {
    await expect(input('enter name')).rejects.toThrow(/non-TTY/);
  });
});

describe('progressBar — non-TTY', () => {
  const origStdoutTty = process.stdout.isTTY;
  beforeAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origStdoutTty, configurable: true });
  });

  it('returns a silent handle when stdout is not a TTY', async () => {
    const bar = await progressBar(10);
    expect(() => bar.update(5)).not.toThrow();
    expect(() => bar.increment()).not.toThrow();
    expect(() => bar.stop()).not.toThrow();
  });

  it('silences itself when SOLID_NO_PROGRESS=1', async () => {
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });
    process.env.SOLID_NO_PROGRESS = '1';
    const bar = await progressBar(10);
    expect(() => bar.update(5)).not.toThrow();
    delete process.env.SOLID_NO_PROGRESS;
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });
});

describe('live — non-TTY', () => {
  const origTty = process.stdout.isTTY;
  beforeAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });
  });
  afterAll(() => {
    Object.defineProperty(process.stdout, 'isTTY', { value: origTty, configurable: true });
  });

  it('returns a silent handle when stdout is not a TTY', () => {
    const h = live('init');
    expect(() => h.set('updated')).not.toThrow();
    expect(() => h.stop('final')).not.toThrow();
  });
});
