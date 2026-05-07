/**
 * Unit tests for src/lib/error-codes.ts (Sprint 1 — T1.1).
 * Pure function tests — no HTTP, no commander.
 */
import {
  classifyError,
  ERROR_CODES,
  extractScopeFromDetail,
  jsonErrorEnvelopeEnabled,
  toErrorEnvelope,
  type ClassifiedError,
  type ErrorCode,
} from '../lib/error-codes';

// ============================================================================
// extractScopeFromDetail
// ============================================================================

describe('extractScopeFromDetail', () => {
  it('extracts the scope from the canonical backend prose', () => {
    expect(extractScopeFromDetail('Missing scope: agents:read')).toBe('agents:read');
    expect(extractScopeFromDetail('Missing scope: kb:write')).toBe('kb:write');
  });

  it('handles colons and dashes in scope names', () => {
    expect(extractScopeFromDetail('Missing scope: cms:pages:read')).toBe('cms:pages:read');
    expect(extractScopeFromDetail('Missing scope: rag-retrieve')).toBe('rag-retrieve');
  });

  it('returns undefined when pattern does not match', () => {
    expect(extractScopeFromDetail('Forbidden.')).toBeUndefined();
    expect(extractScopeFromDetail('')).toBeUndefined();
    expect(extractScopeFromDetail(undefined)).toBeUndefined();
    expect(extractScopeFromDetail(null)).toBeUndefined();
    expect(extractScopeFromDetail(42)).toBeUndefined();
  });

  it('is case-insensitive on the prefix', () => {
    expect(extractScopeFromDetail('missing scope: agents:read')).toBe('agents:read');
    expect(extractScopeFromDetail('MISSING SCOPE: agents:read')).toBe('agents:read');
  });
});

// ============================================================================
// classifyError — HTTP statuses
// ============================================================================

describe('classifyError — HTTP statuses', () => {
  it('401 → AUTH_REQUIRED', () => {
    const c = classifyError({ status: 401 });
    expect(c.code).toBe('AUTH_REQUIRED');
    expect(c.hint).toMatch(/solid auth login/);
  });

  it('403 with detail "Missing scope: X" → SCOPE_MISSING + scope populated', () => {
    const c = classifyError({
      status: 403,
      data: { detail: 'Missing scope: agents:read' },
    });
    expect(c.code).toBe('SCOPE_MISSING');
    expect(c.scope).toBe('agents:read');
    expect(c.hint).toMatch(/solid keys rotate/);
  });

  it('403 with data.code = FEATURE_GATED → FEATURE_GATED + feature/upgrade', () => {
    const c = classifyError({
      status: 403,
      data: { code: 'FEATURE_GATED', feature: 'agents', upgrade_to: 'professional' },
    });
    expect(c.code).toBe('FEATURE_GATED');
    expect(c.feature).toBe('agents');
    expect(c.upgrade_to).toBe('professional');
  });

  it('403 with no special signals → FORBIDDEN', () => {
    const c = classifyError({ status: 403, data: { detail: 'Forbidden' } });
    expect(c.code).toBe('FORBIDDEN');
  });

  it('404 → NOT_FOUND', () => {
    expect(classifyError({ status: 404 }).code).toBe('NOT_FOUND');
  });

  it('409 → CONFLICT', () => {
    expect(classifyError({ status: 409 }).code).toBe('CONFLICT');
  });

  it('422 → VALIDATION_FAILED', () => {
    const c = classifyError({ status: 422 });
    expect(c.code).toBe('VALIDATION_FAILED');
    expect(c.hint).toMatch(/--help/);
  });

  it('429 → RATE_LIMITED', () => {
    expect(classifyError({ status: 429 }).code).toBe('RATE_LIMITED');
  });

  it.each([500, 502, 503, 504, 599])('%i → SERVER_ERROR', (status) => {
    expect(classifyError({ status }).code).toBe('SERVER_ERROR');
  });

  it('unknown status (418) defaults to SERVER_ERROR', () => {
    expect(classifyError({ status: 418 }).code).toBe('SERVER_ERROR');
  });

  it('status=0 with ECONNABORTED → TIMEOUT', () => {
    const c = classifyError({ status: 0, networkErrorCode: 'ECONNABORTED' });
    expect(c.code).toBe('TIMEOUT');
    expect(c.hint).toMatch(/--timeout/);
  });

  it('status=0 with ETIMEDOUT → TIMEOUT', () => {
    expect(
      classifyError({ status: 0, networkErrorCode: 'ETIMEDOUT' }).code,
    ).toBe('TIMEOUT');
  });

  it('status=0 without timeout code → NETWORK_ERROR', () => {
    const c = classifyError({ status: 0 });
    expect(c.code).toBe('NETWORK_ERROR');
  });

  it('status=0 with ECONNREFUSED → NETWORK_ERROR', () => {
    expect(
      classifyError({ status: 0, networkErrorCode: 'ECONNREFUSED' }).code,
    ).toBe('NETWORK_ERROR');
  });
});

