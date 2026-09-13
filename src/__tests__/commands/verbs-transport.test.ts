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
        coordinate: '53',
        input_schema: { type: 'object', properties: { a: {}, b: {}, c: {} } },
      },
      {
        name: 'contact.create',
        description: 'Create a contact.',
        side_effects: 'write',
        shape: 'transaction',
        coordinate: '30',
        input_schema: { type: 'object', properties: {} },
      },
      {
        name: 'books.summary',
        description: 'Money in and out.',
        side_effects: 'read',
        shape: 'aggregate',
        coordinate: '59',
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
    expect(out.verbs).toHaveLength(3);   // unfiltered: the codegen path
  });

  // ⛔ --full used to print the untouched manifest whenever --limit was absent,
  // so every filter was silently discarded on this one output tier:
  // `verbs list 5 --full` returned all 845. The index tier filtered correctly,
  // which is why it went unnoticed — the tests exercised the tier that worked.
  it('--full honours the Atlas prefix', async () => {
    await list(['5', '--full']);
    const out = JSON.parse(printed);
    expect(out.verbs.map((v: any) => v.name)).toEqual(['payment.refund', 'books.summary']);
    expect(out.count).toBe(2);
    expect(out.verbs[0].input_schema).toBeDefined();  // still full records
  });

  it('--full honours a facet filter', async () => {
    await list(['--full', '--writes']);
    const out = JSON.parse(printed);
    expect(out.verbs.map((v: any) => v.name)).toEqual(['payment.refund', 'contact.create']);
  });

  it('the prefix narrows on every tier identically', async () => {
    // `printed` accumulates, so it has to be cleared between calls — otherwise
    // the second parse reads two concatenated payloads and the test fails for
    // a reason that has nothing to do with the filter.
    const listOnce = async (args: string[]) => { printed = ''; await list(args); return JSON.parse(printed); };

    const index = (await listOnce(['53'])).verbs.map((r: any) => r[0]);
    const full = (await listOnce(['53', '--full'])).verbs.map((v: any) => v.name);
    const names = (await listOnce(['53', '--names-only'])).names;
    // Three tiers, one answer. A filter that disagrees with itself by output
    // format is the defect, not the count.
    expect(index).toEqual(['payment.refund']);
    expect(full).toEqual(index);
    expect(names).toEqual(index);
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

describe('verbs list — conditional fetch (VNP 4.2)', () => {
  const manifest = {
    count: 1,
    total_registered: 845,
    etag: 'W/"deadbeefdeadbeefdead"',
    filtered_by: { surface: null, shape: null, tier: null },
    verbs: [{ name: 'a.b', description: 'x', side_effects: 'read', shape: 'aggregate', coordinate: '10' }],
  };

  let printed: string;
  beforeEach(() => {
    jest.clearAllMocks();
    printed = '';
    jest.spyOn(console, 'log').mockImplementation((s?: unknown) => { printed += String(s); });
  });
  afterEach(() => jest.restoreAllMocks());

  const list = (extra: string[]) => { resetOptions(); return verbsCommand.parseAsync(['list', '--json', ...extra], { from: 'user' }); };

  it('publishes the etag on the index tier, not only on --full', async () => {
    // An agent that never fetches full records still needs to know whether
    // what it holds is current.
    mockGet.mockResolvedValue({ status: 200, data: manifest });
    await list([]);
    expect(JSON.parse(printed).etag).toBe('W/"deadbeefdeadbeefdead"');
  });

  it('--since sends If-None-Match', async () => {
    mockGet.mockResolvedValue({ status: 200, data: manifest });
    await list(['--since', 'W/"abc"']);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.headers['If-None-Match']).toBe('W/"abc"');
  });

  it('a 304 is a cheap success, not a thrown error', async () => {
    // ⛔ axios rejects any status outside 2xx by default, so without an
    // explicit validateStatus the cheap answer arrives as an exception and
    // reads as a failure — the feature working and looking broken.
    mockGet.mockResolvedValue({ status: 304, data: '' });
    await list(['--since', 'W/"abc"']);
    const out = JSON.parse(printed);
    expect(out.unchanged).toBe(true);
    expect(out.etag).toBe('W/"abc"');
    expect(out.verbs).toBeUndefined();
    // The whole point is the size of this answer.
    expect(printed.length).toBeLessThan(120);
  });

  it('accepts 304 through validateStatus, and still rejects a real failure', async () => {
    mockGet.mockResolvedValue({ status: 200, data: manifest });
    await list(['--since', 'W/"abc"']);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.validateStatus(304)).toBe(true);
    expect(cfg.validateStatus(200)).toBe(true);
    expect(cfg.validateStatus(404)).toBe(false);
    expect(cfg.validateStatus(500)).toBe(false);
  });

  it('sends no conditional header when --since is absent', async () => {
    mockGet.mockResolvedValue({ status: 200, data: manifest });
    await list([]);
    const [, cfg] = mockGet.mock.calls[0] as [string, any];
    expect(cfg.headers).toBeUndefined();
  });

  it('works against a backend that does not send an etag yet', async () => {
    // The backend change is committed and not deployed. If the CLI required
    // the field, every list would break the moment this ships and before the
    // backend does — the same trap 0.2 already walked into once.
    const { etag, ...noEtag } = manifest;
    mockGet.mockResolvedValue({ status: 200, data: noEtag });
    await list([]);
    const out = JSON.parse(printed);
    expect(out.count).toBe(1);
    expect('etag' in out).toBe(false);
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

describe('verbs list — facet filters (VNP 3.5)', () => {
  const manifest = {
    count: 4, total_registered: 845,
    filtered_by: { surface: null, shape: null, tier: null },
    verbs: [
      { name: 'payment.refund', description: 'r', side_effects: 'write', requires_consent: true, coordinate: '52' },
      { name: 'payment.full_history', description: 'r', side_effects: 'read', requires_consent: false, coordinate: '52' },
      { name: 'contact.create', description: 'c', side_effects: 'write', requires_consent: false, coordinate: '35' },
      { name: 'books.summary', description: 'b', side_effects: 'read', requires_consent: false, coordinate: '57' },
    ],
  };
  let printed: string;
  beforeEach(() => {
    jest.clearAllMocks(); printed = '';
    jest.spyOn(console, 'log').mockImplementation((v?: unknown) => { printed += String(v); });
    jest.spyOn(console, 'error').mockImplementation(() => {});
    mockGet.mockResolvedValue({ data: manifest });
  });
  afterEach(() => jest.restoreAllMocks());

  const list = (extra: string[]) => { resetOptions(); return verbsCommand.parseAsync(['list', '--json', ...extra], { from: 'user' }); };
  const names = () => JSON.parse(printed).verbs.map((r: unknown[]) => r[0]);

  it('--writes keeps only mutating verbs', async () => {
    await list(['--writes']);
    expect(names()).toEqual(['payment.refund', 'contact.create']);
  });

  it('--reads keeps only non-mutating verbs', async () => {
    await list(['--reads']);
    expect(names()).toEqual(['payment.full_history', 'books.summary']);
  });

  it('--no-consent drops the ones that need consent', async () => {
    await list(['--no-consent']);
    expect(names()).not.toContain('payment.refund');
  });

  it('a prefix composes with a facet', async () => {
    // "everything readable about money" — the query VNP names as the payoff.
    await list(['5', '--reads']);
    expect(names()).toEqual(['payment.full_history', 'books.summary']);
  });

  it('--writes and --reads together is an error, not an empty list', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('EXIT'); }) as never);
    await expect(list(['--writes', '--reads'])).rejects.toThrow();
    exit.mockRestore();
  });

  it('a malformed prefix is rejected rather than matching nothing', async () => {
    const exit = jest.spyOn(process, 'exit').mockImplementation(((): never => { throw new Error('EXIT'); }) as never);
    await expect(list(['abc'])).rejects.toThrow();
    exit.mockRestore();
  });
});
