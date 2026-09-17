/**
 * Onboarding verbs.
 *
 * Owner decision 2026-09-17: accounts are NOT created from the terminal.
 * `solid onboarding provision` refuses and points at the web entry point; every
 * other onboarding verb requires a login and acts on the logged-in company.
 */
jest.mock('../../lib/api-client', () => ({
  apiClient: { authStatus: jest.fn(), post: jest.fn(), get: jest.fn() },
  handleApiError: jest.fn((e: Error) => ({ message: e.message, status: 500 })),
}));

import * as fs from 'fs';
import * as path from 'path';
import { apiClient } from '../../lib/api-client';
import { buildProvisionBody, backendRefusal, SIGNUP_URL } from '../../commands/onboarding';
import { inferVerbContract } from '../../lib/verb-metadata';

const SRC = path.join(__dirname, '..', '..', 'commands', 'onboarding.ts');

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

describe('backendRefusal — a 200 that says success:false is a failure', () => {
  it('surfaces the backend message', () => {
    expect(backendRefusal({ success: false, message: 'No TXT record found' })).toBe('No TXT record found');
    expect(backendRefusal({ success: false })).toMatch(/refused/);
  });

  it('passes successful and non-object bodies through', () => {
    expect(backendRefusal({ success: true, message: 'ok' })).toBeNull();
    expect(backendRefusal({ verified: true })).toBeNull();
    expect(backendRefusal(null)).toBeNull();
    expect(backendRefusal([{ success: false }])).toBeNull();
  });
});

describe('no terminal account creation', () => {
  const src = fs.readFileSync(SRC, 'utf8');

  it('no code path posts to the provision endpoint', () => {
    const code = src
      .split('\n')
      .filter((l) => !l.trim().startsWith('//') && !l.trim().startsWith('*'))
      .join('\n');
    expect(code).not.toContain('onboarding-v2/provision');
  });

  it('points at the web entry point instead', () => {
    expect(SIGNUP_URL).toBe('https://solidnumber.com/start');
  });

  it('does not store a session token from any onboarding response', () => {
    expect(src).not.toContain('adoptSessionToken');
    expect(fs.existsSync(path.join(__dirname, '..', '..', 'lib', 'session-token.ts'))).toBe(false);
  });

  it('every onboarding verb that calls the backend requires a login', () => {
    const backendCalls = src.split('\n').filter((l) => /apiClient\.(get|post)\(/.test(l)).length;
    const authChecks = src.split('\n').filter((l) => l.trim() === 'requireAuth();').length;
    expect(backendCalls).toBeGreaterThan(20);
    expect(authChecks).toBeGreaterThanOrEqual(backendCalls - 1); // discover shares one guard per action
    expect(apiClient.post).not.toHaveBeenCalled();
  });
});

describe('verb metadata advertises no CLI signup verb', () => {
  const entry = (p: string) => ({ path: p, verb: p.split(' ').pop(), description: '', options: [], args: [], depth: 2, is_leaf: true, subcommands: [] } as any);

  it('there is no `solid auth signup`', () => {
    const src = fs.readFileSync(path.join(__dirname, '..', '..', 'lib', 'verb-metadata.ts'), 'utf8');
    expect(src).not.toContain("'solid auth signup'");
  });

  it.each(['solid onboarding discover', 'solid onboarding set-business', 'solid onboarding provision', 'solid onboarding session'])(
    '%s is not advertised as no-auth', (p) => {
      expect(inferVerbContract(entry(p)).requires_auth).toBe(true);
    });
});
