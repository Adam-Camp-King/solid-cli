/**
 * Forms + verbs on the CLI — BEHAVIOURAL, not source-read.
 *
 * ⛔ WHY BEHAVIOURAL. The bug this file exists to prevent was invisible to
 * every source-read test in this repo: `solid verbs invoke` never sent
 * `confirm: true`, so the backend refused EVERY write verb with a message
 * telling the user to "use the --confirm flag" — a flag that did not exist.
 * Grepping the source for `--confirm` would now pass while the payload still
 * omitted it. So these tests run the real commander action against a mocked
 * api-client and assert what actually goes on the wire.
 */

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
  apiClient: { get: jest.fn(), post: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import { apiClient } from '../../lib/api-client';

const mockGet = apiClient.get as jest.Mock;
const mockPost = apiClient.post as jest.Mock;

/**
 * Run one subcommand as the CLI would, on a FRESH command instance.
 *
 * ⛔ THE INSTANCE MUST BE FRESH. Commander stores parsed option values on the
 * Command object, and these command objects are module singletons — so a
 * `--confirm` from one test silently leaked into the next and made a
 * "refuses without consent" test pass against a command that had consent.
 * Re-requiring per run gives each case its own parser state. (Not a product
 * bug: every real `solid` run is its own process.)
 */
async function run(which: 'forms' | 'verbs', argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => {
    cmd = which === 'forms'
      ? require('../../commands/forms').formsCommand
      : require('../../commands/verbs').verbsCommand;
  });
  const exit = jest.spyOn(process, 'exit').mockImplementation(((code?: number) => {
    throw new Error(`__exit_${code ?? 0}__`);
  }) as never);
  // A command may refuse either by calling process.exit or by setting
  // process.exitCode and returning — the second is the gentler form (stdout
  // still flushes). Both are a refusal; the harness observes both, and resets
  // the code so one test's refusal cannot fail the whole jest run.
  const before = process.exitCode;
  process.exitCode = undefined;
  try {
    await cmd.parseAsync(['node', 'solid', ...argv]);
    return { exitCode: process.exitCode ?? 0 };
  } finally {
    process.exitCode = before;
    exit.mockRestore();
  }
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('solid verbs invoke — consent has to travel', () => {
  const WRITE_VERB = {
    name: 'survey.publish',
    side_effects: 'write',
    requires_consent: true,
    http_endpoint: '/api/v1/agent/survey/publish',
  };
  const READ_VERB = {
    name: 'form.list',
    side_effects: 'read',
    requires_consent: false,
    http_endpoint: '/api/v1/agent/form/list',
  };

  it('⛔ sends confirm:true for a write verb when --confirm is given', async () => {
    mockGet.mockResolvedValue({ data: WRITE_VERB });
    mockPost.mockResolvedValue({ data: { ok: true } });

    await run('verbs', ['invoke', 'survey.publish', '-p', '{"survey_id":2}', '--confirm']);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/survey/publish', {
      survey_id: 2,
      confirm: true,
    });
  });

  it('⛔ refuses a write verb WITHOUT --confirm and never calls the backend', async () => {
    mockGet.mockResolvedValue({ data: WRITE_VERB });

    await expect(
      run('verbs', ['invoke', 'survey.publish', '-p', '{"survey_id":2}']),
    ).rejects.toThrow('__exit_1__');

    expect(mockPost).not.toHaveBeenCalled();
  });

  it('does not smuggle confirm into a read verb', async () => {
    mockGet.mockResolvedValue({ data: READ_VERB });
    mockPost.mockResolvedValue({ data: { forms: [] } });

    await run('verbs', ['invoke', 'form.list', '-p', '{"provider":"native"}']);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/form/list', { provider: 'native' });
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.confirm).toBeUndefined();
  });
});

