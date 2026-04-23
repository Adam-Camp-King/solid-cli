/**
 * Tenant-directory guard tests.
 *
 * Validates the rules documented in
 * Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-CANONICAL-TRUTH.md § Write Model.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  checkTenantManifest,
  requireTenantManifest,
  refuseProtectedRoot,
  isProtectedRoot,
  PullManifest,
} from '../../lib/tenant-guard';

function makeTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-guard-test-'));
}

function writeManifest(dir: string, m: Partial<PullManifest>): void {
  const full: PullManifest = {
    company_id: m.company_id ?? 42,
    company_name: m.company_name ?? 'Test Co',
    pulled_at: '2026-04-23T00:00:00Z',
    api_url: 'https://api.example.com',
    pages: {},
    kb: {},
    services: {},
    products: {},
  };
  fs.mkdirSync(path.join(dir, '.solid'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.solid', 'manifest.json'), JSON.stringify(full));
}

describe('checkTenantManifest', () => {
  let baseDir: string;

  beforeEach(() => { baseDir = makeTmpdir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  it('returns missing when .solid/manifest.json does not exist', () => {
    const r = checkTenantManifest(baseDir, 42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('missing');
  });

  it('returns mismatch when manifest.company_id differs from active company', () => {
    writeManifest(baseDir, { company_id: 61, company_name: 'ANGL LLC' });
    const r = checkTenantManifest(baseDir, 42);
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.kind === 'mismatch') {
      expect(r.failure.manifestCompanyId).toBe(61);
      expect(r.failure.manifestCompanyName).toBe('ANGL LLC');
      expect(r.failure.activeCompanyId).toBe(42);
    } else {
      throw new Error(`expected mismatch, got ${JSON.stringify(r)}`);
    }
  });

  it('returns ok with the parsed manifest when company_id matches', () => {
    writeManifest(baseDir, { company_id: 42, company_name: 'Match Co' });
    const r = checkTenantManifest(baseDir, 42);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.manifest.company_id).toBe(42);
      expect(r.manifest.company_name).toBe('Match Co');
    }
  });

  it('refuses $HOME even if a manifest exists there (home_dir rule)', () => {
    const r = checkTenantManifest(os.homedir(), 42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('home_dir');
  });

  it('refuses $HOME/.claude even if a manifest exists there (home_dir rule)', () => {
    const r = checkTenantManifest(path.join(os.homedir(), '.claude'), 42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('home_dir');
  });

  it('does NOT treat /tmp as a protected root (only $HOME itself is protected)', () => {
    const r = checkTenantManifest(baseDir, 42);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.failure.kind).toBe('missing');
  });
});

describe('requireTenantManifest (CLI wrapper)', () => {
  let baseDir: string;
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    baseDir = makeTmpdir();
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__process_exit__:${code}`);
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('exits 1 with a "Not a Solid# tenant working directory" error when manifest is missing', () => {
    expect(() => requireTenantManifest(baseDir, 42)).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/Not a Solid# tenant working directory/i);
  });

  it('exits 1 with a company-mismatch error and suggests `solid switch`', () => {
    writeManifest(baseDir, { company_id: 61, company_name: 'ANGL LLC' });
    expect(() => requireTenantManifest(baseDir, 42)).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/company 61/);
    expect(errors).toMatch(/company 42/);
    expect(errors).toMatch(/solid switch 61/);
  });

  it('exits 1 with a home-dir refusal when baseDir is $HOME', () => {
    expect(() => requireTenantManifest(os.homedir(), 42)).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/Refusing to write tenant data to your home directory/i);
  });

  it('returns the parsed manifest when company_id matches', () => {
    writeManifest(baseDir, { company_id: 42, company_name: 'Match Co' });
    const m = requireTenantManifest(baseDir, 42);
    expect(m.company_id).toBe(42);
    expect(m.company_name).toBe('Match Co');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});

describe('refuseProtectedRoot (pull.ts helper)', () => {
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__process_exit__:${code}`);
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    exitSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('exits 1 when baseDir is $HOME', () => {
    expect(() => refuseProtectedRoot(os.homedir())).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/Refusing to write tenant data to your home directory/i);
  });

  it('exits 1 when baseDir is $HOME/.claude', () => {
    expect(() => refuseProtectedRoot(path.join(os.homedir(), '.claude'))).toThrow('__process_exit__:1');
  });

  it('is a no-op on an ordinary tmpdir', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refuse-test-'));
    try {
      refuseProtectedRoot(tmp);
      expect(exitSpy).not.toHaveBeenCalled();
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('isProtectedRoot predicate matches the refusal rule', () => {
    expect(isProtectedRoot(os.homedir())).toBe(true);
    expect(isProtectedRoot(path.join(os.homedir(), '.claude'))).toBe(true);
    expect(isProtectedRoot('/tmp')).toBe(false);
  });
});
