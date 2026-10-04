/**
 * `solid find` carries the server's whole answer — how sure it is, and "no verb".
 *
 * ⛔ WHY THIS EXISTS. `agent.verbs.search` publishes a confidence measured on
 * held-out prompts and, since the judged second stage (2026-10-04), can answer
 * that NO verb does a request. find kept only `matches`: the confidence never
 * reached the agent, and an empty `matches` was treated as a failed call, so
 * find ranked the manifest locally and printed five guesses in place of the
 * server's "there is no verb for this".
 */
import { jest } from '@jest/globals';

import { readSearchAnswer } from '../../lib/find-answer';

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

const LOCAL = [
  { name: 'staff.time_off', description: 'Record time off for a staff member.', side_effects: 'write' },
  { name: 'payment.refund', description: 'Refund a captured payment.', side_effects: 'write' },
];
const MATCH = { name: 'payment.refund', score: 0.61, description: 'Refund a captured payment.', side_effects: 'write' };
const LIKELY = { level: 'likely', next_step: 'Read its description and gates before calling it.', calibration: { top1: 0.82 } };
const NO_VERB = {
  query: 'run payroll', ranked_by: 'hybrid', judged: { fit: 'no', by: 'anthropic_fast' },
  confidence: { level: 'no_verb', next_step: 'None of the 40 closest actions does this.' },
  matches: [],
  closest: [{ name: 'staff.time_off', description: 'Record time off for a staff member.' }],
  gap: { recorded: true, report_id: 7 },
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
  mockGet.mockResolvedValue({ data: { verbs: LOCAL } });
});

describe('readSearchAnswer', () => {
  it('reads matches, confidence and the judgement', () => {
    const a = readSearchAnswer({ result: { ranked_by: 'hybrid', judged: { fit: 'yes', by: 'x' }, confidence: LIKELY, matches: [MATCH] } });
    expect(a.state).toBe('matches');
    expect(a.matches).toEqual([MATCH]);
    expect(a.confidence).toEqual(LIKELY);
    expect(a.judged).toEqual({ fit: 'yes', by: 'x' });
  });

  it('reads the unwrapped shape too', () => {
    expect(readSearchAnswer({ ranked_by: 'lexical', matches: [MATCH] }).state).toBe('matches');
  });

  it('believes "no verb" only when the server said exactly that', () => {
    expect(readSearchAnswer({ result: NO_VERB }).state).toBe('no_verb');
    expect(readSearchAnswer({ result: NO_VERB }).closest).toEqual(NO_VERB.closest);
    expect(readSearchAnswer({ result: NO_VERB }).gap).toEqual(NO_VERB.gap);
    // An empty list with any other level is no answer at all.
    expect(readSearchAnswer({ result: { matches: [], confidence: { level: 'none' } } }).state).toBe('unusable');
    expect(readSearchAnswer({ result: { matches: [] } }).state).toBe('unusable');
  });

  it.each([null, undefined, 'x', [], { ok: false, result: { matches: [MATCH] } }, { result: { matches: 'nope' } }])(
    'treats %p as unusable',
    (data) => { expect(readSearchAnswer(data).state).toBe('unusable'); },
  );

  it('drops a match with no name instead of printing it', () => {
    const a = readSearchAnswer({ result: { matches: [{ score: 1 }, MATCH] } });
    expect(a.matches).toEqual([MATCH]);
  });
});

describe('solid find', () => {
  it('passes the server confidence through', async () => {
    mockPost.mockResolvedValue({ data: { result: { ranked_by: 'hybrid', judged: { fit: 'yes', by: 'x' }, confidence: LIKELY, matches: [MATCH] } } });
    const out = await find('refund a payment');
    expect(out.matches[0][0]).toBe('payment.refund');
    expect(out.confidence).toEqual({ level: 'likely', next_step: LIKELY.next_step });
    expect(out.ranked_by).toBe('hybrid, then judged');
    expect(out.next).toBe('solid verbs describe payment.refund');
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('says "no verb" and does NOT fall back to local guesses', async () => {
    mockPost.mockResolvedValue({ data: { result: NO_VERB } });
    const out = await find('run payroll for my staff');
    expect(out.no_verb).toBe(true);
    expect(out.matches).toEqual([]);
    expect(out.confidence.level).toBe('no_verb');
    expect(out.closest[0][0]).toBe('staff.time_off');
    expect(out.gap).toEqual({ recorded: true, report_id: 7 });
    expect(out.next).toContain('No verb does this');
    // The whole point: the manifest is not fetched and ranked to replace the answer.
    expect(mockGet).not.toHaveBeenCalled();
  });

  it('still ranks locally when the server gave no answer', async () => {
    mockPost.mockRejectedValue(new Error('offline'));
    const out = await find('refund a payment');
    expect(mockGet).toHaveBeenCalled();
    expect(out.matches[0][0]).toBe('payment.refund');
    expect(out.ranked_by).toBe('lexical (local)');
    expect(out.confidence).toBeUndefined();
    expect(out.no_verb).toBeUndefined();
  });

  it('ranks locally when an older backend answers with an empty list and no verdict', async () => {
    mockPost.mockResolvedValue({ data: { result: { ranked_by: 'hybrid', matches: [] } } });
    const out = await find('refund a payment');
    expect(mockGet).toHaveBeenCalled();
    expect(out.no_verb).toBeUndefined();
  });
});
