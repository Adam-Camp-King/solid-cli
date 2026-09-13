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

  it('lets a DRY RUN through without --confirm, and sends nothing at all', async () => {
    // Demanding consent to preview a write makes the sandbox useless for the
    // one thing it is for.
    //
    // Stronger than it was: before 2.3 this asserted the request WAS made and
    // relied on the dry-run interceptor to swallow it. Now validation happens
    // locally against input_schema and the preview is built without any call,
    // so "nothing left the process" is a property of this code rather than of
    // an interceptor somewhere else.
    const printed: string[] = [];
    (console.log as jest.Mock).mockImplementation((v?: unknown) => {
      printed.push(String(v));
    });

    mockGet.mockResolvedValue(writeVerb());
    mockIsDryRun.mockReturnValue(true);

    await invoke('contact.create', ['-p', '{"name":"Probe"}']);

    expect(mockPost).not.toHaveBeenCalled();
    const out = JSON.parse(printed.join(''));
    expect(out.dry_run).toBe(true);
    expect(out.valid).toBe(true);
    expect(out.would.url).toBe('/api/v1/agent/contact/create');
    // 1.5: a preview never claims success.
    expect(out.success).toBeUndefined();
  });

  it('a dry run with a bad payload is invalid and exits 1', async () => {
    mockGet.mockResolvedValue(
      verb({
        name: 'thing.do',
        side_effects: 'write',
        transport: 'http',
        http_endpoint: '/api/v1/agent/thing/do',
        input_schema: {
          type: 'object',
          properties: { company_id: { type: 'integer' }, ref: { type: 'string' } },
          required: ['company_id', 'ref'],
        },
      }),
    );
    mockIsDryRun.mockReturnValue(true);

    const exit = jest.spyOn(process, 'exit').mockImplementation(((): never => {
      throw new Error('EXIT1');
    }) as never);

    await expect(invoke('thing.do', ['-p', '{}'])).rejects.toThrow('EXIT1');
    expect(mockPost).not.toHaveBeenCalled();
    exit.mockRestore();
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

describe('verbs list — tiered output (VNP 2.2)', () => {
  const manifest = {
    count: 3,
    total_registered: 845,
    filtered_by: { surface: null, shape: null, tier: null },
    verbs: [
      {
        name: 'payment.refund',
        description: 'x'.repeat(400),
        side_effects: 'write',
        shape: 'receipt',
        input_schema: { type: 'object', properties: { a: {}, b: {}, c: {} } },
      },
      {
        name: 'contact.create',
        description: 'Create a contact.',
        side_effects: 'write',
        shape: 'transaction',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'books.summary',
        description: 'Money in and out.',
        side_effects: 'read',
        shape: 'aggregate',
        input_schema: { type: 'object', properties: {} },
      },
    ],
  };

  let printed: string;
  beforeEach(() => {
    jest.clearAllMocks();
    printed = '';
    jest.spyOn(console, 'log').mockImplementation((s?: unknown) => { printed += String(s); });
    mockGet.mockResolvedValue({ data: manifest });
  });
  afterEach(() => jest.restoreAllMocks());

  function list(extra: string[]) {
    resetOptions();
    return verbsCommand.parseAsync(['list', '--json', ...extra], { from: 'user' });
  }

  it('defaults to the index — no input_schema anywhere', async () => {
    await list([]);
    const out = JSON.parse(printed);
    expect(out.schema).toBe('solid:agent-verb-index/v1');
    expect(printed).not.toContain('input_schema');
    expect(out.verbs[0]).toEqual(['payment.refund', expect.any(String), 'write']);
  });

  it('documents its own row shape, since rows are positional', async () => {
    await list([]);
    expect(JSON.parse(printed).row).toEqual(['name', 'description', 'side_effects']);
  });

  it('clips descriptions to the index budget', async () => {
    await list([]);
    const [, desc] = JSON.parse(printed).verbs[0];
    expect(desc.length).toBeLessThanOrEqual(91); // 90 + the ellipsis
  });

  it('--full still returns whole records, because codegen needs them', async () => {
    await list(['--full']);
    const out = JSON.parse(printed);
    expect(out.verbs[0].input_schema).toBeDefined();
    expect(out.verbs[0].description).toHaveLength(400);
  });

  it('--names-only returns names and nothing else', async () => {
    await list(['--names-only']);
    const out = JSON.parse(printed);
    expect(out.names).toEqual(['payment.refund', 'contact.create', 'books.summary']);
    expect(out.verbs).toBeUndefined();
  });

  it('--limit caps rows and says there are more', async () => {
    await list(['-n', '2']);
    const out = JSON.parse(printed);
    expect(out.verbs).toHaveLength(2);
    expect(out.has_more).toBe(true);
    expect(out.total).toBe(845);
  });

  it('has_more is false when everything fits', async () => {
    await list([]);
    expect(JSON.parse(printed).has_more).toBe(false);
  });
});

describe('verbs invoke — the canonical twin (VNP 3.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockPost.mockResolvedValue({ data: { ok: true } });
    mockIsDryRun.mockReturnValue(false);
  });
  afterEach(() => jest.restoreAllMocks());

  it('surfaces same_as in a dry run, where an agent can act on it', async () => {
    const printed: string[] = [];
    (console.log as jest.Mock).mockImplementation((v?: unknown) => { printed.push(String(v)); });
    mockIsDryRun.mockReturnValue(true);
    mockGet.mockResolvedValue(
      verb({
        name: 'blog_publish',
        transport: 'dispatch',
        dispatch_endpoint: '/api/v1/ada/cli-dispatch',
        same_as: 'blog.publish',
        input_schema: { type: 'object', properties: { blog_post_id: { type: 'integer' } } },
      }),
    );

    await invoke('blog_publish', ['-p', '{"blog_post_id":1}']);

    const out = JSON.parse(printed.join(''));
    expect(out.same_as).toBe('blog.publish');
  });

  it('says nothing when a verb is canonical', async () => {
    const printed: string[] = [];
    (console.log as jest.Mock).mockImplementation((v?: unknown) => { printed.push(String(v)); });
    mockIsDryRun.mockReturnValue(true);
    mockGet.mockResolvedValue(
      verb({ name: 'blog.publish', transport: 'http', http_endpoint: '/api/v1/agent/blog/publish' }),
    );

    await invoke('blog.publish');

    expect(JSON.parse(printed.join('')).same_as).toBeUndefined();
  });

  it('does not call the twin deprecated, because it is not', async () => {
    // Both halves are live. Labelling one deprecated would be a false claim of
    // exactly the kind this sprint exists to remove.
    const errs: string[] = [];
    (console.error as jest.Mock).mockImplementation((v?: unknown) => { errs.push(String(v)); });
    mockGet.mockResolvedValue(
      verb({
        name: 'blog_publish',
        transport: 'dispatch',
        dispatch_endpoint: '/api/v1/ada/cli-dispatch',
        same_as: 'blog.publish',
      }),
    );

    await invoke('blog_publish');

    const note = errs.join(' ');
    expect(note).toContain('blog.publish');
    expect(note.toLowerCase()).not.toContain('deprecat');
    // And it must warn that the arguments do not carry over.
    expect(note).toMatch(/argument shape|own schema/);
  });
});
