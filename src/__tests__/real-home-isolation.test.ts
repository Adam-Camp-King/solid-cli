/**
 * Guard: inside the suite, the home every module and child process resolves
 * is the temp one from globalSetup — never the developer's real home.
 */
import * as os from 'os';
import * as path from 'path';
import { execFileSync } from 'child_process';

const real = process.env.SOLID_TEST_REAL_HOME;
const tmp = process.env.SOLID_TEST_TMP_HOME;

test('globalSetup ran and chose a temp home distinct from the real one', () => {
  expect(real).toBeTruthy();
  expect(tmp).toBeTruthy();
  expect(path.resolve(tmp as string)).not.toBe(path.resolve(real as string));
});

test('os.homedir() in this worker is the temp home', () => {
  expect(os.homedir()).toBe(tmp);
});

test('a spawned child with ...process.env resolves the temp home', () => {
  const out = execFileSync(process.execPath, ['-e', 'process.stdout.write(require("os").homedir())'], {
    env: { ...process.env }, encoding: 'utf-8',
  });
  expect(out).toBe(tmp);
});

test('the modules that write ~/.solid resolve it under the temp home', () => {
  let cfgDir = '';
  jest.isolateModules(() => {
    const { defaultMcpKeyFile } = jest.requireActual('../lib/mcp-key');
    cfgDir = path.dirname(defaultMcpKeyFile());
  });
  expect(cfgDir).toBe(path.join(tmp as string, '.solid'));
});

describe('what the teardown counts as the suite touching the real home', () => {
  const { realHomeViolation } = require('./support/global-teardown');
  const fp = (history: string, config = '903:1') => ({ 'cli_history.json': history, 'config.json': config });
  const old = [{ command: 'find invoices', ts: '2026-10-08T21:00:00.000Z' }];
  const hook = { command: 'context --claude --raw --if-tenant', ts: '2026-10-08T22:41:50.521Z' };

  test('nothing changed', () => {
    expect(realHomeViolation(fp('10:1'), fp('10:1'), old, old)).toBeNull();
  });

  test('a Claude session opening mid-run is not the suite', () => {
    expect(realHomeViolation(fp('10:1'), fp('20:2'), old, [...old, hook])).toBeNull();
  });

  test('any other new command fails and is named', () => {
    const leak = { command: 'mcp connect gpt', ts: '2026-10-08T22:42:00.000Z' };
    expect(realHomeViolation(fp('10:1'), fp('30:3'), old, [...old, hook, leak])).toContain('mcp connect gpt');
  });

  test('a history rewrite that adds nothing fails', () => {
    expect(realHomeViolation(fp('10:1'), fp('2:3'), old, [])).toContain('rewrote');
  });

  test('a change to any other watched file fails even beside a hook entry', () => {
    expect(realHomeViolation(fp('10:1'), fp('20:2', '5:9'), old, [...old, hook])).toContain('config.json');
  });
});
