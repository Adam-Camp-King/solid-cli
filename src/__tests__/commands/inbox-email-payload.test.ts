/**
 * `solid inbox email send` posted { to, body } and `reply` posted { body } —
 * the route takes a full EmailSendRequest (to_email, subject, text_content),
 * so both were rejected with 422 on every call.
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
    warn: jest.fn().mockReturnThis(),
  }),
}));
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

async function run(args: string[]) {
  const { Command } = require('commander');
  let inbox: any;
  jest.isolateModules(() => { inbox = require('../../commands/inbox').inboxCommand; });
  const program = new Command('solid').exitOverride();
  program.addCommand(inbox);
  const log = jest.spyOn(console, 'log').mockImplementation(() => {});
  try { await program.parseAsync(['node', 'solid', ...args]); } finally { log.mockRestore(); }
}

beforeEach(() => { mockGet.mockReset(); mockPost.mockReset(); mockPost.mockResolvedValue({ data: {} }); });

test('send posts the fields the route declares', async () => {
  await run(['inbox', 'email', 'send', '--to', 'pat@x.com', '--subject', 'Hi', '--body', 'Hello']);
  expect(mockPost).toHaveBeenCalledWith('/api/v1/crm/emails/send',
    { to_email: 'pat@x.com', subject: 'Hi', text_content: 'Hello' });
});

test('reply addresses the sender of an inbound original, threads the subject once', async () => {
  mockGet.mockResolvedValue({ data: { direction: 'inbound', from_email: 'pat@x.com', to_email: 'us@y.com', subject: 'Quote' } });
  await run(['inbox', 'email', 'reply', '12', 'Thanks']);
  expect(mockPost).toHaveBeenCalledWith('/api/v1/crm/emails/12/reply',
    { to_email: 'pat@x.com', subject: 'Re: Quote', text_content: 'Thanks' });

  mockGet.mockResolvedValue({ data: { direction: 'outbound', from_email: 'us@y.com', to_email: 'pat@x.com', subject: 'Re: Quote' } });
  await run(['inbox', 'email', 'reply', '13', 'More']);
  expect(mockPost).toHaveBeenLastCalledWith('/api/v1/crm/emails/13/reply',
    { to_email: 'pat@x.com', subject: 'Re: Quote', text_content: 'More' });
});
