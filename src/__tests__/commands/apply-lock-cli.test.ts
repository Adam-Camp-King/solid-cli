/**
 * `solid apply` end to end against a mocked API: the lock is written beside
 * the manifest, `drift` classifies and exits, `--strict` refuses to overwrite
 * production that moved, `rollback` restores from the recorded pre-image, and
 * `export` shapes the live tenant into a manifest.
 */
jest.mock('ora', () => jest.fn(() => ({ start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(), succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(), text: '' })));
jest.mock('chalk', () => {
  type ChainFn = ((s?: unknown) => unknown) & Record<string | symbol, unknown>;
  const makeChain = (): ChainFn => {
    const fn = ((s?: unknown) => (s === undefined ? '' : String(s))) as ChainFn;
    return new Proxy(fn, {
      get: (_t, prop) => (prop === 'then' ? undefined : makeChain()),
      apply: (_t, _th, args: unknown[]) => (args[0] === undefined ? '' : String(args[0])),
    });
  };
  return { __esModule: true, default: makeChain() };
});
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: unknown) => ({ message: (e as Error)?.message || 'Error', status: 500 })),
}));
jest.mock('../../lib/command-kit', () => {
  const actual = jest.requireActual('../../lib/command-kit');
  return { ...actual, confirm: jest.fn().mockResolvedValue(true), requireCompanyContext: jest.fn() };
});
// The lock guard refuses $HOME and the platform repo; the temp dir is neither,
// but keep the test hermetic regardless of where CI checks out.
jest.mock('../../lib/tenant-guard', () => {
  const actual = jest.requireActual('../../lib/tenant-guard');
  return { ...actual, isProtectedRoot: () => false, refuseProtectedRoot: () => undefined };
});

import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

class ExitSignal extends Error { constructor(public code: number) { super(`exit ${code}`); } }

async function run(argv: string[]): Promise<number> {
  let code = 0;
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(((c?: number) => { throw new ExitSignal(c ?? 0); }) as never);
  try {
    await jest.isolateModulesAsync(async () => {
      const { applyCommand } = (await import('../../commands/apply')) as { applyCommand: any };
      await applyCommand.parseAsync(argv, { from: 'user' });
    });
  } catch (e) {
    if (e instanceof ExitSignal) code = e.code; else throw e;
  } finally {
    exitSpy.mockRestore();
  }
  return code;
}

let dir: string;
let manifest: string;
let lockPath: string;
let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;
let outSpy: jest.SpyInstance;
// emitJson writes straight to stdout; human output goes through console.log.
const logged = () => [
  ...outSpy.mock.calls.map((c) => String(c[0])),
  ...logSpy.mock.calls.map((c) => c.join(' ')),
].join('\n').trim();

beforeEach(() => {
  jest.clearAllMocks();
  config.accessToken = 'test_token';
  config.companyId = 61;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-apply-cli-'));
  manifest = path.join(dir, 'site.yaml');
  lockPath = path.join(dir, 'site.lock.json');
  fs.writeFileSync(manifest, 'kind: page\nslug: home\ntitle: Home\n---\nkind: page\nslug: about\ntitle: About\n');
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  outSpy = jest.spyOn(process.stdout, 'write').mockImplementation((() => true) as never);
});
afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
  outSpy.mockRestore();
  fs.rmSync(dir, { recursive: true, force: true });
});

function livePages(pages: Array<Record<string, unknown>>) {
  mockApi.get.mockResolvedValue({ data: { pages }, status: 200, success: true } as never);
}

