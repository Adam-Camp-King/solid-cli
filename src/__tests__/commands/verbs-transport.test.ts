/**
 * `solid verbs invoke` must route by the verb's declared transport.
 *
 * Sprint VNP Phase 0.2. Every verb used to be POSTed at its `http_endpoint`,
 * and for 272 of 845 that route has never existed — the agent-verb router ends
 * in a catch-all needing two path segments, so a flat snake_case name matched
 * nothing and 404'd. Those verbs were never broken: they live in ADA's registry
 * and answer on `POST /api/v1/agent/cli-dispatch`. But a 404 reads as "this
 * does not exist", which is how a third of the registry got written off as
 * phantom.
 *
 * The manifest now declares `transport` and `dispatch_endpoint`, so invoke
 * reads the answer instead of assuming one.
 *
 * The backward-compatibility case is not optional. The backend change is
 * committed but NOT deployed, so production still serves records with no
 * `transport` field. If the CLI required it, every invoke would break the
 * moment this ships and before the backend does.
 */
import { jest } from '@jest/globals';

const mockGet = jest.fn<any>();
const mockPost = jest.fn<any>();

jest.mock('../../lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: unknown) => ({
    message: (e as Error)?.message || 'Error',
    status: 500,
  })),
  failApi: jest.fn(() => {
    throw new Error('FAILAPI');
  }),
}));

jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, companyId: 1 },
}));

const mockIsDryRun = jest.fn<() => boolean>(() => false);
jest.mock('../../lib/dry-run', () => ({
  ...(jest.requireActual('../../lib/dry-run') as object),
  isDryRun: () => mockIsDryRun(),
}));