describe('solid forms — the lifecycle goes through verbs', () => {
  it('publish calls survey.publish WITH consent', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' } });

    await run('forms', ['publish', '2']);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/survey/publish', {
      survey_id: 2,
      confirm: true,
    });
  });

  it('pause and resume are the same verb with opposite intent', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' } });

    await run('forms', ['pause', '2']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/survey/set-live', {
      survey_id: 2,
      live: false,
      confirm: true,
    });

    mockPost.mockClear();
    await run('forms', ['resume', '2']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/survey/set-live', {
      survey_id: 2,
      live: true,
      confirm: true,
    });
  });

  it('describe reads through form.describe and never sends company_id', async () => {
    mockPost.mockResolvedValue({
      data: { status: 'ok', title: 'Before the appointment', lifecycle: 'live', questions: [] },
    });

    await run('forms', ['describe', '2']);

    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/form/describe', {
      form_id: '2',
      provider: 'native',
    });
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.company_id).toBeUndefined();
  });

  it('link prints the bare public URL so it pipes', async () => {
    const url = 'https://angl.net/f/d/MS5uYXRpdmUuMg.9afdee109f0e3d9c';
    mockPost.mockResolvedValue({ data: { status: 'ok', lifecycle: 'live', public_url: url } });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});

    await run('forms', ['link', '2']);

    expect(log).toHaveBeenCalledWith(url);
  });

  it('link on a form that is not live explains itself and exits non-zero', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', lifecycle: 'draft' } });

    await expect(run('forms', ['link', '2'])).rejects.toThrow('__exit_1__');
  });

  it('⛔ hyphenates the verb but never the namespace', async () => {
    // The backend routes <ns>/<verb-with-hyphens>; namespaces like call_flow and
    // comms_workflow keep their underscores. Hyphenating the whole name 404s them.
    mockPost.mockResolvedValue({ data: { status: 'ok' } });
    await run('forms', ['pause', '2']);
    expect(mockPost.mock.calls[0][0]).toBe('/api/v1/agent/survey/set-live');
  });

  it('⛔ the verb path never carries company_id — the tenant is the session', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', forms: [] } });

    await run('forms', ['status']);

    const [endpoint, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/api/v1/agent/form/list');
    expect(body.company_id).toBeUndefined();
  });
});


