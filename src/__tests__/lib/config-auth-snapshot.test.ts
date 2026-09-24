/**
 * `auth login --token` sets the old session aside before verifying the key.
 *
 * ⛔ It used to replace only the access token: the previous account's refresh
 * token, expiry and cached companies stayed, so the auto-refresh could flip the
 * CLI back to the old account — including DURING verification of a bad key.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REAL_HOME = os.homedir();

function freshConfig() {
  // ⛔ NOT process.env.HOME. Jest hands each test file its OWN copy of
  // process.env, so setting HOME here never reaches libuv — os.homedir() still
  // returned the real home and an earlier version of this test overwrote the
  // developer's real ~/.solid/config.json. The config module's own `os` is
  // mocked (os.homedir cannot be spied on), and the temp home is checked
  // against the real one before anything loads.
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-cli-home-'));
  if (path.resolve(home) === path.resolve(REAL_HOME)) throw new Error('refusing: temp home is the real home');
  let mod: typeof import('../../lib/config');
  jest.isolateModules(() => {
    jest.doMock('os', () => ({ ...jest.requireActual('os'), homedir: () => home }));
    // The global setup mocks this module to keep tests off ~/.solid; with
    // os.homedir pointed at a temp dir the REAL one is safe to load.
    mod = jest.requireActual('../../lib/config');
  });
  return { config: mod!.config, home };
}

describe('config auth snapshot/restore', () => {
  const realConfig = path.join(REAL_HOME, '.solid', 'config.json');
  const before = fs.existsSync(realConfig) ? fs.readFileSync(realConfig, 'utf-8') : null;
  afterEach(() => { jest.restoreAllMocks(); });
  afterAll(() => {
    // The whole point: the developer's real CLI login is never touched.
    const after = fs.existsSync(realConfig) ? fs.readFileSync(realConfig, 'utf-8') : null;
    expect(after).toBe(before);
  });

  it('logout before a new key leaves no trace of the previous account', () => {
    const { config } = freshConfig();
    config.accessToken = 'jwt-old';
    config.refreshToken = 'refresh-old';
    config.tokenExpiresAt = new Date(Date.now() + 60_000);
    config.companies = [{ id: 58, name: 'Monecity' } as any];
    config.companyId = 58;

    config.logout();
    config.accessToken = 'sk_solid_new';

    expect(config.accessToken).toBe('sk_solid_new');
    expect(config.refreshToken).toBeUndefined();
    expect(config.tokenExpiresAt).toBeUndefined();
    expect(config.companies).toBeUndefined();
    expect(config.companyId).toBeUndefined();
  });

  it('a bad key restores the previous login exactly', () => {
    const { config } = freshConfig();
    config.accessToken = 'jwt-old';
    config.refreshToken = 'refresh-old';
    config.companyId = 58;
    config.userEmail = 'owner@example.com';

    const previous = config.snapshotAuth();
    config.logout();
    config.accessToken = 'sk_solid_typo';
    config.restoreAuth(previous);

    expect(config.accessToken).toBe('jwt-old');
    expect(config.refreshToken).toBe('refresh-old');
    expect(config.companyId).toBe(58);
    expect(config.userEmail).toBe('owner@example.com');
  });

  it('the --token path sets the old session aside BEFORE verifying', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'commands', 'auth.ts'), 'utf-8');
    const block = src.slice(src.indexOf('if (options.token) {'), src.indexOf('Browser login (default'));
    expect(block.indexOf('config.logout()')).toBeGreaterThan(-1);
    expect(block.indexOf('config.logout()')).toBeLessThan(block.indexOf('apiClient.authStatus()'));
    expect(block).toMatch(/config\.restoreAuth\(previous\)/);
  });
});
