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
