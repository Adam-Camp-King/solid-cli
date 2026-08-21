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
  try {
    await cmd.parseAsync(['node', 'solid', ...argv]);
  } finally {
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
