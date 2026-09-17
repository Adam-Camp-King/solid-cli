jest.mock('../../lib/api-client', () => ({
  apiClient: { authStatus: jest.fn(), post: jest.fn(), get: jest.fn() },
  handleApiError: jest.fn((e: Error) => ({ message: e.message, status: 500 })),
}));

import { apiClient } from '../../lib/api-client';
import { config } from '../../lib/config';
import { buildProvisionBody } from '../../commands/onboarding';
import { adoptSessionToken } from '../../lib/session-token';
import { inferVerbContract } from '../../lib/verb-metadata';

describe('buildProvisionBody', () => {
  it('builds from flags and reports nothing missing', () => {
    const r = buildProvisionBody(undefined, { session: 's1', email: 'a@b.co', businessName: 'Acme', password: 'hunter22x' });
    expect(r).toEqual({
      body: { session_id: 's1', email: 'a@b.co', business_name: 'Acme', password: 'hunter22x' },
      missing: [],
    });
  });

  it('merges --data with flags, flags winning', () => {
    const r = buildProvisionBody('{"session_id":"s1","email":"old@b.co","business_name":"Acme"}', { email: 'new@b.co' });
    expect(r).toMatchObject({ body: { email: 'new@b.co', session_id: 's1' }, missing: [] });
  });

  it('names the missing required fields', () => {
    expect(buildProvisionBody(undefined, { email: 'a@b.co' })).toMatchObject({ missing: ['session_id', 'business_name'] });
  });

  it('rejects invalid --data', () => {
    expect(buildProvisionBody('{nope', {})).toHaveProperty('error');
    expect(buildProvisionBody('[1]', {})).toHaveProperty('error');
  });
});

describe('adoptSessionToken', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });

  it('stores the token + identity and clears the previous account\'s refresh state', async () => {
    delete process.env.SOLID_API_KEY; delete process.env.SOLID_TOKEN;
    (config as any).refreshToken = 'old-refresh';
    (apiClient.authStatus as jest.Mock).mockResolvedValue({
      data: { authenticated: true, user: { id: 7, email: 'o@acme.co', company_id: 123 } },
    });
    const r = await adoptSessionToken('new-token', { companyId: 123, userId: 7, email: 'o@acme.co' });
    expect(r).toMatchObject({ stored: true, confirmed: true, companyId: 123 });
    expect(config.accessToken).toBe('new-token');
    expect(config.refreshToken).toBeUndefined();
    expect(config.companyId).toBe(123);
  });

  it('stores but reports unconfirmed when an env credential outranks the session', async () => {
    process.env.SOLID_API_KEY = 'sk_solid_env';
    (apiClient.authStatus as jest.Mock).mockClear();
    const r = await adoptSessionToken('t2', { companyId: 124, userId: 8 });
    expect(r).toMatchObject({ stored: true, confirmed: false, reason: 'env_credential_overrides', companyId: 124 });
    expect(apiClient.authStatus).not.toHaveBeenCalled();
    expect(config.companyId).toBe(124);
  });
});

describe('verb metadata — sign-up needs no auth, and there is no `auth signup`', () => {
  const entry = (p: string) => ({ path: p, verb: p.split(' ').pop(), description: '', options: [], args: [], depth: 2, is_leaf: true, subcommands: [] } as any);
  it.each(['solid onboarding discover', 'solid onboarding set-business', 'solid onboarding provision', 'solid onboarding session'])(
    '%s → requires_auth false', (p) => {
      expect(inferVerbContract(entry(p)).requires_auth).toBe(false);
    });
});
