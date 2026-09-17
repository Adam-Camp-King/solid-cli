/**
 * `solid auth login --token` must not keep the PREVIOUS account's session.
 *
 * ⛔ WHY THIS EXISTS. The token branch overwrote access_token only. The old
 * account's refresh_token, token_expires_at and cached company list survived.
 * token_expires_at still described the OLD session, so api-client's proactive
 * refresh (`shouldRefresh` → POST /auth/refresh with config.refreshToken) fired
 * on the very next command and replaced access_token with a fresh token FOR THE
 * OLD ACCOUNT — the CLI silently flipped back to the account the operator had
 * just left, with a stale company list to match.
 *
 * The test runs the REAL command action against the suite's stand-in config
 * (src/__tests__/setup.ts mocks lib/config so nothing touches ~/.solid), with
 * only the network faked. It asserts what the action writes and clears.
 */
jest.mock('../../lib/api-client', () => ({
  apiClient: { authStatus: jest.fn() },
  handleApiError: jest.fn((e: Error) => ({ message: e.message, status: 500 })),
}));

jest.mock('../../lib/mcp-sync', () => ({
  syncMcpForCurrentCompany: jest.fn(async () => ({ ok: true })),
  describeMcpSync: jest.fn(() => ''),
}));

import { apiClient } from '../../lib/api-client';
import { config } from '../../lib/config';
import { authCommand } from '../../commands/auth';

/** The previous operator's session, as `solid auth login` leaves it. */
function seedPreviousAccount() {
  config.accessToken = 'jwt-for-account-A';
  config.refreshToken = 'refresh-for-account-A';
  config.tokenExpiresAt = new Date(Date.now() + 60_000);
  config.userId = 1;
  config.userEmail = 'first@example.com';
  config.companyId = 61;
  config.companies = [{ id: 61, name: 'ANGL', role: 'owner' }];
}

async function login(token: string) {
  try {
    await authCommand.parseAsync(['login', '--token', token], { from: 'user' });
  } catch (e) {
    // setup.ts makes process.exit throw; a rejected key is supposed to exit(1).
    if (!String(e).includes('process.exit')) throw e;
  }
}

describe('auth login --token replaces the account, not just the access token', () => {
  let logSpy: jest.SpyInstance;
  let errSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    seedPreviousAccount();
    logSpy = jest.spyOn(console, 'log').mockImplementation(() => undefined);
    errSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it('drops the previous account refresh token, expiry and company cache', async () => {
    (apiClient.authStatus as jest.Mock).mockResolvedValue({
      data: {
        authenticated: true,
        user: { id: 2, email: 'second@example.com', company_id: 81 },
      },
    });

    await login('sk_solid_account_B');

    expect(config.accessToken).toBe('sk_solid_account_B');
    expect(config.refreshToken).toBeUndefined();
    expect(config.tokenExpiresAt).toBeUndefined();
    expect(config.companies).toBeUndefined();
    expect(config.userId).toBe(2);
    expect(config.userEmail).toBe('second@example.com');
    expect(config.companyId).toBe(81);
  });

  it('leaves no refresh token behind when the new key is rejected', async () => {
    (apiClient.authStatus as jest.Mock).mockResolvedValue({
      data: { authenticated: false },
    });

    await login('sk_solid_bad');

    expect(config.accessToken).toBeUndefined();
    expect(config.refreshToken).toBeUndefined();
    expect(config.tokenExpiresAt).toBeUndefined();
    expect(config.companies).toBeUndefined();
  });

  it('leaves no refresh token behind when verification throws', async () => {
    (apiClient.authStatus as jest.Mock).mockRejectedValue(new Error('network down'));

    await login('sk_solid_offline');

    expect(config.accessToken).toBeUndefined();
    expect(config.refreshToken).toBeUndefined();
  });

  it('clears the previous session BEFORE the new key is verified', async () => {
    /* The order matters: if the clear happened only after a successful
       verification, a rejected key would leave the old account's refresh token
       usable and the CLI would quietly refresh back into it. */
    let refreshAtVerifyTime: string | undefined = 'not-observed';
    (apiClient.authStatus as jest.Mock).mockImplementation(async () => {
      refreshAtVerifyTime = config.refreshToken;
      throw new Error('network down');
    });

    await login('sk_solid_offline');

    expect(refreshAtVerifyTime).toBeUndefined();
  });
});
