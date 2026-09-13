/**
 * `solid context` returns a brief by default, everything on request.
 *
 * Sprint VNP 4.3. It returned 109,477 bytes (~27,369 tokens) and is wired into
 * Claude Code's session-start hook, so it was paid whether or not the session
 * ever touched the business. The summary alone answers "what is this company"
 * in under 200 tokens.
 *
 * The tier applies ONLY to plain stdout. --save/--claude/--cursor/--codex write
 * files a person or editor reads later; truncating those would break the tenant
 * context contract rather than save anyone tokens, and there is a test for it.
 */
import { jest } from '@jest/globals';

const mockGet = jest.fn<any>();
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: mockGet, post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: unknown) => ({ message: (e as Error)?.message || 'e', status: 500 })),
  failApi: jest.fn(() => { throw new Error('FAILAPI'); }),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, companyId: 1, apiUrl: 'http://x' },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { contextCommand } = require('../../commands/context');

describe('solid context — tiered', () => {
  let printed: string;
  beforeEach(() => {
    jest.clearAllMocks();
    printed = '';
    jest.spyOn(console, 'log').mockImplementation((v?: unknown) => { printed += String(v); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    // Model the endpoint rather than returning one shape for everything:
    // format=markdown returns a string, and --full takes that path.
    // fetchContext puts params in the QUERY STRING, and the markdown shape is
    // {content}. Mocking the wrong shape is what made this test fail first.
    mockGet.mockImplementation((url: string) => {
      if (String(url).includes('format=markdown')) {
        return Promise.resolve({ data: { content: '# Acme\n\nfull context body\n' } });
      }
      return Promise.resolve({ data: { company_name: 'Acme', kb_count: 3 } });
    });
  });
  afterEach(() => jest.restoreAllMocks());

  function run(args: string[] = []) {
    (contextCommand as any)._optionValues = {};
    (contextCommand as any)._optionValueSources = {};
    return (contextCommand as any).parseAsync(args, { from: 'user' });
  }

  it('defaults to a brief, not the full dump', async () => {
    await run([]);
    const out = JSON.parse(printed);
    expect(out.schema).toBe('solid:context-brief/v1');
    expect(out.company).toBeDefined();
  });

  it('the brief points at the fuller tiers rather than dead-ending', async () => {
    await run([]);
    const next = JSON.parse(printed).next.join(' ');
    expect(next).toContain('--section');
    expect(next).toContain('--full');
  });

  it('lists the sections so the next call needs no guess', async () => {
    await run([]);
    expect(JSON.parse(printed).sections).toContain('capabilities');
  });

  it('--full opts back into everything', async () => {
    // The old default must remain reachable — scripts and codegen consume it.
    const written: string[] = [];
    jest.spyOn(process.stdout, 'write').mockImplementation(((c: unknown) => {
      written.push(String(c)); return true;
    }) as never);

    await run(['--full']);

    const out = written.join('') + printed;
    expect(out).not.toContain('solid:context-brief/v1');
    expect(out.length).toBeGreaterThan(0);
  });
});