// ============================================================================
// classifyError — backend-supplied structured error envelope
// ============================================================================

describe('classifyError — honors server-side code envelope', () => {
  it('picks up nested error.code when it matches vocabulary (rate limiter)', () => {
    const c = classifyError({
      status: 429,
      data: {
        error: {
          code: 'RATE_LIMITED',
          limit: 300,
          window_s: 60,
          retry_after_s: 42,
        },
      },
    });
    expect(c.code).toBe('RATE_LIMITED');
  });

  it('picks up top-level data.code when it matches vocabulary', () => {
    const c = classifyError({
      status: 403,
      data: { code: 'FEATURE_GATED', feature: 'cms', upgrade_to: 'builder' },
    });
    expect(c.code).toBe('FEATURE_GATED');
    expect(c.feature).toBe('cms');
    expect(c.upgrade_to).toBe('builder');
  });

  it('ignores unrecognized server codes (falls back to status-based)', () => {
    const c = classifyError({
      status: 403,
      data: { code: 'TOTALLY_MADE_UP' },
    });
    expect(c.code).toBe('FORBIDDEN');
  });

  it('carries scope through from nested error envelope', () => {
    const c = classifyError({
      status: 403,
      data: { error: { code: 'SCOPE_MISSING', scope: 'kb:write' } },
    });
    expect(c.code).toBe('SCOPE_MISSING');
    expect(c.scope).toBe('kb:write');
  });
});

// ============================================================================
// classifyError — request_id propagation
// ============================================================================

describe('classifyError — request_id', () => {
  it('propagates request id when supplied', () => {
    const c = classifyError({ status: 500, requestId: 'deadbeef' });
    expect(c.request_id).toBe('deadbeef');
  });

  it('omits request_id field when not supplied', () => {
    const c = classifyError({ status: 500 });
    expect('request_id' in c).toBe(false);
  });
});

// ============================================================================
// toErrorEnvelope
// ============================================================================

describe('toErrorEnvelope', () => {
  it('wraps minimal classified error in {error: {...}} with message + status + retryable', () => {
    const env = toErrorEnvelope({ code: 'NOT_FOUND' }, 404, 'Not found: /api/v1/leads/99');
    expect(env).toEqual({
      error: {
        code: 'NOT_FOUND',
        status: 404,
        message: 'Not found: /api/v1/leads/99',
        retryable: false,
      },
    });
  });

  it('includes scope/feature/upgrade/hint/docs/request_id when present', () => {
    const env = toErrorEnvelope(
      {
        code: 'SCOPE_MISSING',
        scope: 'agents:read',
        hint: 'rotate key',
        docs_url: 'https://solidnumber.com/docs/errors',
        request_id: 'abc',
      },
      403,
      'Missing scope: agents:read',
    );
    expect(env).toEqual({
      error: {
        code: 'SCOPE_MISSING',
        status: 403,
        message: 'Missing scope: agents:read',
        retryable: false,
        scope: 'agents:read',
        hint: 'rotate key',
        docs_url: 'https://solidnumber.com/docs/errors',
        request_id: 'abc',
      },
    });
  });

  it('coerces status to int and defaults 0 when non-numeric', () => {
    const env = toErrorEnvelope({ code: 'NETWORK_ERROR' }, NaN, 'offline');
    expect(env.error.status).toBe(0);
  });

  it('drops keys that are not set on classified (no undefined leaks)', () => {
    const env = toErrorEnvelope({ code: 'FORBIDDEN' }, 403, 'Forbidden');
    expect('scope' in env.error).toBe(false);
    expect('hint' in env.error).toBe(false);
    expect('feature' in env.error).toBe(false);
  });

  it('marks transient errors retryable (NETWORK_ERROR, TIMEOUT, RATE_LIMITED, SERVER_ERROR)', () => {
    expect(toErrorEnvelope({ code: 'NETWORK_ERROR' }, 0, '').error.retryable).toBe(true);
    expect(toErrorEnvelope({ code: 'TIMEOUT' }, 0, '').error.retryable).toBe(true);
    expect(toErrorEnvelope({ code: 'RATE_LIMITED' }, 429, '').error.retryable).toBe(true);
    expect(toErrorEnvelope({ code: 'SERVER_ERROR' }, 500, '').error.retryable).toBe(true);
  });

  it('marks deterministic errors NOT retryable (auth, scope, validation, conflict, gating)', () => {
    expect(toErrorEnvelope({ code: 'AUTH_REQUIRED' }, 401, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'FORBIDDEN' }, 403, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'SCOPE_MISSING' }, 403, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'NOT_FOUND' }, 404, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'VALIDATION_FAILED' }, 422, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'CONFLICT' }, 409, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'FEATURE_GATED' }, 402, '').error.retryable).toBe(false);
    expect(toErrorEnvelope({ code: 'DRY_RUN_BLOCKED' }, 0, '').error.retryable).toBe(false);
  });
});

