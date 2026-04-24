/**
 * solid doctor env — pure-function tests.
 *
 * All I/O goes through a DoctorEnvDeps bundle, so we build a tmp dir +
 * fake config + scripted apiGet per scenario. No network, no real
 * Commander, no process.exit. The command wrapper in doctor.ts is a
 * thin shell around runDoctorEnv.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  DoctorEnvDeps,
  checkAuth,
  checkBackend,
  checkContextFreshness,
  checkHook,
  checkManifest,
  checkToken,
  runDoctorEnv,
} from '../../lib/doctor-env';

function makeConfig(overrides: Partial<DoctorEnvDeps['config']> = {}): DoctorEnvDeps['config'] {
  return {
    isLoggedIn: () => true,
    companyId: 61,
    accessToken: 'tok',
    tokenExpiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // 2h out
    ...overrides,
  };
}

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'doctor-env-'));
}

function makeDeps(partial: Partial<DoctorEnvDeps> & { cwd: string; home: string }): DoctorEnvDeps {
  return {
    claudeSettingsPath: path.join(partial.home, '.claude', 'settings.json'),
    hookCommand: 'solid context --claude --raw',
    config: partial.config ?? makeConfig(),
    apiGet: partial.apiGet ?? (async () => ({ status: 200 })),
    freshnessWindowMs: partial.freshnessWindowMs,
    now: partial.now,
    ...partial,
  };
}

// Env vars pollute checkAuth / checkToken — clear them per test.
beforeEach(() => {
  delete process.env.SOLID_API_KEY;
  delete process.env.SOLID_TOKEN;
});

// -- auth ------------------------------------------------------------------

describe('checkAuth', () => {
  test('logged-in JWT → pass with company_id', () => {
    const r = checkAuth(makeDeps({ cwd: tmpDir(), home: tmpDir() }));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/cached access_token/);
    expect(r.detail).toMatch(/company_id=61/);
  });

  test('SOLID_API_KEY env → pass with env label', () => {
    process.env.SOLID_API_KEY = 'sk_test';
    const deps = makeDeps({
      cwd: tmpDir(),
      home: tmpDir(),
      config: makeConfig({ isLoggedIn: () => true, accessToken: undefined }),
    });
    const r = checkAuth(deps);
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/SOLID_API_KEY/);
  });

  test('no creds → fail with login hint', () => {
    const deps = makeDeps({
      cwd: tmpDir(),
      home: tmpDir(),
      config: makeConfig({ isLoggedIn: () => false, accessToken: undefined }),
    });
    const r = checkAuth(deps);
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/solid auth login/);
  });
});

// -- token -----------------------------------------------------------------

describe('checkToken', () => {
  test('env-var auth → skip (no local expiry)', () => {
    process.env.SOLID_API_KEY = 'sk_test';
    const r = checkToken(makeDeps({ cwd: tmpDir(), home: tmpDir() }));
    expect(r.status).toBe('skip');
  });

  test('expired JWT → fail', () => {
    const r = checkToken(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      config: makeConfig({ tokenExpiresAt: new Date(Date.now() - 5 * 60_000) }),
    }));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/expired/);
  });

  test('JWT <30m left → warn', () => {
    const r = checkToken(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      config: makeConfig({ tokenExpiresAt: new Date(Date.now() + 10 * 60_000) }),
    }));
    expect(r.status).toBe('warn');
  });

  test('JWT >30m left → pass', () => {
    const r = checkToken(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      config: makeConfig({ tokenExpiresAt: new Date(Date.now() + 3 * 60 * 60_000) }),
    }));
    expect(r.status).toBe('pass');
  });
});

// -- manifest --------------------------------------------------------------

describe('checkManifest', () => {
  test('protected root ($HOME) → fail', () => {
    const home = tmpDir();
    const r = checkManifest(makeDeps({ cwd: home, home }));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/protected root/);
  });

  test('no manifest → warn', () => {
    const home = tmpDir();
    const cwd = tmpDir();
    const r = checkManifest(makeDeps({ cwd, home }));
    expect(r.status).toBe('warn');
    expect(r.hint).toMatch(/solid pull/);
  });

  test('manifest matches active company → pass', () => {
    const home = tmpDir();
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.solid'));
    fs.writeFileSync(
      path.join(cwd, '.solid', 'manifest.json'),
      JSON.stringify({ company_id: 61, company_name: 'ANGL LLC' }),
    );
    const r = checkManifest(makeDeps({ cwd, home }));
    expect(r.status).toBe('pass');
    expect(r.detail).toMatch(/company_id=61/);
  });

  test('manifest mismatch → fail with switch hint', () => {
    const home = tmpDir();
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.solid'));
    fs.writeFileSync(
      path.join(cwd, '.solid', 'manifest.json'),
      JSON.stringify({ company_id: 99, company_name: 'Other' }),
    );
    const r = checkManifest(makeDeps({
      cwd, home,
      config: makeConfig({ companyId: 61 }),
    }));
    expect(r.status).toBe('fail');
    expect(r.detail).toMatch(/binds company_id=99/);
    expect(r.hint).toMatch(/solid switch 99/);
  });

  test('malformed JSON → fail', () => {
    const home = tmpDir();
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.solid'));
    fs.writeFileSync(path.join(cwd, '.solid', 'manifest.json'), '{ broken');
    const r = checkManifest(makeDeps({ cwd, home }));
    expect(r.status).toBe('fail');
  });
});

// -- hook ------------------------------------------------------------------

describe('checkHook', () => {
  test('settings.json missing → fail', () => {
    const home = tmpDir();
    const r = checkHook(makeDeps({
      cwd: tmpDir(), home,
      claudeSettingsPath: path.join(home, 'nope.json'),
    }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/solid install/);
  });

  test('current hook command present → pass', () => {
    const home = tmpDir();
    const settings = path.join(home, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'solid context --claude --raw' }] }] },
    }));
    const r = checkHook(makeDeps({ cwd: tmpDir(), home, claudeSettingsPath: settings }));
    expect(r.status).toBe('pass');
  });

  test('legacy solid-context command present → warn', () => {
    const home = tmpDir();
    const settings = path.join(home, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'solid context --claude --quiet' }] }] },
    }));
    const r = checkHook(makeDeps({ cwd: tmpDir(), home, claudeSettingsPath: settings }));
    expect(r.status).toBe('warn');
  });

  test('no solid hook at all → fail', () => {
    const home = tmpDir();
    const settings = path.join(home, 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({ hooks: {} }));
    const r = checkHook(makeDeps({ cwd: tmpDir(), home, claudeSettingsPath: settings }));
    expect(r.status).toBe('fail');
  });
});

// -- context freshness -----------------------------------------------------

describe('checkContextFreshness', () => {
  test('.claude/CLAUDE.md absent → warn', () => {
    const r = checkContextFreshness(makeDeps({ cwd: tmpDir(), home: tmpDir() }));
    expect(r.status).toBe('warn');
  });

  test('recently regenerated → pass', () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(path.join(cwd, '.claude', 'CLAUDE.md'), 'x');
    const r = checkContextFreshness(makeDeps({ cwd, home: tmpDir() }));
    expect(r.status).toBe('pass');
  });

  test('stale → warn with refresh hint', () => {
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.claude'));
    const f = path.join(cwd, '.claude', 'CLAUDE.md');
    fs.writeFileSync(f, 'x');
    // Backdate the file 48 hours with utimes.
    const past = new Date(Date.now() - 48 * 60 * 60 * 1000);
    fs.utimesSync(f, past, past);
    const r = checkContextFreshness(makeDeps({ cwd, home: tmpDir() }));
    expect(r.status).toBe('warn');
    expect(r.detail).toMatch(/48h old/);
  });
});

// -- backend reachability ---------------------------------------------------

describe('checkBackend', () => {
  test('not logged in → skip', async () => {
    const r = await checkBackend(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      config: makeConfig({ isLoggedIn: () => false }),
    }));
    expect(r.status).toBe('skip');
  });

  test('200 fast → pass', async () => {
    const r = await checkBackend(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      apiGet: async () => ({ status: 200 }),
    }));
    expect(r.status).toBe('pass');
  });

  test('5xx → fail', async () => {
    const r = await checkBackend(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      apiGet: async () => ({ status: 503 }),
    }));
    expect(r.status).toBe('fail');
  });

  test('request throws → fail with network hint', async () => {
    const r = await checkBackend(makeDeps({
      cwd: tmpDir(), home: tmpDir(),
      apiGet: async () => { throw new Error('ECONNREFUSED'); },
    }));
    expect(r.status).toBe('fail');
    expect(r.hint).toMatch(/network|DNS/);
  });
});

// -- runner summary -------------------------------------------------------

describe('runDoctorEnv', () => {
  test('all green → ok=true, exit-ready', async () => {
    const home = tmpDir();
    const cwd = tmpDir();
    // Bind manifest
    fs.mkdirSync(path.join(cwd, '.solid'));
    fs.writeFileSync(
      path.join(cwd, '.solid', 'manifest.json'),
      JSON.stringify({ company_id: 61 }),
    );
    // Install hook
    fs.mkdirSync(path.join(home, '.claude'));
    const settings = path.join(home, '.claude', 'settings.json');
    fs.writeFileSync(settings, JSON.stringify({
      hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'solid context --claude --raw' }] }] },
    }));
    // Drop a fresh CLAUDE.md
    fs.mkdirSync(path.join(cwd, '.claude'));
    fs.writeFileSync(path.join(cwd, '.claude', 'CLAUDE.md'), 'ok');

    const report = await runDoctorEnv(makeDeps({
      cwd, home, claudeSettingsPath: settings,
    }));
    expect(report.ok).toBe(true);
    expect(report.summary.fail).toBe(0);
    // pass on: auth, token, manifest, hook, context, backend
    expect(report.summary.pass).toBeGreaterThanOrEqual(6);
  });

  test('missing hook AND expired token → two FAILs, ok=false', async () => {
    const home = tmpDir();
    const cwd = tmpDir();
    fs.mkdirSync(path.join(cwd, '.solid'));
    fs.writeFileSync(
      path.join(cwd, '.solid', 'manifest.json'),
      JSON.stringify({ company_id: 61 }),
    );
    fs.mkdirSync(path.join(home, '.claude'));
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), '{}');

    const report = await runDoctorEnv(makeDeps({
      cwd, home,
      claudeSettingsPath: path.join(home, '.claude', 'settings.json'),
      config: makeConfig({
        tokenExpiresAt: new Date(Date.now() - 60_000),
      }),
    }));
    expect(report.ok).toBe(false);
    expect(report.summary.fail).toBeGreaterThanOrEqual(2);
  });
});
