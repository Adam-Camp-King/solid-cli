/**
 * `solid find` must say which space it searched.
 *
 * ⛔ WHY THIS EXISTS. find ranks the BACKEND verb manifest. A whole class of
 * things an agent wants are CLI-LOCAL commands that change session state and
 * are not verbs at all — switching company, logging in, pull/push. Measured
 * 2026-09-14 against the live 871-verb manifest:
 *
 *   "switch to another company"    -> switchboard.get_usage          0.20
 *   "create a new company"         -> company.create_field_schema    0.95
 *   "change the active company id" -> voice.active_calls             0.28
 *
 * Every one of those is the best answer available in the space that was
 * searched, and none is the answer. The 0.95 is the dangerous one: an agent
 * trusts it and calls a schema-definition verb expecting a new tenant.
 *
 * The ranking is not what is wrong here — the answer simply is not in the
 * corpus. What was wrong is that nothing said so. A miss that cannot announce
 * itself as a miss becomes a confident wrong turn, which is the same failure
 * shape as `how-to` answering an unmatched question with a generic topic.
 */
import { jest } from '@jest/globals';

const mockGet = jest.fn<any>();
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: mockGet, post: jest.fn(), put: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: unknown) => ({ message: (e as Error)?.message || 'Error', status: 500 })),
  failApi: jest.fn(() => { throw new Error('FAILAPI'); }),
}));

jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, companyId: 1 },
}));

const printed: any[] = [];
jest.mock('../../lib/json-output', () => ({
  ...(jest.requireActual('../../lib/json-output') as object),
  isJsonOutput: () => true,
  printJson: (payload: unknown) => { printed.push(payload); },
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { findCommand } = require('../../commands/find');

const VERBS = [
  { name: 'switchboard.get_usage', description: 'Per-line usage for one billing period.', side_effects: 'read' },
  { name: 'company.create_field_schema', description: 'Define a custom field schema on the company.', side_effects: 'write' },
  { name: 'payment.refund', description: 'Refund a captured payment.', side_effects: 'write' },
];

async function find(query: string) {
  printed.length = 0;
  (findCommand as any)._optionValues = {};
  (findCommand as any)._optionValueSources = {};
  await findCommand.parseAsync(['node', 'solid', query, '--json']);
  return printed[0];
}

beforeEach(() => {
  mockGet.mockReset();
  mockGet.mockResolvedValue({ data: { verbs: VERBS } });
});

describe('find declares the corpus it searched', () => {
  it('names the space and its size', () => {
    return find('refund a payment').then((out) => {
      expect(out.searched).toContain('backend verbs');
      expect(out.searched).toContain(String(VERBS.length));
      expect(out.searched).toContain('/api/v1/agent/verbs');
    });
  });

  it('names what is NOT in that space, and where it lives', () => {
    // The whole point: an agent that asked about switching company has to
    // learn the answer was never in here, without having to infer it from a
    // low score. `switch` scoring 0.20 against Switchboard looks like a weak
    // match, not like the wrong corpus.
    return find('switch to another company').then((out) => {
      expect(out.not_searched).toMatch(/switch/);
      expect(out.not_searched).toMatch(/company/);
      expect(out.not_searched).toContain('solid schema verbs --json');
    });
  });

  it('says it even when the top match scores high', () => {
    // ⛔ A HIGH SCORE IS NOT A GUARANTEE THE CORPUS WAS RIGHT. "create a new
    // company" hit company.create_field_schema at 0.95 on the live manifest —
    // a perfect segment match on a verb that defines custom fields. The
    // disclosure must not be conditional on a weak score, because the
    // dangerous case is precisely the confident one.
    return find('create a new company').then((out) => {
      expect(out.matches.length).toBeGreaterThan(0);
      expect(out.searched).toBeTruthy();
      expect(out.not_searched).toBeTruthy();
    });
  });

  it('points at the full command tree when nothing matched at all', () => {
    return find('zzzz qqqq wibble').then((out) => {
      expect(out.matches).toEqual([]);
      expect(out.next).toBe('solid schema verbs --json');
    });
  });
});
