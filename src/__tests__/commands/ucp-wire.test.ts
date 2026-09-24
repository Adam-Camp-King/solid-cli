/**
 * `solid ucp` against the backend's real routes (controllers/ucp_consent.py,
 * controllers/ucp_wellknown.py).
 */
jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({
    start: jest.fn().mockReturnThis(), stop: jest.fn().mockReturnThis(),
    succeed: jest.fn().mockReturnThis(), fail: jest.fn().mockReturnThis(),
  }),
}));
jest.mock('../../lib/api-client', () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
  handleApiError: jest.fn((e: any) => ({ message: e?.message || 'Error', status: 500 })),
}));
jest.mock('../../lib/config', () => ({
  config: { isLoggedIn: () => true, apiUrl: 'https://api.test', companyId: 3 },
}));

import { apiClient } from '../../lib/api-client';
const mGet = apiClient.get as jest.Mock;
const mPost = apiClient.post as jest.Mock;
const mDel = apiClient.delete as jest.Mock;

async function run(argv: string[]) {
  let cmd: any;
  jest.isolateModules(() => { cmd = require('../../commands/ucp').ucpCommand; });
  const out: string[] = [];
  const log = jest.spyOn(console, 'log').mockImplementation((...a: any[]) => { out.push(a.join(' ')); });
  const err = jest.spyOn(console, 'error').mockImplementation((...a: any[]) => { out.push(`ERR ${a.join(' ')}`); });
  const we = jest.spyOn(process.stderr, 'write').mockImplementation(((s: any) => { out.push(`STDERR ${s}`); return true; }) as any);
  try { await cmd.parseAsync(['node', 'ucp', ...argv]); }
  catch (e) { out.push(`THROW ${(e as Error).message}`); }
  finally { log.mockRestore(); err.mockRestore(); we.mockRestore(); }
  return out.join('\n');
}

beforeEach(() => { mGet.mockReset(); mPost.mockReset(); mDel.mockReset(); });

test('consent grant posts to the one-capability route, slashes kept as path', async () => {
  mPost.mockResolvedValue({ data: { id: 1 } });
  await run(['consent', 'grant', 'core/availability']);
  expect(mPost).toHaveBeenCalledWith('/api/v1/ucp/consent/capability/core/availability', {});
});

test('--scope is still accepted, ignored, and warned about', async () => {
  mPost.mockResolvedValue({ data: { id: 1 } });
  const out = await run(['consent', 'grant', 'core/signal', '--scope', 'permanent']);
  expect(mPost.mock.calls[0][0]).toBe('/api/v1/ucp/consent/capability/core/signal');
  expect(mPost.mock.calls[0][1]).toEqual({});
  expect(out).toMatch(/--scope is deprecated/);
});

test('a ladder prerequisite 409 says what to turn on', async () => {
  mPost.mockRejectedValue({ response: { status: 409, data: { detail: {
    error: 'ladder_prerequisite', message: 'Turn on UCP for the business first, then grant this capability.', needs: 'company' } } } });
  const out = await run(['consent', 'grant', 'core/signal']);
  expect(out).toContain('Turn on UCP for the business');
  expect(out).toContain('process.exit');
});

test('capabilities reads capabilities[] from the business profile', async () => {
  mGet.mockResolvedValue({ data: { ucp: { capabilities: [{ id: 'core/availability', role: 'shopper' }] }, signature: {} } });
  const out = await run(['capabilities']);
  expect(mGet).toHaveBeenCalledWith('/co/3/.well-known/ucp');
  expect(out).toContain('core/availability');
});

test('capabilities on a tenant without UCP gives a clear message, not a bare 404', async () => {
  mGet.mockRejectedValue({ response: { status: 404, data: { detail: 'UCP not enabled for this tenant' } } });
  const out = await run(['capabilities']);
  expect(out).toMatch(/UCP is not enabled for company 3/);
  expect(out).toContain('process.exit');
});

test('revoke sends DELETE with an empty JSON body', async () => {
  mDel.mockResolvedValue({ data: {} });
  await run(['consent', 'revoke', '42']);
  expect(mDel).toHaveBeenCalledWith('/api/v1/ucp/consent/grant/42', { data: {} });
});