describe('moments, reviews, build, walk — the rest of the product', () => {
  it('moments set wires a trigger WITH consent', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' } });
    await run('forms', ['moments', 'set', 'appointment_booked', '--form', '2']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/form/configure-trigger', {
      event: 'appointment_booked', form_id: '2', provider: 'native',
      enabled: true, confirm: true,
    });
  });

  it('moments off disables without naming a form', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' } });
    await run('forms', ['moments', 'off', 'call_ended']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/form/configure-trigger', {
      event: 'call_ended', enabled: false, confirm: true,
    });
  });

  it('reviews set is consent-gated — it rewrites where every future ask points', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok' } });
    await run('forms', ['reviews', 'set', 'google', 'https://g.page/x']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/review/set-destination', {
      platform: 'google', url: 'https://g.page/x', confirm: true,
    });
  });

  it('⛔ build NEVER sends kb_sub_code — the tenant\'s industry is theirs to resolve', async () => {
    // Sending one from the CLI would be guessing at someone\'s business, and a
    // wrong code renders another industry\'s words into their form.
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', steps: [], preview: [] } });
    await run('forms', ['build', '--intent', 'intake']);
    const [endpoint, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/api/v1/agent/playbook/suggest');
    expect(body.kb_sub_code).toBeUndefined();
    expect(body.company_id).toBeUndefined();
  });

  it('build saves nothing without --save', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', steps: [{ prompt: 'q' }], preview: [] } });
    await run('forms', ['build']);
    const endpoints = mockPost.mock.calls.map((c) => c[0]);
    expect(endpoints).toEqual(['/api/v1/agent/playbook/suggest']);
    expect(endpoints).not.toContain('/api/v1/agent/playbook/save');
  });

  it('build --save persists the draft with consent', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { status: 'ok', title: 'Intake', steps: [{ prompt: 'q' }], preview: [] } })
      .mockResolvedValueOnce({ data: { status: 'ok', playbook_id: '9' } });
    await run('forms', ['build', '--save', '--title', 'New patient intake']);
    const save = mockPost.mock.calls[1] as [string, Record<string, unknown>];
    expect(save[0]).toBe('/api/v1/agent/playbook/save');
    expect(save[1].title).toBe('New patient intake');
    expect(save[1].confirm).toBe(true);
    expect(save[1].kb_sub_code).toBeUndefined();
  });

  it('walk shows the next question and never writes', async () => {
    mockPost.mockResolvedValue({
      data: { status: 'ok', complete: false, next_question: { id: 'q1', prompt: 'Your name?', kind: 'text' } },
    });
    await run('forms', ['walk', '2']);
    expect(mockPost).toHaveBeenCalledWith('/api/v1/agent/form/next-question', {
      form_id: '2', provider: 'native',
    });
    const body = mockPost.mock.calls[0][1] as Record<string, unknown>;
    expect(body.confirm).toBeUndefined();
  });

  it('walk --answer captures on the cli channel, then reads what is next', async () => {
    mockPost
      .mockResolvedValueOnce({ data: { session_ref: 'abc123', answered_count: 1 } })
      .mockResolvedValueOnce({ data: { complete: true } });
    await run('forms', ['walk', '2', '--question', 'q1', '--answer', 'Dana']);
    const cap = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(cap[0]).toBe('/api/v1/agent/form/capture');
    expect(cap[1]).toMatchObject({ question_id: 'q1', value: 'Dana', channel: 'cli', confirm: true });
    // the session the capture minted carries into the read
    expect((mockPost.mock.calls[1][1] as Record<string, unknown>).session_ref).toBe('abc123');
  });

  it('walk --answer without --question refuses instead of guessing', async () => {
    const { exitCode } = (await run('forms', ['walk', '2', '--answer', 'Dana']))!;
    expect(exitCode).toBe(1);
    expect(mockPost).not.toHaveBeenCalled();
  });

  it('vocabulary asks for the tenant\'s own words, not a guessed industry', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', kb_sub_code: 7, terms: { customer: 'patient' } } });
    await run('forms', ['vocabulary']);
    const [endpoint, body] = mockPost.mock.calls[0] as [string, Record<string, unknown>];
    expect(endpoint).toBe('/api/v1/agent/playbook/vocabulary');
    expect(body.kb_sub_code).toBeUndefined();
  });

  it('⛔ NO command in this file ever sends company_id', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', forms: [], triggers: [], destinations: [], terms: {} } });
    mockGet.mockResolvedValue({ data: { connected: [] } });
    for (const argv of [
      ['status'], ['describe', '2'], ['responses', '2'], ['vocabulary'],
      ['moments', 'list'], ['reviews', 'list'], ['walk', '2'],
    ]) {
      mockPost.mockClear();
      await run('forms', argv);
      for (const call of mockPost.mock.calls) {
        expect((call[1] as Record<string, unknown>).company_id).toBeUndefined();
      }
    }
  });
});

describe('embed — the door, not the legacy link', () => {
  const URL = 'https://angl.net/f/d/MS5uYXRpdmUuMg.9afdee109f0e3d9c';

  it('builds an iframe around the standing door', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', lifecycle: 'live', public_url: URL } });
    const log = jest.spyOn(console, 'log').mockImplementation(() => {});
    await run('forms', ['embed', '2']);
    expect(mockPost.mock.calls[0][0]).toBe('/api/v1/agent/form/describe');
    const html = log.mock.calls.map((c) => String(c[0])).join('\n');
    expect(html).toContain('<iframe');
    expect(html).toContain(URL);
  });

  it('⛔ never reaches the legacy /api/v1/surveys embed endpoint', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', lifecycle: 'live', public_url: URL } });
    await run('forms', ['embed', '2']);
    for (const call of [...mockGet.mock.calls, ...mockPost.mock.calls]) {
      expect(String(call[0])).not.toContain('/api/v1/surveys');
    }
  });

  it('--as link and --as button both point at the door', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', lifecycle: 'live', public_url: URL } });
    for (const kind of ['link', 'button']) {
      const log = jest.spyOn(console, 'log').mockImplementation(() => {});
      await run('forms', ['embed', '2', '--as', kind]);
      expect(log.mock.calls.map((c) => String(c[0])).join('')).toContain(URL);
      log.mockRestore();
    }
  });

  it('refuses to embed a form that cannot answer', async () => {
    mockPost.mockResolvedValue({ data: { status: 'ok', title: 'Intake', lifecycle: 'draft' } });
    const { exitCode } = (await run('forms', ['embed', '2']))!;
    expect(exitCode).toBe(1);
  });
});
