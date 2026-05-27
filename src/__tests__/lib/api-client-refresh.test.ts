/**
 * Auth refresh behavior — the "AI-first" path.
 *
 * The CLI is used by LLM agents (Claude Code, etc.) that fire commands
 * unattended, often in parallel. Two behaviors make this reliable:
 *
 *   1. Proactive refresh — if the cached access token is within 60s of
 *      expiry, we refresh BEFORE sending instead of eating a 401+retry.
 *   2. Single-flight — N parallel callers that all need a refresh share
 *      ONE /auth/refresh call. No thundering herd.
 *
 * These tests exercise both invariants without real HTTP.
 */

// CRITICAL: Replace the real config module with a fully in-memory stub.
// The real ConfigManager's setters call save() → fs.writeFileSync(~/.solid/
// config.json). Earlier versions of this test tried to mock fs instead, but
// the spread-actual pattern leaked writes to real disk and nuked Adam's
// login. Mocking the module itself is the only hermetic fix.
jest.mock('../../lib/config', () => {
  const state: Record<string, unknown> = {
    apiUrl: 'https://test-api.solidnumber.com',
    environment: 'test',
    accessToken: undefined,
    refreshToken: undefined,
    tokenExpiresAt: undefined,
    userId: undefined,
    userEmail: undefined,
    companyId: undefined,
  };
  return {
    config: new Proxy(state, {
      get(target, prop: string) {
        return target[prop];
      },
      set(target, prop: string, value) {
        target[prop] = value;
        return true;
      },
    }),
  };
});

// axios must be mocked BEFORE api-client is imported, because api-client has
// a top-level `new ApiClient()` that calls axios.create() at module load.
jest.mock('axios', () => {
  const mockInstance = {
    interceptors: {
      request: { use: jest.fn() },
      response: { use: jest.fn() },
    },
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    patch: jest.fn(),
    delete: jest.fn(),
    request: jest.fn(),
  };
  const fn: any = jest.fn();
  fn.create = jest.fn(() => mockInstance);
  fn.post = jest.fn();
  fn.get = jest.fn();
  fn.isAxiosError = jest.fn(() => true);
  return { __esModule: true, default: fn };
});

import axios from 'axios';
import { config } from '../../lib/config';
import { apiClient } from '../../lib/api-client';

const mockedAxios = axios as jest.Mocked<typeof axios>;

// Capture interceptor callbacks at module scope — beforeEach calls
// jest.clearAllMocks() which wipes mock.calls/mock.results. The callback
// functions themselves survive; we just need to grab them before the wipe.
const _mockCreate = (axios as any).create as jest.Mock;
const _mockInstance = _mockCreate.mock.results[0]?.value;
const _authInterceptorCb = _mockInstance?.interceptors?.request?.use?.mock?.calls?.[1]?.[0] as
  | ((cfg: any) => Promise<any>)
  | undefined;

beforeEach(() => {
  // Reset in-memory token state to a known good baseline.
  config.accessToken = 'access_ABC';
  config.refreshToken = 'refresh_XYZ';
  config.tokenExpiresAt = new Date(Date.now() + 60 * 60 * 1000); // +1h
  jest.clearAllMocks();
});