const mockEmitErrorAndExit = jest.fn<(...a: any[]) => never>(() => {
  throw new Error('EMIT_ERROR');
});
jest.mock('../../lib/command-kit', () => ({
  ...(jest.requireActual('../../lib/command-kit') as object),
  emitErrorAndExit: (...a: unknown[]) => (mockEmitErrorAndExit as any)(...a),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { verbsCommand } = require('../../commands/verbs');

/**
 * Commander commands are singletons and parseAsync MERGES into whatever option
 * values are already on them. Without this reset, `--confirm` from one test
 * silently stays set for every later one — which made a "blocks without
 * --confirm" test pass a write straight through. Clear before each parse.
 */
function resetOptions(): void {
  for (const sub of verbsCommand.commands) {
    (sub as any)._optionValues = {};
    (sub as any)._optionValueSources = {};
  }
}

function invoke(name: string, extra: string[] = []) {
  resetOptions();
  return verbsCommand.parseAsync(['invoke', name, ...extra], { from: 'user' });
}

function verb(over: Record<string, unknown>) {
  return {
    data: {
      name: 'x',
      description: 'd',
      shape: 'discovery',
      side_effects: 'read',
      surfaces: ['http'],
      requires_consent: false,
      tier_floor: 'starter',
      input_schema: { type: 'object', properties: {} },
      http_endpoint: null,
      ...over,
    },
  };
}

describe('verbs invoke — transport routing', () => {
  let logSpy: jest.SpiedFunction<typeof console.log>;

  beforeEach(() => {
    jest.clearAllMocks();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPost.mockResolvedValue({ data: { ok: true } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('sends a dispatch verb to cli-dispatch, with the name in the body', async () => {
    mockGet.mockResolvedValue(
      verb({
        name: 'ai_employees_list',
        transport: 'dispatch',
        dispatch_endpoint: '/api/v1/agent/cli-dispatch',
        http_endpoint: null,
      }),
    );

    await invoke('ai_employees_list');

    expect(mockPost).toHaveBeenCalledTimes(1);
    const [url, body] = mockPost.mock.calls[0] as [string, any];
    expect(url).toBe('/api/v1/agent/cli-dispatch');
    expect(body.verb).toBe('ai_employees_list');
    expect(body.args).toEqual({});
  });

  it('sends an http verb to its own route, not to cli-dispatch', async () => {
    mockGet.mockResolvedValue(
      verb({
        name: 'advocacy.next_step',
        transport: 'http',
        http_endpoint: '/api/v1/agent/advocacy/next-step',
      }),
    );

    await invoke('advocacy.next_step');

    const [url] = mockPost.mock.calls[0] as [string, any];
    expect(url).toBe('/api/v1/agent/advocacy/next-step');
  });

  it('keeps working against a backend that does not send transport yet', async () => {
    // Production today. No `transport` key at all — infer from http_endpoint.
    mockGet.mockResolvedValue(
      verb({ name: 'legacy.verb', http_endpoint: '/api/v1/agent/legacy/verb' }),
    );

    await invoke('legacy.verb');

    const [url] = mockPost.mock.calls[0] as [string, any];
    expect(url).toBe('/api/v1/agent/legacy/verb');
  });

  it('carries consent as a sibling of args, never inside them', async () => {
    // `confirm` inside `args` would reach the verb as an argument it never
    // declared, which is a TypeError at the far end rather than consent.
    mockGet.mockResolvedValue(
      verb({
        name: 'sms_send',
        side_effects: 'write',
        transport: 'dispatch',
        dispatch_endpoint: '/api/v1/agent/cli-dispatch',
      }),
    );

    await invoke('sms_send', ['--confirm', '-p', '{"to":"+1555"}']);

    const [, body] = mockPost.mock.calls[0] as [string, any];
    expect(body.confirm).toBe(true);
    expect(body.args).toEqual({ to: '+1555' });
    expect(body.args.confirm).toBeUndefined();
  });

  it('refuses a transport it cannot speak, naming it, instead of a bare 404', async () => {
    mockGet.mockResolvedValue(
      verb({ name: 'mcp_only_tool', transport: 'mcp', http_endpoint: null }),
    );

    await expect(invoke('mcp_only_tool')).rejects.toThrow('EMIT_ERROR');

    expect(mockPost).not.toHaveBeenCalled();
    const arg = (mockEmitErrorAndExit.mock.calls[0] as any[])[0];
    expect(arg.response.data.code).toBe('WRONG_TRANSPORT');
    expect(arg.response.data.detail).toContain('mcp');
    expect(arg.response.status).toBe(400);
  });
});

describe('verbs invoke — the consent gate (VNP 1.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPost.mockResolvedValue({ data: { ok: true } });
    mockIsDryRun.mockReturnValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  const writeVerb = () =>
    verb({
      name: 'contact.create',
      side_effects: 'write',
      transport: 'http',
      http_endpoint: '/api/v1/agent/contact/create',
    });

  it('still blocks a real write with no --confirm', () => {
    mockGet.mockResolvedValue(writeVerb());
    mockIsDryRun.mockReturnValue(false);

    const exit = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('EXIT');
    }) as never);

    return expect(invoke('contact.create')).rejects.toThrow('EXIT').then(() => {
      expect(mockPost).not.toHaveBeenCalled();
      exit.mockRestore();
    });
  });

  it('lets a DRY RUN through without --confirm', async () => {
    // A dry run cannot mutate — the interceptor short-circuits every mutation
    // before it leaves the process. Demanding consent to preview a write makes
    // the sandbox useless for the one thing it is for.
    mockGet.mockResolvedValue(writeVerb());
    mockIsDryRun.mockReturnValue(true);

    await invoke('contact.create');

    expect(mockPost).toHaveBeenCalledTimes(1);
  });
});

describe('verbs list — filters reach the backend (VNP 1.4)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    mockGet.mockResolvedValue({ data: { count: 0, verbs: [], filtered_by: {} } });
  });
  afterEach(() => jest.restoreAllMocks());

  function list(extra: string[]) {
    resetOptions();
    return verbsCommand.parseAsync(['list', ...extra], { from: 'user' });
  }

  it('forwards --tier, which the backend has always accepted', async () => {
    // The backend has taken ?tier= since Phase 8 and echoes it in
    // `filtered_by` on every response, but the flag did not exist here — so an
    // agent reading the envelope to learn its options was told about one that
    // errors. Live check: starter 843, professional 845.
    await list(['--tier', 'starter', '--json']);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.params.tier).toBe('starter');
  });

  it('forwards --surface and --shape too', async () => {
    await list(['--surface', 'webmcp', '--shape', 'preview', '--json']);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.params.surface).toBe('webmcp');
    expect(cfg.params.shape).toBe('preview');
  });

  it('sends no filter params when none are given', async () => {
    await list(['--json']);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.params).toEqual({});
  });
});
