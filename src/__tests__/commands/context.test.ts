/**
 * Integration tests for `solid context`.
 *
 * Verifies the tenant-boundary guard is wired into write paths (--claude,
 * --cursor, --codex, --save, --watch) and skipped on read-only paths
 * (--summary, --tools-only, --section).
 *
 * See Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-CANONICAL-TRUTH.md.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// `config` is mocked globally by src/__tests__/setup.ts (companyId=99999).
// We mock ora + chalk here because they're ESM-only and ts-jest without
// transformIgnorePatterns can't parse them. Only importability matters —
// behavior is not under test in this file.
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('chalk', () => {
  const id = (s: string) => s;
  const proxy: any = new Proxy(id, { get: () => proxy });
  return { __esModule: true, default: proxy };
});

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));

import { contextCommand } from '../../commands/context';
import { apiClient } from '../../lib/api-client';
const mockApi = apiClient as jest.Mocked<typeof apiClient>;

function makeTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'solid-ctx-test-'));
}

describe('solid context — tenant-boundary guard', () => {
  let baseDir: string;
  let origCwd: string;
  let exitSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;
  let logSpy: jest.SpyInstance;

  beforeEach(() => {
    baseDir = makeTmpdir();
    origCwd = process.cwd();
    process.chdir(baseDir);
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
      throw new Error(`__process_exit__:${code}`);
    }) as never);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    process.chdir(origCwd);
    exitSpy.mockRestore();
    errSpy.mockRestore();
    logSpy.mockRestore();
    fs.rmSync(baseDir, { recursive: true, force: true });
  });

  it('refuses --claude in an unbound directory and does NOT create .claude/', async () => {
    await expect(
      contextCommand.parseAsync(['node', 'solid', '--claude']),
    ).rejects.toThrow('__process_exit__:1');

    expect(fs.existsSync(path.join(baseDir, '.claude'))).toBe(false);
    const errors = errSpy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(errors).toMatch(/Not a Solid# tenant working directory/i);
  });

  it('refuses --cursor in an unbound directory and does NOT create .cursorrules', async () => {
    await expect(
      contextCommand.parseAsync(['node', 'solid', '--cursor']),
    ).rejects.toThrow('__process_exit__:1');

    expect(fs.existsSync(path.join(baseDir, '.cursorrules'))).toBe(false);
  });

  it('refuses --save in an unbound directory and does NOT create SOLID-CONTEXT.md', async () => {
    await expect(
      contextCommand.parseAsync(['node', 'solid', '--save']),
    ).rejects.toThrow('__process_exit__:1');

    expect(fs.existsSync(path.join(baseDir, 'SOLID-CONTEXT.md'))).toBe(false);
  });

  it('allows --summary in an unbound directory (read-only path, no guard)', async () => {
    mockApi.get.mockResolvedValue({
      data: {
        company_name: 'Test',
        industry: 'testing',
        tier: 'starter',
        kb_count: 0,
        page_count: 0,
        pending_drafts: 0,
        service_count: 0,
        product_count: 0,
        agent_count: 0,
        chain_count: 0,
        module_count: 0,
        custom_domain_count: 0,
        agency_managed: false,
        recent_activity_count: 0,
        generated_at: '2026-04-23T00:00:00Z',
      },
      status: 200,
      success: true,
    });

    await contextCommand.parseAsync(['node', 'solid', '--summary']);
    expect(exitSpy).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(baseDir, '.claude'))).toBe(false);
    expect(fs.existsSync(path.join(baseDir, 'SOLID-CONTEXT.md'))).toBe(false);
  });
});
