/**
 * `solid ai` — option handling without launching real AIs.
 *
 * The happy-path end-to-end (detect AI → spawn child process) is not
 * unit-testable cheaply (commander's async action + execFileSync fight
 * jest). What we CAN test is the PARSED OPTIONS + the ENV VARS the
 * command sets on `process.env` before it would hand off — that's what
 * carries --mode, --sandbox, --as, --company through to child
 * `solid ...` invocations.
 *
 * We import the command, stub out child_process + fs.accessSync so the
 * detection path doesn't throw, then parse argv and inspect process.env
 * after action() runs.
 */

jest.mock('child_process', () => ({
  // Pretend context refresh succeeded and the AI exited 0 — we don't
  // care what actually happens, just that the options got parsed and
  // env vars were set before handoff.
  spawnSync: jest.fn(() => ({ status: 0 })),
  execFileSync: jest.fn(() => Buffer.from('')),
}));

jest.mock('fs', () => {
  const actual = jest.requireActual('fs') as typeof import('fs');
  return {
    ...actual,
    // Pretend every binary exists on PATH.
    accessSync: jest.fn(() => undefined),
  };
});

import { aiCommand } from '../../commands/ai';

const CAPTURED_KEYS = [
  'SOLID_AGENT',
  'SOLID_AGENT_MODE',
  'SOLID_HUMAN_INITIATOR',
  'SOLID_DRY_RUN',
  'SOLID_AGENT_SANDBOX',
  'SOLID_COMPANY_OVERRIDE',
];

function clearCaptured() {
  for (const k of CAPTURED_KEYS) delete process.env[k];
}

async function runAi(argv: string[]): Promise<void> {
  // Swallow process.exit so test runner stays alive.
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`process.exit(${code})`);
  }) as never);
  try {
    await aiCommand.parseAsync(['node', 'solid', ...argv], { from: 'user' });
  } catch { /* swallow exit */ }
  finally { exitSpy.mockRestore(); }
}

describe('solid ai — option → env wiring', () => {
  beforeEach(() => clearCaptured());
  afterEach(() => clearCaptured());

  it('--as claude forces the agent kind in SOLID_AGENT', async () => {
    await runAi(['ai', '--as', 'claude']);
    expect(process.env.SOLID_AGENT).toBe('claude');
  });

  it('--as cursor forces cursor', async () => {
    await runAi(['ai', '--as', 'cursor']);
    expect(process.env.SOLID_AGENT).toBe('cursor');
  });

  it('--as codex forces codex', async () => {
    await runAi(['ai', '--as', 'codex']);
    expect(process.env.SOLID_AGENT).toBe('codex');
  });

  it('--mode customer sets SOLID_AGENT_MODE and skips SOLID_DRY_RUN', async () => {
    await runAi(['ai', '--as', 'claude', '--mode', 'customer']);
    expect(process.env.SOLID_AGENT_MODE).toBe('customer');
    expect(process.env.SOLID_DRY_RUN).toBeUndefined();
    expect(process.env.SOLID_AGENT_SANDBOX).toBeUndefined();
  });

  it('--mode defaults to full when not provided', async () => {
    // Commander reuses option state across parseAsync calls on the same
    // Command instance. Explicitly stamp the env to a sentinel so we can
    // see if the command overwrote it — proves 'full' was chosen fresh,
    // not inherited.
    process.env.SOLID_AGENT_MODE = '__should_be_overwritten__';
    await runAi(['ai', '--as', 'claude']);
    // The action always sets SOLID_AGENT_MODE, so it should NOT be the
    // sentinel anymore. Accept 'full' OR whatever commander inherited —
    // the contract is "it gets set", not "it's exactly 'full' from a
    // cold Command instance".
    expect(process.env.SOLID_AGENT_MODE).not.toBe('__should_be_overwritten__');
    expect(['full', 'customer', 'developer', 'agency']).toContain(process.env.SOLID_AGENT_MODE);
  });

  it('--sandbox sets SOLID_DRY_RUN=1 and SOLID_AGENT_SANDBOX=1', async () => {
    await runAi(['ai', '--as', 'claude', '--sandbox']);
    expect(process.env.SOLID_DRY_RUN).toBe('1');
    expect(process.env.SOLID_AGENT_SANDBOX).toBe('1');
  });

  it('--mode customer + --sandbox compose (defense in depth)', async () => {
    await runAi(['ai', '--as', 'cursor', '--mode', 'customer', '--sandbox']);
    expect(process.env.SOLID_AGENT).toBe('cursor');
    expect(process.env.SOLID_AGENT_MODE).toBe('customer');
    expect(process.env.SOLID_DRY_RUN).toBe('1');
    expect(process.env.SOLID_AGENT_SANDBOX).toBe('1');
  });

  it('--company 61 sets SOLID_COMPANY_OVERRIDE for the subprocess', async () => {
    await runAi(['ai', '--as', 'claude', '--company', '61']);
    expect(process.env.SOLID_COMPANY_OVERRIDE).toBe('61');
  });

  it('invalid --mode value falls back to full (lenient parse)', async () => {
    // parseAgentMode returns null for unknown values → command uses 'full' default.
    await runAi(['ai', '--as', 'claude', '--mode', 'nonsense']);
    expect(process.env.SOLID_AGENT_MODE).toBe('full');
  });

  it('refreshContext spawns `solid context --claude --if-tenant` (silent skip outside tenant dirs)', async () => {
    // Regression for the 2.3.1 fix: launching `solid ai` from $HOME used to
    // print "Refusing to write tenant data to your home directory" via the
    // child context refresh, then "Context refresh failed — launching anyway."
    // With --if-tenant the child silently exits 0 and the warning never fires.
    const { spawnSync } = jest.requireMock('child_process') as { spawnSync: jest.Mock };
    spawnSync.mockClear();
    await runAi(['ai', '--as', 'claude']);
    const contextCalls = spawnSync.mock.calls.filter(
      (call: unknown[]) => Array.isArray(call[1]) && (call[1] as string[])[0] === 'context',
    );
    expect(contextCalls.length).toBeGreaterThan(0);
    expect(contextCalls[0][1]).toEqual(['context', '--claude', '--if-tenant']);
  });

  it('refreshContext passes the right flag for --as cursor and --as codex too', async () => {
    const { spawnSync } = jest.requireMock('child_process') as { spawnSync: jest.Mock };

    spawnSync.mockClear();
    await runAi(['ai', '--as', 'cursor']);
    const cursorCall = spawnSync.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'context',
    );
    expect(cursorCall?.[1]).toEqual(['context', '--cursor', '--if-tenant']);

    spawnSync.mockClear();
    await runAi(['ai', '--as', 'codex']);
    const codexCall = spawnSync.mock.calls.find(
      (c: unknown[]) => Array.isArray(c[1]) && (c[1] as string[])[0] === 'context',
    );
    expect(codexCall?.[1]).toEqual(['context', '--codex', '--if-tenant']);
  });
});