describe('single-flight refresh', () => {
  it('parallel refreshes share one /auth/refresh call', async () => {
    // Slow-resolving refresh so all three callers are in-flight at once.
    let resolveRefresh!: (value: unknown) => void;
    const refreshPromise = new Promise((resolve) => {
      resolveRefresh = resolve;
    });
    mockedAxios.post = jest.fn(() => refreshPromise) as any;

    const [a, b, c] = [
      apiClient.forceRefreshToken(),
      apiClient.forceRefreshToken(),
      apiClient.forceRefreshToken(),
    ];

    // All three are pending — none has completed yet.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);

    // Resolve the single underlying call — all three callers resolve together.
    resolveRefresh({
      data: {
        access_token: 'access_NEW',
        refresh_token: 'refresh_NEW',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    });

    await Promise.all([a, b, c]);
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(config.accessToken).toBe('access_NEW');
  });

  it('failed refresh releases the in-flight slot for the next attempt', async () => {
    // First attempt rejects; config.accessToken stays intact (no wipe on blip).
    mockedAxios.post = jest
      .fn()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce({
        data: {
          access_token: 'access_RECOVERED',
          expires_at: new Date(Date.now() + 3600_000).toISOString(),
        },
      }) as any;

    const firstOk = await apiClient.forceRefreshToken();
    expect(firstOk).toBe(false);
    expect(config.accessToken).toBe('access_ABC'); // not wiped

    const secondOk = await apiClient.forceRefreshToken();
    expect(secondOk).toBe(true);
    expect(config.accessToken).toBe('access_RECOVERED');
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});


describe('proactive refresh — expiry detection', () => {
  // The request interceptor triggers proactive refresh. We can't easily
  // exercise the full interceptor chain here (axios.create is mocked), but
  // we CAN verify the expiry check via the public shape of the config —
  // and verify that forceRefreshToken() works with realistic `expires_at`
  // payloads so the proactive path has correct state to act on.

  it('forceRefreshToken() persists fresh expiry from server response', async () => {
    const futureIso = new Date(Date.now() + 3600_000).toISOString();
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: {
        access_token: 'access_FRESH',
        refresh_token: 'refresh_FRESH',
        expires_at: futureIso,
      },
    }) as any;

    const ok = await apiClient.forceRefreshToken();
    expect(ok).toBe(true);
    expect(config.accessToken).toBe('access_FRESH');
    expect(config.refreshToken).toBe('refresh_FRESH');
    expect(config.tokenExpiresAt?.toISOString()).toBe(futureIso);
  });

  it('survives backend response that omits refresh_token (rotation skipped)', async () => {
    // Some deployments only return access_token on refresh; existing
    // refresh token must stay intact so the next refresh still works.
    mockedAxios.post = jest.fn().mockResolvedValue({
      data: {
        access_token: 'access_PARTIAL',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    }) as any;

    const ok = await apiClient.forceRefreshToken();
    expect(ok).toBe(true);
    expect(config.accessToken).toBe('access_PARTIAL');
    expect(config.refreshToken).toBe('refresh_XYZ'); // unchanged
  });

  it('no refresh token cached → refresh is a no-op failure', async () => {
    config.refreshToken = undefined;
    const ok = await apiClient.forceRefreshToken();
    expect(ok).toBe(false);
    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});


describe('proactive refresh — interceptor path', () => {
  it('interceptor callback was registered as a function', () => {
    expect(_authInterceptorCb).toBeInstanceOf(Function);
  });

  it('triggers refresh when token is within 60s of expiry', async () => {
    delete process.env.SOLID_API_KEY;
    delete process.env.SOLID_TOKEN;

    config.tokenExpiresAt = new Date(Date.now() + 30_000);
    config.refreshToken = 'refresh_XYZ';

    mockedAxios.post = jest.fn().mockResolvedValue({
      data: {
        access_token: 'access_PROACTIVE',
        refresh_token: 'refresh_PROACTIVE',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
    }) as any;

    await _authInterceptorCb!({ headers: {}, url: '/api/v1/company/list', method: 'get' });

    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    expect(config.accessToken).toBe('access_PROACTIVE');
  });

  it('skips refresh when token has plenty of time left', async () => {
    delete process.env.SOLID_API_KEY;
    delete process.env.SOLID_TOKEN;

    config.tokenExpiresAt = new Date(Date.now() + 2 * 3600_000);
    config.refreshToken = 'refresh_XYZ';

    await _authInterceptorCb!({ headers: {}, url: '/api/v1/company/list', method: 'get' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });

  it('skips refresh on auth endpoints to avoid loops', async () => {
    delete process.env.SOLID_API_KEY;
    delete process.env.SOLID_TOKEN;

    config.tokenExpiresAt = new Date(Date.now() + 30_000);
    config.refreshToken = 'refresh_XYZ';

    await _authInterceptorCb!({ headers: {}, url: '/api/v1/auth/refresh', method: 'post' });

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});
