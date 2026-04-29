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
  tenantManifestForHook,
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

  it('refuses $HOME even if a manifest exists there (home reason)', () => {
    const r = checkTenantManifest(os.homedir(), 42);
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.kind === 'protected_root') {
      expect(r.failure.reason).toBe('home');
    } else {
      throw new Error(`expected protected_root/home, got ${JSON.stringify(r)}`);
    }
  });

  it('refuses $HOME/.claude even if a manifest exists there (home_claude reason)', () => {
    const r = checkTenantManifest(path.join(os.homedir(), '.claude'), 42);
    expect(r.ok).toBe(false);
    if (!r.ok && r.failure.kind === 'protected_root') {
      expect(r.failure.reason).toBe('home_claude');
    } else {
      throw new Error(`expected protected_root/home_claude, got ${JSON.stringify(r)}`);
    }
  });

  it('refuses the platform monorepo root AND its subdirectories (platform_repo reason)', () => {
    // Simulate the marker file so the walk-up detects a platform monorepo.
    fs.writeFileSync(path.join(baseDir, 'docker-compose.base.yml'), '# marker');
    const inner = path.join(baseDir, 'solid-cli');
    fs.mkdirSync(inner);

    const rRoot = checkTenantManifest(baseDir, 42);
    expect(rRoot.ok).toBe(false);
    if (!rRoot.ok && rRoot.failure.kind === 'protected_root') {
      expect(rRoot.failure.reason).toBe('platform_repo');
      expect(rRoot.failure.platformRoot).toBe(path.resolve(baseDir));
    } else {
      throw new Error(`expected protected_root/platform_repo at root, got ${JSON.stringify(rRoot)}`);
    }

    const rInner = checkTenantManifest(inner, 42);
    expect(rInner.ok).toBe(false);
    if (!rInner.ok && rInner.failure.kind === 'protected_root') {
      expect(rInner.failure.reason).toBe('platform_repo');
    } else {
      throw new Error(`expected protected_root/platform_repo in subdir, got ${JSON.stringify(rInner)}`);
    }
  });

  it('does NOT treat an ordinary tmpdir as a protected root', () => {
    // No docker-compose.base.yml anywhere above — fall through to `missing`.
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

  it('exits 1 with a platform-repo refusal when baseDir walks up to docker-compose.base.yml', () => {
    fs.writeFileSync(path.join(baseDir, 'docker-compose.base.yml'), '# marker');
    expect(() => requireTenantManifest(baseDir, 42)).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/platform monorepo/i);
    expect(errors).toMatch(/Role-1 territory/i);
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

  it('exits 1 when baseDir walks up to docker-compose.base.yml (platform_repo)', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'refuse-repo-'));
    try {
      fs.writeFileSync(path.join(tmp, 'docker-compose.base.yml'), '# marker');
      expect(() => refuseProtectedRoot(tmp)).toThrow('__process_exit__:1');
      const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
      expect(errors).toMatch(/platform monorepo/i);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('is a no-op on an ordinary tmpdir (no marker, not $HOME)', () => {
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
    // A tmpdir with no marker walks up to /var/folders → /var → / — none
    // contain docker-compose.base.yml, so the predicate returns false.
    const clean = fs.mkdtempSync(path.join(os.tmpdir(), 'predicate-clean-'));
    try {
      expect(isProtectedRoot(clean)).toBe(false);
    } finally {
      fs.rmSync(clean, { recursive: true, force: true });
    }
  });
});

describe('tenantManifestForHook (lenient guard for SessionStart hooks)', () => {
  // Why this exists, in one line: when Claude Code runs `solid context
  // --claude --raw --if-tenant` from a SessionStart hook outside a tenant
  // directory, we want a silent exit 0 — not the loud "Refusing to write
  // tenant data" banner the hard guard prints. This shape is what makes
  // the hook safe to install globally.
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

  it('returns null silently when manifest is missing (the common hook-in-arbitrary-cwd case)', () => {
    const result = tenantManifestForHook(baseDir, 42);
    expect(result).toBeNull();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returns null silently when baseDir is $HOME (protected_root/home)', () => {
    const result = tenantManifestForHook(os.homedir(), 42);
    expect(result).toBeNull();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returns null silently when baseDir is $HOME/.claude (protected_root/home_claude)', () => {
    const result = tenantManifestForHook(path.join(os.homedir(), '.claude'), 42);
    expect(result).toBeNull();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('returns null silently when baseDir is the platform monorepo (protected_root/platform_repo)', () => {
    // This is the exact case Adam saw in the screenshot that triggered
    // this fix: launching `claude` from /Desktop/Solid printed the
    // "Refusing to write tenant data inside the Solid# platform monorepo"
    // banner via the SessionStart hook. With --if-tenant we want silence.
    fs.writeFileSync(path.join(baseDir, 'docker-compose.base.yml'), '# marker');
    const result = tenantManifestForHook(baseDir, 42);
    expect(result).toBeNull();
    expect(exitSpy).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('exits 1 LOUDLY on company-mismatch (silent skip would let stale context leak across tenants)', () => {
    writeManifest(baseDir, { company_id: 61, company_name: 'ANGL LLC' });
    expect(() => tenantManifestForHook(baseDir, 42)).toThrow('__process_exit__:1');
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/company 61/);
    expect(errors).toMatch(/company 42/);
    expect(errors).toMatch(/solid switch 61/);
  });

  it('returns the parsed manifest when company_id matches', () => {
    writeManifest(baseDir, { company_id: 42, company_name: 'Match Co' });
    const m = tenantManifestForHook(baseDir, 42);
    expect(m).not.toBeNull();
    expect(m!.company_id).toBe(42);
    expect(m!.company_name).toBe('Match Co');
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
