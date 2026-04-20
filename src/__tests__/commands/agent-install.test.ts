/**
 * CLI surface for the agent adapter kernel (Sprint T5 Phase 2).
 *
 * We exercise the action handlers directly rather than round-tripping
 * through `parseAsync`, because Commander accumulates parsed state on
 * a Command instance and tests that re-parse end up flaky. Invoking
 * action handlers manually gives us the exact same coverage (what
 * HTTP call does each subcommand make?) without that friction.
 */

// ora + chalk are ESM-only — stub them so the agent module can be imported.
jest.mock('ora', () => {
  return jest.fn(() => ({
    start: jest.fn().mockReturnThis(),
    stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(),
    fail: jest.fn().mockReturnThis(),
    text: '',
  }));
});

// Chainable chalk mock that handles chalk.red('x'), chalk.hex('#abc')('x'),
// and chalk.bold.hex('#abc')('x'). Heuristic: a '#'-prefixed short string
// looks like a color → return another callable chain. Otherwise: text.
jest.mock('chalk', () => {
  type ChainFn = ((s?: unknown) => unknown) & Record<string | symbol, unknown>;
  const looksLikeColor = (s: unknown): boolean =>
    typeof s === 'string' && s.startsWith('#') && s.length <= 9;
  const makeChain = (): ChainFn => {
    const fn = ((s?: unknown) => (s === undefined ? '' : String(s))) as ChainFn;
    return new Proxy(fn, {
      get: (_t, prop) => {
        if (prop === 'then') return undefined;
        return makeChain();
      },
      apply: (_t, _th, args: unknown[]) => {
        if (looksLikeColor(args[0])) return makeChain();
        return args[0] === undefined ? '' : String(args[0]);
      },
    });
  };
  return { __esModule: true, default: makeChain() };
});
jest.mock('inquirer', () => ({ prompt: jest.fn().mockResolvedValue({}) }));

jest.mock('../../lib/api-client', () => ({
  apiClient: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
  },
  handleApiError: jest.fn((e: unknown) => ({ message: (e as Error)?.message || 'Error', status: 500 })),
}));

jest.mock('../../lib/command-kit', () => {
  const actual = jest.requireActual('../../lib/command-kit');
  return {
    ...actual,
    confirm: jest.fn().mockResolvedValue(true),
  };
});

import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

const mockApi = apiClient as jest.Mocked<typeof apiClient>;

/**
 * Run a subcommand by name through Commander's own parse pipeline.
 * We isolate modules so each test gets a fresh agentCommand — commander
 * accumulates parsed state otherwise.
 */
async function runSub(argv: string[]): Promise<void> {
  await jest.isolateModulesAsync(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { agentCommand } = (await import('../../commands/agent')) as { agentCommand: any };
    await agentCommand.parseAsync(argv, { from: 'user' });
  });
}

// Swallow console output so the test log stays readable.
let logSpy: jest.SpyInstance;
let errSpy: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  config.accessToken = 'test_token';
  config.companyId = 99999;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  errSpy.mockRestore();
});

describe('agent install CLI', () => {
  it('install --adapter mcp --url posts the right body', async () => {
    mockApi.post.mockResolvedValue({
      data: { external_id: 'agt_abc', adapter_kind: 'mcp', display_name: 'Acme' },
      status: 201,
      success: true,
    });

    await runSub(['install', '--adapter', 'mcp', '--url', 'https://ex.com/mcp', '--display-name', 'Acme']);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/agent-install',
      expect.objectContaining({
        adapter_kind: 'mcp',
        display_name: 'Acme',
        manifest: { url: 'https://ex.com/mcp' },
      }),
    );
  });

  it('install --adapter http --endpoint --scope posts declared_scopes', async () => {
    mockApi.post.mockResolvedValue({
      data: { external_id: 'agt_def', adapter_kind: 'http' },
      status: 201,
      success: true,
    });

    await runSub([
      'install',
      '--adapter', 'http',
      '--endpoint', 'https://v.example',
      '--scope', 'kb:read', 'voice:outbound',
      '--display-name', 'Vendor',
    ]);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/agent-install',
      expect.objectContaining({
        adapter_kind: 'http',
        manifest: {
          endpoint: 'https://v.example',
          declared_scopes: ['kb:read', 'voice:outbound'],
        },
      }),
    );
  });

  it('installed lists GET /api/v1/agent-install', async () => {
    mockApi.get.mockResolvedValue({
      data: [
        { external_id: 'agt_a', display_name: 'A', adapter_kind: 'mcp', status: 'active', installed_at: '2026-04-20' },
      ],
      status: 200,
      success: true,
    });

    await runSub(['installed']);

    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/agent-install');
  });

  it('installed --all includes uninstalled', async () => {
    mockApi.get.mockResolvedValue({ data: [], status: 200, success: true });
    await runSub(['installed', '--all']);
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/agent-install?include_uninstalled=true');
  });

  it('grant posts scopes', async () => {
    mockApi.post.mockResolvedValue({
      data: { scopes: ['kb:read'] },
      status: 200,
      success: true,
    });

    await runSub(['grant', 'agt_abc', '--scope', 'kb:read', 'voice:outbound']);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/agent-install/agt_abc/grants',
      expect.objectContaining({ scopes: ['kb:read', 'voice:outbound'] }),
    );
  });

  it('revoke --all calls DELETE with all=true', async () => {
    mockApi.delete.mockResolvedValue({
      data: { scopes: [], revoked: true },
      status: 200,
      success: true,
    });

    await runSub(['revoke', 'agt_abc', '--all']);

    expect(mockApi.delete).toHaveBeenCalledWith(
      '/api/v1/agent-install/agt_abc/grants',
      expect.objectContaining({ params: expect.objectContaining({ all: true }) }),
    );
  });

  it('revoke without --scope or --all exits with error', async () => {
    await expect(runSub(['revoke', 'agt_abc'])).rejects.toThrow(/process.exit/);
    expect(mockApi.delete).not.toHaveBeenCalled();
  });

  it('call posts message to /invoke', async () => {
    mockApi.post.mockResolvedValue({
      data: { text: 'hello back', error: null, elapsed_s: 0.12 },
      status: 200,
      success: true,
    });

    await runSub(['call', 'agt_abc', 'summarize pricing']);

    expect(mockApi.post).toHaveBeenCalledWith(
      '/api/v1/agent-install/agt_abc/invoke',
      expect.objectContaining({ text: 'summarize pricing' }),
    );
  });

  it('uninstall calls DELETE /api/v1/agent-install/<id>', async () => {
    mockApi.delete.mockResolvedValue({
      data: { external_id: 'agt_abc', status: 'uninstalled' },
      status: 200,
      success: true,
    });

    await runSub(['uninstall', 'agt_abc', '-y']);

    expect(mockApi.delete).toHaveBeenCalledWith('/api/v1/agent-install/agt_abc');
  });

  it('adapters lists the catalog', async () => {
    mockApi.get.mockResolvedValue({
      data: { adapters: [{ kind: 'mcp', description: 'x' }, { kind: 'http', description: 'y' }] },
      status: 200,
      success: true,
    });

    await runSub(['adapters']);

    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/agent-install/adapters');
  });

  it('capabilities fetches /capabilities', async () => {
    mockApi.get.mockResolvedValue({
      data: { capabilities: [{ name: 'search', description: 'kb search', required_scopes: ['kb:read'] }] },
      status: 200,
      success: true,
    });

    await runSub(['capabilities', 'agt_abc']);
    expect(mockApi.get).toHaveBeenCalledWith('/api/v1/agent-install/agt_abc/capabilities');
  });
});
