/**
 * `solid find` — a request that is not ONE verb is not a "no".
 *
 * ⛔ WHY THIS EXISTS. On 2026-10-04 a customer's AI ran
 * `solid find "create an app that uses Solid# business verbs and entities"` and
 * was told there is no verb for it. True — and it left the AI to read the whole
 * catalog. The server now answers a request to BUILD something with the path
 * (the business and its AI build; Solid# is what it connects to), and a request
 * too vague to route with the questions to settle. Both arrive as `answer`,
 * written to the AI that asked, and find must carry them whole: no local five
 * guesses in their place, no clipping.
 */
import { jest } from '@jest/globals';

import { readSearchAnswer, readRequestAnswer } from '../../lib/find-answer';

const mockGet = jest.fn<any>();
const mockPost = jest.fn<any>();
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: mockGet, post: mockPost, put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: unknown) => ({ message: (e as Error)?.message || 'Error', status: 500 })),
  failApi: jest.fn(() => { throw new Error('FAILAPI'); }),
}));
jest.mock('../../lib/config', () => ({ config: { isLoggedIn: () => true, companyId: 1 } }));

const printed: any[] = [];
jest.mock('../../lib/json-output', () => ({
  ...(jest.requireActual('../../lib/json-output') as object),
  isJsonOutput: () => true,
  printJson: (payload: unknown) => { printed.push(payload); },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findCommand } = require('../../commands/find');

const INSTRUCTIONS = 'Open with encouragement. You build this. Work through `path.steps` in order.';
const BUILD = {
  query: 'create an app', ranked_by: 'hybrid', judged: { kind: 'build', fit: 'no', by: 'anthropic_fast' },
  confidence: { level: 'build', next_step: INSTRUCTIONS },
  matches: [
    { name: 'design.intake', score: 0.2, description: 'The front door.', side_effects: 'read' },
    { name: 'app.publish', score: 0.2, description: 'Put a built app live.', side_effects: 'write' },
  ],
  answer: {
    kind: 'build', say: "That's a great idea — and very doable.", instructions: INSTRUCTIONS,
    path: {
      key: 'app', what: 'An interactive app or tool.', who_builds: 'You build this — the business and its AI.',
      how_it_connects: 'Every action is callable from your own code.',
      steps: [
        { step: 1, do: "Call the front door with bringing='app'.", verb: 'design.intake', args: { bringing: 'app' } },
        { step: 2, do: 'Build it. This step is yours. ' + 'x'.repeat(200), yours: true },
        { step: 3, do: 'Publish the BUILT folder.', verb: 'app.publish' },
      ],
    },
  },
};
const ASK = {
  query: 'update it', ranked_by: 'hybrid', judged: { kind: 'ask', fit: 'no', by: 'anthropic_fast' },
  confidence: { level: 'ask', next_step: 'Settle `ask` first.' },
  matches: [],
  closest: [{ name: 'page.update', description: 'Update a page.' }],
  answer: { kind: 'ask', say: "Love it — let's get it right.", instructions: 'Settle `ask` first.', ask: ['Update what?'] },
};

async function find(query: string) {
  printed.length = 0;
  (findCommand as any)._optionValues = {};
  (findCommand as any)._optionValueSources = {};
  await findCommand.parseAsync(['node', 'solid', query, '--json']);
  return printed[0];
}

beforeEach(() => {
  mockGet.mockReset();
  mockPost.mockReset();
  mockGet.mockResolvedValue({ data: { verbs: [{ name: 'staff.time_off', description: 'Time off.', side_effects: 'write' }] } });
});

describe('reading the answer', () => {
  it('reads a build with its whole path', () => {
    const a = readSearchAnswer({ ok: true, verb: 'agent.verbs.search', result: BUILD });
    expect(a.state).toBe('build');
    expect(a.answer!.path!.steps.map((s) => s.verb ?? 'yours')).toEqual(['design.intake', 'yours', 'app.publish']);
    expect(a.answer!.path!.steps[0].args).toEqual({ bringing: 'app' });
    expect(a.matches[0].name).toBe('design.intake');
  });

  it('reads a vague request as questions, with no matches to take', () => {
    const a = readSearchAnswer(ASK);
    expect(a.state).toBe('ask');
    expect(a.matches).toEqual([]);
    expect(a.answer!.ask).toEqual(['Update what?']);
  });

  it('believes a build or an ask only when the whole answer came with it', () => {
    expect(readSearchAnswer({ ...BUILD, answer: undefined }).state).toBe('matches');
    expect(readSearchAnswer({ ...BUILD, answer: { ...BUILD.answer, path: { steps: [] } } }).state).toBe('matches');
    expect(readSearchAnswer({ ...ASK, answer: { ...ASK.answer, ask: [] } }).state).toBe('unusable');
    expect(readRequestAnswer({ kind: 'do', instructions: 'x' })).toBeNull();
    expect(readRequestAnswer({ kind: 'build', say: 'x' })).toBeNull();
  });
});

describe('solid find --json', () => {
  it('hands a build to the caller as a path, not as "no verb"', async () => {
    mockPost.mockResolvedValue({ data: { ok: true, verb: 'agent.verbs.search', result: BUILD } });
    const out = await find('create an app that uses Solid# business verbs and entities');
    expect(out.no_verb).toBeUndefined();
    expect(out.confidence.level).toBe('build');
    expect(out.answer.path.who_builds).toContain('You build this');
    expect(out.answer.path.steps[1].do.length).toBeGreaterThan(200);   // instructions are never clipped
    expect(out.answer.instructions).toBe(INSTRUCTIONS);
    expect(out.next).toContain('answer.path.steps');
    expect(out.next).toContain('design.intake');
    expect(out.matches[0][0]).toBe('design.intake');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('hands a vague request back as questions and does not guess locally', async () => {
    mockPost.mockResolvedValue({ data: { ok: true, verb: 'agent.verbs.search', result: ASK } });
    const out = await find('update it');
    expect(out.matches).toEqual([]);
    expect(out.answer.ask).toEqual(['Update what?']);
    expect(out.next).toContain('answer.ask');
    expect(mockGet).not.toHaveBeenCalled();
  });
});
