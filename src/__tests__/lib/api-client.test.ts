/**
 * API Client tests — error UX overhaul (v1.9.20).
 *
 * Verifies that handleApiError produces actionable messages, redacts
 * secrets, flattens FastAPI 422 detail arrays, and emits --debug context
 * when requested. No real HTTP calls — axios is mocked.
 */

import { handleApiError } from '../../lib/api-client';
import axios from 'axios';

function mockAxiosError(opts: {
  status?: number;
  data?: unknown;
  message?: string;
  method?: string;
  url?: string;
  code?: string;
  timeout?: number;
  body?: unknown;
}) {
  return {
    isAxiosError: true,
    config: { method: opts.method || 'GET', url: opts.url || '/api/v1/x', timeout: opts.timeout, data: opts.body },
    response: opts.status ? { status: opts.status, data: opts.data ?? {} } : undefined,
    message: opts.message || 'Request failed',
    code: opts.code,
  };
}

describe('handleApiError — status-specific hints', () => {
  beforeEach(() => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
    delete process.env.SOLID_DEBUG;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('401 → actionable "run solid auth login" hint', () => {
    const r = handleApiError(mockAxiosError({ status: 401, data: {} }));
    expect(r.status).toBe(401);
    expect(r.message).toMatch(/solid auth login/);
  });

  it('401 with server detail includes both', () => {
    const r = handleApiError(mockAxiosError({ status: 401, data: { detail: 'Token expired' } }));
    expect(r.message).toMatch(/Token expired/);
    expect(r.message).toMatch(/solid auth login/);
  });

  it('403 → tier-check hint', () => {
    const r = handleApiError(mockAxiosError({ status: 403, data: {} }));
    expect(r.message).toMatch(/whoami --features/);
  });

  it('403 with FEATURE_GATED → structured "tier limit, not a bug" message', () => {
    // The backend feature-gate middleware emits { code, feature, upgrade_to }
    // on 403. AI agents parse this to distinguish a tier limit from a bug.
    const r = handleApiError(mockAxiosError({
      status: 403,
      data: {
        detail: "Feature 'vibe-coding' is not available on your current plan.",
        code: 'FEATURE_GATED',
        feature: 'vibe-coding',
        upgrade_to: 'professional',
      },
    }));
    expect(r.status).toBe(403);
    expect(r.message).toMatch(/Tier limit/);
    expect(r.message).toMatch(/vibe-coding/);
    expect(r.message).toMatch(/professional tier/);
    expect(r.message).toMatch(/not a bug/);
    expect(r.message).toMatch(/solid upgrade/);
  });

  it('404 → surfaces method+url', () => {
    const r = handleApiError(mockAxiosError({ status: 404, method: 'POST', url: '/api/v1/orders/999', data: {} }));
    expect(r.message).toMatch(/POST \/api\/v1\/orders\/999/);
  });

  it('409 → conflict hint', () => {
    const r = handleApiError(mockAxiosError({ status: 409, data: { detail: 'slug exists' } }));
    expect(r.message).toMatch(/Conflict/);
    expect(r.message).toMatch(/slug exists/);
  });

  it('422 → flattened validation errors with loc filtered', () => {
    const r = handleApiError(mockAxiosError({
      status: 422,
      data: {
        detail: [
          { loc: ['body', 'title'], msg: 'field required', type: 'missing' },
          { loc: ['body', 'price'], msg: 'must be > 0', type: 'value_error' },
        ],
      },
    }));
    expect(r.status).toBe(422);
    expect(r.message).toMatch(/Validation failed/);
    expect(r.message).toMatch(/title: field required/);
    expect(r.message).toMatch(/price: must be > 0/);
    // "body" prefix should be stripped
    expect(r.message).not.toMatch(/body\.title/);
  });

  it('429 → rate-limit message mentions exhausted retries', () => {
    const r = handleApiError(mockAxiosError({ status: 429, data: {} }));
    expect(r.message).toMatch(/Rate limited/);
    expect(r.message).toMatch(/retries were exhausted/);
  });

  it('5xx → backend error hint', () => {
    const r = handleApiError(mockAxiosError({ status: 502, data: {} }));
    expect(r.message).toMatch(/Solid# backend error/);
    expect(r.message).toMatch(/solid health/);
  });

  it('network error (no response) → offline hint', () => {
    const r = handleApiError(mockAxiosError({ message: 'Network Error' }));
    expect(r.status).toBe(0);
    expect(r.message).toMatch(/Couldn't reach/);
  });

  it('ECONNABORTED → timeout-specific hint', () => {
    const r = handleApiError(mockAxiosError({ code: 'ECONNABORTED', timeout: 30000 }));
    expect(r.message).toMatch(/timed out/);
    expect(r.message).toMatch(/--timeout=60/);
  });
});

describe('handleApiError — redaction', () => {
  beforeEach(() => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('redacts Bearer tokens from server messages', () => {
    const r = handleApiError(mockAxiosError({
      status: 401,
      data: { detail: 'Bearer eyJhbGci.payload.signature is invalid' },
    }));
    expect(r.message).not.toMatch(/eyJhbGci/);
    expect(r.message).toMatch(/Bearer \*\*\*/);
  });

  it('redacts sk_ / pk_ secret prefixes', () => {
    const r = handleApiError(mockAxiosError({
      status: 400,
      data: { detail: 'Invalid key sk_live_abc123xyz' },
    }));
    expect(r.message).not.toMatch(/sk_live_abc123xyz/);
    expect(r.message).toMatch(/sk_\*\*\*/);
  });

  it('redacts password= style key/value leaks', () => {
    const r = handleApiError(mockAxiosError({
      status: 400,
      data: { detail: 'bad query: password=hunter2 token=abc123' },
    }));
    expect(r.message).toMatch(/password=\*\*\*/);
    expect(r.message).toMatch(/token=\*\*\*/);
  });
});

describe('handleApiError — --debug mode', () => {
  beforeEach(() => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.SOLID_DEBUG;
  });

  it('appends method/url/body when SOLID_DEBUG=1', () => {
    process.env.SOLID_DEBUG = '1';
    const r = handleApiError(mockAxiosError({
      status: 422,
      method: 'POST',
      url: '/api/v1/kb',
      data: { detail: 'validation' },
      body: { title: 'x' },
    }));
    expect(r.message).toMatch(/\[debug\] POST \/api\/v1\/kb/);
    expect(r.message).toMatch(/body=/);
  });

  it('stays clean without --debug', () => {
    const r = handleApiError(mockAxiosError({
      status: 422,
      method: 'POST',
      url: '/api/v1/kb',
      data: { detail: 'validation' },
    }));
    expect(r.message).not.toMatch(/\[debug\]/);
  });
});

describe('handleApiError — non-axios paths', () => {
  beforeEach(() => {
    jest.spyOn(axios, 'isAxiosError').mockReturnValue(false);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('handles plain Error', () => {
    const r = handleApiError(new Error('boom'));
    expect(r.message).toBe('boom');
    expect(r.status).toBe(500);
  });

  it('handles null / unknown', () => {
    expect(handleApiError(null).message).toBe('Unknown error');
    expect(handleApiError('string').message).toBe('Unknown error');
  });

  it('redacts secrets from plain Errors too', () => {
    const r = handleApiError(new Error('Failed with sk_live_leaked_key'));
    expect(r.message).not.toMatch(/sk_live_leaked_key/);
  });
});
