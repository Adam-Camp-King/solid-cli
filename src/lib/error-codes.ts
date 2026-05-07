/**
 * Structured error classification (Sprint 1 — T1.1).
 *
 * Takes the raw pieces of an axios failure (status, body, network code)
 * and returns a stable {code, hint, scope, ...} envelope that agents can
 * branch on deterministically instead of regex-matching prose messages.
 *
 * This file is deliberately pure — no axios, no commander, no I/O — so
 * every branch has a unit test in src/__tests__/error-codes.test.ts.
 * Callers:
 *   - src/lib/api-client.ts  (handleApiError) — enriches ApiError with code/hint
 *   - src/lib/command-kit.ts (run catch)      — emits JSON envelope under --json
 *
 * The enum is closed so TypeScript can exhaustive-switch on it.
 */

/** Fixed vocabulary of error codes the CLI can surface. */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'FEATURE_GATED'
  | 'SCOPE_MISSING'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DRY_RUN_BLOCKED';

export const ERROR_CODES: ErrorCode[] = [
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

/** Extra structured details paired with the code. */
export interface ClassifiedError {
  code: ErrorCode;
  /** Short actionable next step — e.g. "Run: solid auth login". */
  hint?: string;
  /** Link into docs where relevant. */
  docs_url?: string;
  /** Populated for SCOPE_MISSING. */
  scope?: string;
  /** Populated for FEATURE_GATED. */
  feature?: string;
  /** Populated for FEATURE_GATED — tier the user must upgrade to. */
  upgrade_to?: string;
  /** X-Request-ID echoed back for cross-service correlation. */
  request_id?: string;
}

export interface ClassifyInput {
  /** HTTP status; 0 when there was no response (network / timeout). */
  status: number;
  /** Parsed response body (may be anything). */
  data?: unknown;
  /** axios `error.code` — ECONNABORTED, ECONNREFUSED, ETIMEDOUT, etc. */
  networkErrorCode?: string;
  /** X-Request-ID pulled off the response headers, if any. */
  requestId?: string;
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : {};
}

function pickString(obj: Record<string, unknown>, key: string): string | undefined {
  const v = obj[key];
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

/**
 * Extract a scope name from the backend's prose 403 message.
 * Backend shape today: `detail: "Missing scope: agents:read"`.
 * Returns undefined if the pattern doesn't match.
 */
export function extractScopeFromDetail(detail: unknown): string | undefined {
  if (typeof detail !== 'string') return undefined;
  const m = detail.match(/Missing scope[:\s]+([a-z0-9_:\-*]+)/i);
  return m ? m[1] : undefined;
}

/**
 * Normalize varied backend error payloads to a single ErrorCode + metadata.
 * Pure: input → output, no side effects.
 */
export function classifyError(input: ClassifyInput): ClassifiedError {
  const { status, data, networkErrorCode, requestId } = input;
  const body = asRecord(data);
  const serverCode = pickString(body, 'code');
  const serverError = asRecord(body.error);
  const errEnvCode = pickString(serverError, 'code');

  // Prefer the server's own `error.code` when it matches our vocabulary
  // (backend middleware like MCPRateLimitMiddleware uses RATE_LIMITED).
  const preferred = (errEnvCode || serverCode) as ErrorCode | undefined;
  if (preferred && ERROR_CODES.includes(preferred)) {
    return withRequestId({ code: preferred, ...extractEnvelopeExtras(serverError, body) }, requestId);
  }

  // No HTTP response → network layer
  if (!status || status === 0) {
    if (networkErrorCode === 'ECONNABORTED' || networkErrorCode === 'ETIMEDOUT') {
      return withRequestId(
        { code: 'TIMEOUT', hint: 'Try --timeout=60, or run: solid health' },
        requestId,
      );
    }
    return withRequestId(
      { code: 'NETWORK_ERROR', hint: 'Check network, or run: solid health' },
      requestId,
    );
  }

  switch (true) {
    case status === 401:
      return withRequestId(
        { code: 'AUTH_REQUIRED', hint: 'Run: solid auth login (or set SOLID_TOKEN)' },
        requestId,
      );

    case status === 403: {
      // FEATURE_GATED signal comes as `data.code === 'FEATURE_GATED'` at the
      // top level today.
      if (serverCode === 'FEATURE_GATED') {
        return withRequestId(
          {
            code: 'FEATURE_GATED',
            feature: pickString(body, 'feature'),
            upgrade_to: pickString(body, 'upgrade_to'),
            hint: 'Run: solid whoami --features  ·  Upgrade: solid upgrade',
          },
          requestId,
        );
      }
      // Scope-missing: extract from prose `detail: "Missing scope: X"`.
      const detailStr = pickString(body, 'detail') ?? pickString(body, 'message');
      const scope = extractScopeFromDetail(detailStr);
      if (scope) {
        return withRequestId(
          {
            code: 'SCOPE_MISSING',
            scope,
            hint: `Rotate your key with scope ${scope}: solid keys rotate --add-scope ${scope}`,
          },
          requestId,
        );
      }
      return withRequestId(
        {
          code: 'FORBIDDEN',
          hint: 'Check your tier: solid whoami --features',
        },
        requestId,
      );
    }

    case status === 404:
      return withRequestId({ code: 'NOT_FOUND' }, requestId);

    case status === 409:
      return withRequestId({ code: 'CONFLICT' }, requestId);

    case status === 422:
      return withRequestId(
        { code: 'VALIDATION_FAILED', hint: 'Run with --help to see required flags' },
        requestId,
      );

    case status === 429:
      return withRequestId(
        { code: 'RATE_LIMITED', hint: 'Slow down or run with --timeout=60' },
        requestId,
      );

    case status >= 500 && status < 600:
      return withRequestId(
        { code: 'SERVER_ERROR', hint: 'Try again, or run: solid health' },
        requestId,
      );

    default:
      return withRequestId({ code: 'SERVER_ERROR' }, requestId);
  }
}

function extractEnvelopeExtras(
  serverError: Record<string, unknown>,
  body: Record<string, unknown>,
): Partial<ClassifiedError> {
  const out: Partial<ClassifiedError> = {};
  const scope = pickString(serverError, 'scope') ?? pickString(body, 'scope');
  if (scope) out.scope = scope;
  const feature = pickString(serverError, 'feature') ?? pickString(body, 'feature');
  if (feature) out.feature = feature;
  const upgrade = pickString(serverError, 'upgrade_to') ?? pickString(body, 'upgrade_to');
  if (upgrade) out.upgrade_to = upgrade;
  return out;
}

function withRequestId(c: ClassifiedError, requestId: string | undefined): ClassifiedError {
  return requestId ? { ...c, request_id: requestId } : c;
}

/**
 * Build the JSON envelope emitted under --json when SOLID_JSON_V2=1.
 * Separate from ClassifiedError so the exact wire shape is locked in one
 * place — agent clients depend on this being stable.
 */
export interface ErrorEnvelope {
  error: {
    code: ErrorCode;
    status: number;
    message: string;
    /** True when an automated retry could plausibly succeed (network blip, 5xx, rate limit, timeout). */
    retryable: boolean;
    scope?: string;
    feature?: string;
    upgrade_to?: string;
    hint?: string;
    docs_url?: string;
    request_id?: string;
  };
}

/**
 * Whether an agent should retry on this error class.
 *
 * Agents need this signal to write recovery logic without parsing prose:
 *   - Network blips, 5xx, timeouts, rate limits → retry with backoff.
 *   - Auth, scope, validation, conflict, feature-gating, dry-run → don't
 *     retry; surface to the human.
 *
 * Pure on the code; no I/O, no env. Unit-tested.
 */
export function isRetryable(code: ErrorCode): boolean {
  switch (code) {
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'RATE_LIMITED':
    case 'SERVER_ERROR':
      return true;
    case 'AUTH_REQUIRED':
    case 'FORBIDDEN':
    case 'FEATURE_GATED':
    case 'SCOPE_MISSING':
    case 'NOT_FOUND':
    case 'VALIDATION_FAILED':
    case 'CONFLICT':
    case 'DRY_RUN_BLOCKED':
      return false;
    default: {
      // Exhaustive check — TypeScript flags missing cases.
      const _exhaustive: never = code;
      void _exhaustive;
      return false;
    }
  }
}

export function toErrorEnvelope(
  classified: ClassifiedError,
  status: number,
  message: string,
): ErrorEnvelope {
  const envelope: ErrorEnvelope['error'] = {
    code: classified.code,
    status: Number(status) || 0,
    message,
    retryable: isRetryable(classified.code),
  };
  if (classified.scope) envelope.scope = classified.scope;
  if (classified.feature) envelope.feature = classified.feature;
  if (classified.upgrade_to) envelope.upgrade_to = classified.upgrade_to;
  if (classified.hint) envelope.hint = classified.hint;
  if (classified.docs_url) envelope.docs_url = classified.docs_url;
  if (classified.request_id) envelope.request_id = classified.request_id;
  return { error: envelope };
}

/**
 * True when the caller wants structured JSON errors. Default flipped
 * to ON in v2.0.0 (was opt-in via SOLID_JSON_V2 in 1.x). Callers that
 * still want the legacy prose-style errors can set SOLID_LEGACY_ERRORS=1.
 *
 * The old SOLID_JSON_V2 env var is still honored for backward
 * compatibility with scripts that explicitly opt in — it just no
 * longer matters because the default is already on.
 */
export function jsonErrorEnvelopeEnabled(): boolean {
  const legacy = process.env.SOLID_LEGACY_ERRORS;
  if (typeof legacy === 'string' && /^(1|true|yes|on)$/i.test(legacy)) {
    return false;
  }
  return true;
}