describe('solid apply — lock, drift, strict, rollback, export', () => {
  it('apply writes the lock beside the manifest with ids, specs and a pre-image per write', async () => {
    livePages([{ id: 2, slug: 'about', title: 'Old About' }]);
    mockApi.post.mockResolvedValue({} as never);
    mockApi.patch.mockResolvedValue({} as never);
    const code = await run([manifest, '--json']);
    expect(code).toBe(0);
    expect(mockApi.post).toHaveBeenCalledWith('/api/v1/cms/pages', { slug: 'home', title: 'Home' }, expect.anything());
    expect(mockApi.patch).toHaveBeenCalledWith('/api/v1/cms/pages/2', { slug: 'about', title: 'About' }, expect.anything());
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(lock.company_id).toBe(61);
    expect(lock.resources['page/about']).toMatchObject({ id: 2, spec: { slug: 'about', title: 'About' } });
    expect(lock.runs).toHaveLength(1);
    expect(lock.runs[0].actions.find((a: any) => a.identity === 'about').before).toEqual({ slug: 'about', title: 'Old About' });
    const out = JSON.parse(logged());
    expect(out.lock).toBe(lockPath);
    expect(out.run_id).toBe(lock.runs[0].run_id);
  });

  it('--dry-run and --no-lock write no lock', async () => {
    livePages([]);
    expect(await run([manifest, '--dry-run', '--json'])).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
    mockApi.post.mockResolvedValue({} as never);
    expect(await run([manifest, '--no-lock', '--json'])).toBe(0);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('drift: production edited outside git → live_changed, exit 1; git ahead → manifest_changed, exit 0', async () => {
    livePages([{ id: 1, slug: 'home', title: 'Home' }, { id: 2, slug: 'about', title: 'Old About' }]);
    mockApi.post.mockResolvedValue({} as never);
    mockApi.patch.mockResolvedValue({} as never);
    await run([manifest, '--json']);
    logSpy.mockClear(); outSpy.mockClear();

    // Someone renamed "home" in the dashboard.
    livePages([{ id: 1, slug: 'home', title: 'Home (dashboard)' }, { id: 2, slug: 'about', title: 'About' }]);
    expect(await run(['drift', manifest, '--json'])).toBe(1);
    let report = JSON.parse(logged());
    expect(report.production_drift).toBe(1);
    const home = report.entries.find((e: any) => e.identity === 'home');
    expect(home.state).toBe('live_changed');
    expect(home.live_diff).toEqual([{ field: 'title', lock: 'Home', live: 'Home (dashboard)' }]);
    logSpy.mockClear(); outSpy.mockClear();

    // Git moves "about"; production is where apply left it → pending, not drift.
    livePages([{ id: 1, slug: 'home', title: 'Home' }, { id: 2, slug: 'about', title: 'About' }]);
    fs.writeFileSync(manifest, 'kind: page\nslug: home\ntitle: Home\n---\nkind: page\nslug: about\ntitle: About v2\n');
    expect(await run(['drift', manifest, '--json'])).toBe(0);
    report = JSON.parse(logged());
    expect(report.entries.find((e: any) => e.identity === 'about').state).toBe('manifest_changed');
    logSpy.mockClear(); outSpy.mockClear();
    expect(await run(['drift', manifest, '--json', '--fail-on-any'])).toBe(1);
  });

  it('--strict refuses to overwrite production that moved (exit 3) and writes nothing', async () => {
    livePages([{ id: 1, slug: 'home', title: 'Home' }, { id: 2, slug: 'about', title: 'About' }]);
    await run([manifest, '--json']);
    jest.clearAllMocks();
    livePages([{ id: 1, slug: 'home', title: 'Home (dashboard)' }, { id: 2, slug: 'about', title: 'About' }]);
    expect(await run([manifest, '--strict', '--json'])).toBe(3);
    expect(mockApi.patch).not.toHaveBeenCalled();
    expect(mockApi.post).not.toHaveBeenCalled();
    const out = JSON.parse(logged());
    expect(out.error).toMatch(/production changed/);
    expect(out.drift[0].identity).toBe('home');
  });

  it('rollback restores the recorded pre-image, verifies it, and records itself', async () => {
    livePages([{ id: 2, slug: 'about', title: 'Old About' }, { id: 1, slug: 'home', title: 'Home' }]);
    mockApi.patch.mockResolvedValue({} as never);
    await run([manifest, '--json']);
    const before = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(before.runs[0].actions).toHaveLength(1); // only "about" changed
    jest.clearAllMocks();
    logSpy.mockClear(); outSpy.mockClear();
    // After the revert the server reads the old title again.
    livePages([{ id: 2, slug: 'about', title: 'Old About' }, { id: 1, slug: 'home', title: 'Home' }]);
    mockApi.patch.mockResolvedValue({} as never);
    expect(await run(['rollback', manifest, '--yes', '--json'])).toBe(0);
    expect(mockApi.patch).toHaveBeenCalledWith('/api/v1/cms/pages/2', { slug: 'about', title: 'Old About' }, expect.anything());
    const out = JSON.parse(logged());
    expect(out.reverted).toBe(before.runs[0].run_id);
    expect(out.verified).toEqual([{ kind: 'page', identity: 'about', ok: true }]);
    const after = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    expect(after.runs).toHaveLength(2);
    expect(after.runs[1]).toMatchObject({ kind: 'rollback', reverts: before.runs[0].run_id });
    expect(after.resources['page/about'].spec).toEqual({ slug: 'about', title: 'Old About' });
  });

  it('rollback refuses in json mode without --yes and writes nothing', async () => {
    livePages([{ id: 2, slug: 'about', title: 'Old About' }, { id: 1, slug: 'home', title: 'Home' }]);
    mockApi.patch.mockResolvedValue({} as never);
    await run([manifest, '--json']);
    jest.clearAllMocks();
    expect(await run(['rollback', manifest, '--json'])).toBe(1);
    expect(mockApi.patch).not.toHaveBeenCalled();
  });

  it('export writes the live tenant as a manifest with read-only fields stripped', async () => {
    mockApi.get.mockImplementation((async (url: string) => {
      if (url.startsWith('/api/v1/cms/pages')) return { data: { pages: [{ id: 1, company_id: 61, slug: 'home', title: 'Home', created_at: 'x' }] } };
      if (url.startsWith('/api/v1/cli/brand')) return { data: { brand: { id: 1, name: 'Acme', design: { primary: '#000' }, voice: {}, rules: {}, updated_at: 'y' } } };
      return { data: { items: [] } };
    }) as never);
    const out = path.join(dir, 'business.yaml');
    expect(await run(['export', out, '--kinds', 'page,brand'])).toBe(0);
    const text = fs.readFileSync(out, 'utf8');
    expect(text).toContain('kind: page');
    expect(text).toContain('slug: home');
    expect(text).not.toContain('company_id');
    expect(text).not.toContain('created_at');
    expect(text).toContain('kind: brand');
    expect(text).toContain("primary: '#000'");
    const { parseManifest } = await import('../../lib/apply/engine');
    expect(parseManifest(text).map((r) => [r.kind, r.identity])).toEqual([['page', 'home'], ['brand', 'brand']]);
  });

  it('history lists the runs the lock remembers', async () => {
    livePages([]);
    mockApi.post.mockResolvedValue({} as never);
    await run([manifest, '--json']);
    logSpy.mockClear(); outSpy.mockClear();
    expect(await run(['history', manifest, '--json'])).toBe(0);
    const out = JSON.parse(logged());
    expect(out.runs).toHaveLength(1);
    expect(out.resources).toBe(2);
  });
});