// ============================================================================
// jsonErrorEnvelopeEnabled
// ============================================================================

describe('jsonErrorEnvelopeEnabled (v2.0.0 default flipped to ON)', () => {
  const originalV2 = process.env.SOLID_JSON_V2;
  const originalLegacy = process.env.SOLID_LEGACY_ERRORS;

  beforeEach(() => {
    delete process.env.SOLID_JSON_V2;
    delete process.env.SOLID_LEGACY_ERRORS;
  });

  afterEach(() => {
    if (originalV2 === undefined) delete process.env.SOLID_JSON_V2;
    else process.env.SOLID_JSON_V2 = originalV2;
    if (originalLegacy === undefined) delete process.env.SOLID_LEGACY_ERRORS;
    else process.env.SOLID_LEGACY_ERRORS = originalLegacy;
  });

  it('default ON when no env var set (v2.0.0 behavior)', () => {
    expect(jsonErrorEnvelopeEnabled()).toBe(true);
  });

  it('still ON when SOLID_JSON_V2=1 explicitly set (backward compat)', () => {
    process.env.SOLID_JSON_V2 = '1';
    expect(jsonErrorEnvelopeEnabled()).toBe(true);
  });

  it.each(['1', 'true', 'TRUE', 'yes', 'On'])('SOLID_LEGACY_ERRORS=%s → opt out (false)', (value) => {
    process.env.SOLID_LEGACY_ERRORS = value;
    expect(jsonErrorEnvelopeEnabled()).toBe(false);
  });

  it.each(['0', 'false', 'no', 'off', ''])('SOLID_LEGACY_ERRORS=%s → still default (true)', (value) => {
    process.env.SOLID_LEGACY_ERRORS = value;
    expect(jsonErrorEnvelopeEnabled()).toBe(true);
  });
});

// ============================================================================
// ERROR_CODES vocabulary integrity
// ============================================================================

describe('ERROR_CODES vocabulary', () => {
  it('contains all documented codes', () => {
    const expected: ErrorCode[] = [
      'AUTH_REQUIRED',
      'FORBIDDEN',
      'FEATURE_GATED',
      'SCOPE_MISSING',
      'NOT_FOUND',
      'VALIDATION_FAILED',
      'CONFLICT',
      'RATE_LIMITED',
      'SERVER_ERROR',
      'NETWORK_ERROR',
      'TIMEOUT',
      'DRY_RUN_BLOCKED',
    ];
    for (const c of expected) {
      expect(ERROR_CODES).toContain(c);
    }
    expect(ERROR_CODES).toHaveLength(expected.length);
  });

  it('every classifyError output uses a code from the vocabulary', () => {
    const classified: ClassifiedError[] = [
      classifyError({ status: 401 }),
      classifyError({ status: 403 }),
      classifyError({ status: 404 }),
      classifyError({ status: 409 }),
      classifyError({ status: 422 }),
      classifyError({ status: 429 }),
      classifyError({ status: 500 }),
      classifyError({ status: 0 }),
      classifyError({ status: 0, networkErrorCode: 'ECONNABORTED' }),
    ];
    for (const c of classified) {
      expect(ERROR_CODES).toContain(c.code);
    }
  });
});
