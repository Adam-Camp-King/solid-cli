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

/**
 * Redact Bearer tokens + common secret-looking strings from anything the CLI
 * might print or put in a JSON envelope. Belt-and-suspenders — tokens should
 * never end up in error strings in the first place.
 */
export function redactSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-=]{6,}/g, 'Bearer ***')
    .replace(/(sk_|pk_|rk_|pat_|tok_)[A-Za-z0-9_\-]{6,}/g, '$1***')
    .replace(/(password|secret|apikey|api_key|token)=([^&\s]+)/gi, '$1=***');
}

/** Keys whose value is a secret whatever it looks like. */
const SECRET_KEY = /^(authorization|password|passwd|secret|client_secret|api[_-]?key|x-api-key|token|access_token|refresh_token)$/i;

/**
 * Make a server `detail` safe to hand back to the caller.
 *
 * FastAPI 422 items are `{loc, msg, type, input, ctx}` — `input` echoes the
 * request value that failed (an API key, a card number, a whole body) and
 * `ctx` can carry it again. Both are dropped from every array item; every
 * remaining string goes through redactSecrets, and secret-named keys are
 * masked outright. Returns a new value; never mutates the server body.
 */
export function sanitizeErrorDetail(detail: unknown, depth = 0): unknown {
  if (depth > 8) return '[truncated]';
  if (typeof detail === 'string') return redactSecrets(detail);
  if (Array.isArray(detail)) {
    return detail.map((item) => {
      if (item && typeof item === 'object' && !Array.isArray(item)) {
        const { input: _input, ctx: _ctx, ...rest } = item as Record<string, unknown>;
        void _input;
        void _ctx;
        return sanitizeErrorDetail(rest, depth + 1);
      }
      return sanitizeErrorDetail(item, depth + 1);
    });
  }
  if (detail && typeof detail === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(detail as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) && v != null && v !== '' ? '***' : sanitizeErrorDetail(v, depth + 1);
    }
    return out;
  }
  return detail;
}

/** Fixed vocabulary of error codes the CLI can surface. */
export type ErrorCode =
  | 'AUTH_REQUIRED'
  | 'FORBIDDEN'
  | 'FEATURE_GATED'
  | 'SCOPE_MISSING'
  | 'NOT_FOUND'
  | 'VALIDATION_FAILED'
  | 'CONFLICT'
  | 'BAD_REQUEST'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'NETWORK_ERROR'
  | 'TIMEOUT'
  | 'DRY_RUN_BLOCKED'
  | 'APPROVAL_REQUIRED';

export const ERROR_CODES: ErrorCode[] = [
  'AUTH_REQUIRED',
  'FORBIDDEN',
  'FEATURE_GATED',
  'SCOPE_MISSING',
  'NOT_FOUND',
  'VALIDATION_FAILED',
  'CONFLICT',
  'BAD_REQUEST',
  'RATE_LIMITED',
  'SERVER_ERROR',
  'NETWORK_ERROR',
  'TIMEOUT',
  'DRY_RUN_BLOCKED',
  'APPROVAL_REQUIRED',
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
  /** Server's machine-readable reason (`error.reason`, `result.error`, ...). */
  reason?: string;
  /** Server's structured detail when it is not a plain string (FastAPI object detail). */
  detail?: unknown;
  /** Link a human must open to approve the action (APPROVAL_REQUIRED). */
  approval_url?: string;
  /** Server-side proposal/preview id paired with approval_url. */
  preview_id?: string;
  /** What the caller should do next, in words (not a command). */
  next?: string;
}

/**
 * Everything the server said about a failure, pulled out of whichever shape
 * it used. The backend has at least four:
 *
 *   FastAPI          {"detail": "text" | {...} | [{loc,msg,type}]}
 *   verb envelope    {"ok":false,"verb":"x","error":{"reason","message","approval_url"},"preview_id"}
 *   verb result      {"ok":false,"result":{"status":"ERROR","error":"unsupported_media_type","detail":"..."}}
 *   plain            {"error":"code","message":"text"} / {"status":"error","summary":"text"}
 *
 * Before this existed the CLI read `detail ?? message ?? error` as a string,
 * so an object-shaped `error` became "Request failed" and the approval link
 * the server had just minted never reached the agent. Pure.
 */
export interface ServerErrorFields {
  message?: string;
  reason?: string;
  code?: string;
  detail?: unknown;
  approval_url?: string;
  preview_id?: string;
}

export function extractServerError(data: unknown): ServerErrorFields {
  const out: ServerErrorFields = {};
  if (typeof data === 'string') {
    if (data.trim()) out.message = data.trim().slice(0, 500);
    return out;
  }
  const body = asRecord(data);
  const layers: Record<string, unknown>[] = [body];
  const result = asRecord(body.result);
  if (Object.keys(result).length) layers.push(result);

  const take = (key: keyof ServerErrorFields, v: string | undefined): void => {
    if (v && out[key] === undefined) (out as Record<string, unknown>)[key] = v;
  };

  for (const layer of layers) {
    const err = layer.error;
    if (err && typeof err === 'object' && !Array.isArray(err)) {
      const e = err as Record<string, unknown>;
      take('reason', pickString(e, 'reason'));
      take('code', pickString(e, 'code'));
      take('message', pickString(e, 'message') ?? pickString(e, 'detail'));
      take('approval_url', pickString(e, 'approval_url'));
      take('preview_id', pickString(e, 'preview_id'));
      if (out.detail === undefined && e.detail !== undefined && typeof e.detail !== 'string') out.detail = e.detail;
    } else if (typeof err === 'string' && err.trim()) {
      // A bare `error` string is a code ("invoice_not_found"), not prose.
      take('reason', err);
    }

    const det = layer.detail;
    if (typeof det === 'string' && det.trim()) {
      take('message', det);
    } else if (Array.isArray(det)) {
      if (out.detail === undefined) out.detail = det;
    } else if (det && typeof det === 'object') {
      const d = det as Record<string, unknown>;
      take('reason', pickString(d, 'reason') ?? pickString(d, 'error'));
      take('code', pickString(d, 'code'));
      take('message', pickString(d, 'message') ?? pickString(d, 'detail') ?? pickString(d, 'msg'));
      take('approval_url', pickString(d, 'approval_url'));
      take('preview_id', pickString(d, 'preview_id'));
      if (out.detail === undefined) out.detail = det;
    }

    take('message', pickString(layer, 'message') ?? pickString(layer, 'summary'));
    take('reason', pickString(layer, 'reason'));
    take('approval_url', pickString(layer, 'approval_url'));
    take('preview_id', pickString(layer, 'preview_id'));
  }
  return out;
}

/** True when the server reported "a human must approve this first". */
export function isApprovalRequired(f: ServerErrorFields): boolean {
  return /^approval[_ -]?required$/i.test(f.reason || '') ||
    /^approval[_ -]?required$/i.test(f.code || '');
}

/**
 * True only for a 422 that is about missing/invalid INPUT FIELDS — a FastAPI
 * validation array, or an explicit missing-field marker. A custom 422 such as
 * `custom_code_rejected` is a policy refusal: pointing the caller at the verb's
 * input schema sends it to fix fields that were never the problem.
 */
export function isFieldValidationError(data: unknown): boolean {
  const body = asRecord(data);
  const probe = (o: Record<string, unknown>): boolean => {
    if (Array.isArray(o.detail) && o.detail.length > 0) {
      return o.detail.some((d) => {
        const r = asRecord(d);
        return Array.isArray(r.loc) || /missing|required/i.test(String(r.type ?? r.msg ?? ''));
      });
    }
    if (Array.isArray(o.missing_required) && o.missing_required.length) return true;
    if (Array.isArray(o.errors) && o.errors.length) return true;
    return false;
  };
  return probe(body) || probe(asRecord(body.result));
}

export const APPROVAL_NEXT =
  'Share approval_url with the business owner. Once they approve it, re-run the same command unchanged. Do not retry before then.';

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
 * Scope name from a 403 body, whichever shape carried it: the structured
 * `{detail: {error: "missing_scope", required_scope}}` (also accepted at the
 * top level), or the prose `detail: "Missing scope: X"`.
 */
export function extractScopeFromBody(body: Record<string, unknown>): string | undefined {
  for (const layer of [asRecord(body.detail), body]) {
    if (pickString(layer, 'error') === 'missing_scope' || pickString(layer, 'code') === 'missing_scope') {
      const s = pickString(layer, 'required_scope') ?? pickString(layer, 'missing_scope') ?? pickString(layer, 'scope');
      if (s) return s;
    }
  }
  return extractScopeFromDetail(pickString(body, 'detail') ?? pickString(body, 'message'));
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
  const server = extractServerError(data);

  // A write that needs the owner's sign-off. Whatever HTTP status carried it
  // (200 ok:false, 403, 409, 202), the caller's move is the same: hand the link
  // to a human and wait. Checked first so no status branch can hide it.
  if (isApprovalRequired(server)) {
    return withRequestId(
      withServerFields({
        code: 'APPROVAL_REQUIRED',
        hint: 'The business owner must approve this action.',
        next: APPROVAL_NEXT,
      }, server),
      requestId,
    );
  }

  // Prefer the server's own `error.code` when it matches our vocabulary
  // (backend middleware like MCPRateLimitMiddleware uses RATE_LIMITED).
  const preferred = (errEnvCode || serverCode) as ErrorCode | undefined;
  if (preferred && ERROR_CODES.includes(preferred)) {
    return withRequestId(withServerFields({ code: preferred, ...extractEnvelopeExtras(serverError, body) }, server), requestId);
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

  return withRequestId(withServerFields(classifyByStatus(status, body, serverCode, data, server), server), requestId);
}

function classifyByStatus(
  status: number,
  body: Record<string, unknown>,
  serverCode: string | undefined,
  data: unknown,
  server: ServerErrorFields,
): ClassifiedError {
  switch (true) {
    case status === 401:
      return (
        { code: 'AUTH_REQUIRED', hint: 'Run: solid auth login (or set SOLID_TOKEN)' }
      );

    case status === 403: {
      // FEATURE_GATED signal comes as `data.code === 'FEATURE_GATED'` at the
      // top level today.
      if (serverCode === 'FEATURE_GATED') {
        return (
          {
            code: 'FEATURE_GATED',
            feature: pickString(body, 'feature'),
            upgrade_to: pickString(body, 'upgrade_to'),
            // `solid upgrade` does not exist. `solid billing` is the group
            // that does, and `status` shows the current plan.
            hint: 'Run: solid whoami --features  ·  Upgrade: solid billing status',
          }
        );
      }
      // Scope-missing, in both shapes the backend sends:
      //   prose:      `detail: "Missing scope: X"` (cli_agents, cli_flows, cli_ant)
      //   structured: `detail: {error: "missing_scope", required_scope: X, ...}`
      //               (ada cli-dispatch). Before this read the structured form
      //               it fell through to FORBIDDEN and told the caller to
      //               check their tier — the wrong repair entirely.
      const scope = extractScopeFromBody(body);
      if (scope) {
        return (
          {
            code: 'SCOPE_MISSING',
            scope,
            hint: `This API key lacks scope ${scope}. Replace it with one that has it: solid keys rotate --add-scope ${scope}  (or name another key: solid keys rotate <key_id> --add-scope ${scope})`,
          }
        );
      }
      return (
        {
          code: 'FORBIDDEN',
          hint: 'Check your tier: solid whoami --features',
        }
      );
    }

    case status === 404:
      return ({ code: 'NOT_FOUND' });

    case status === 409:
      return ({ code: 'CONFLICT' });

    case status === 422:
      return (
        {
          code: 'VALIDATION_FAILED',
          // Was "Run with --help to see required flags". The verb path takes
          // JSON through -p, not flags, so --help shows nothing relevant.
          // `verbs describe` prints the input_schema, which is the answer —
          // but ONLY when fields are the problem. A policy 422
          // (custom_code_rejected) is not fixed by reading the schema.
          // A named non-field reason (custom_code_rejected, ...) is a policy
          // refusal; anything else — a FastAPI field array, a bare 422, a
          // "field required" string — is about the input shape.
          hint: isFieldValidationError(data) || !server.reason
            ? 'Required fields: solid verbs describe <verb>'
            : 'The server rejected the request content — see reason/message. Retrying unchanged will fail the same way.',
        }
      );

    case status === 408:
      return (
        { code: 'TIMEOUT', hint: 'Try --timeout=60, or run: solid health' }
      );

    case status === 429:
      return (
        { code: 'RATE_LIMITED', hint: 'Slow down or run with --timeout=60' }
      );

    case status >= 500 && status < 600:
      return (
        { code: 'SERVER_ERROR', hint: 'Try again, or run: solid health' }
      );

    // Every remaining 4xx — 400, 405, 410, 415 and the rest — is the caller's
    // fault. This used to fall through to the default below and come back as
    // SERVER_ERROR, which isRetryable() reports as retryable:true. An agent
    // honouring that field re-sends an identical bad request forever: passing
    // `--surface bogusXYZ` was an infinite loop, not an error. 408 and 429 are
    // handled above because a plain retry genuinely can fix those two.
    case status >= 400 && status < 500:
      return (
        {
          code: 'BAD_REQUEST',
          hint: 'Fix the request — retrying it unchanged will fail the same way.',
        }
      );

    default:
      return ({ code: 'SERVER_ERROR' });
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

/** Copy what the server said onto the classification without overriding it. */
function withServerFields(c: ClassifiedError, f: ServerErrorFields): ClassifiedError {
  const out: ClassifiedError = { ...c };
  if (f.reason && !out.reason) out.reason = f.reason;
  if (f.detail !== undefined && out.detail === undefined) out.detail = sanitizeErrorDetail(f.detail);
  if (f.approval_url && !out.approval_url) out.approval_url = f.approval_url;
  if (f.preview_id && !out.preview_id) out.preview_id = f.preview_id;
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
    /** The literal next command. Absent when no single command repairs it. */
    fix?: string;
    scope?: string;
    feature?: string;
    upgrade_to?: string;
    hint?: string;
    docs_url?: string;
    request_id?: string;
    /** Server's machine-readable reason, verbatim. */
    reason?: string;
    /** Server's structured detail (FastAPI object/array detail), verbatim. */
    detail?: unknown;
    approval_url?: string;
    preview_id?: string;
    /** What to do next, in words. Present for APPROVAL_REQUIRED. */
    next?: string;
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
/**
 * The literal next command for an error, or undefined when there is not one.
 *
 * Sprint VNP 2.5. `hint` is prose; `fix` is something you can run. The rule
 * that matters more than coverage: a `fix` must be a REAL command. Emitting a
 * template like `solid verbs describe <verb>` would look like coverage and
 * hand the caller a string that fails — which is how this codebase ended up
 * telling people to run `solid upgrade`, a command that has never existed, in
 * the 403 hint. Where no concrete command applies, there is no `fix` and the
 * `hint` still explains.
 *
 * Every command named here was checked against the live tree.
 */
export function fixForCode(c: ClassifiedError): string | undefined {
  switch (c.code) {
    case 'AUTH_REQUIRED':
      return 'solid auth login';
    case 'SCOPE_MISSING':
      // Real since 2.24.8: with no key id, `keys rotate` replaces the sk_ key
      // the CLI is using, creating the new key BEFORE revoking the old one.
      return c.scope ? `solid keys rotate --add-scope ${c.scope}` : 'solid keys rotate';
    case 'FEATURE_GATED':
      return 'solid billing status';
    case 'FORBIDDEN':
      return 'solid whoami --features';
    case 'NETWORK_ERROR':
    case 'TIMEOUT':
    case 'SERVER_ERROR':
      return 'solid health';
    // No honest one-liner for these: the repair depends on the call, and the
    // message already names the field or the conflict.
    case 'VALIDATION_FAILED':
    case 'BAD_REQUEST':
    case 'NOT_FOUND':
    case 'CONFLICT':
    case 'RATE_LIMITED':
    case 'DRY_RUN_BLOCKED':
    case 'APPROVAL_REQUIRED':
      return undefined;
    default: {
      const _exhaustive: never = c.code;
      void _exhaustive;
      return undefined;
    }
  }
}

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
    case 'BAD_REQUEST':
    case 'DRY_RUN_BLOCKED':
    // Retrying before a human approves returns the same refusal (and may mint
    // another proposal). Not retryable; `next` says what unblocks it.
    case 'APPROVAL_REQUIRED':
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
  const fix = fixForCode(classified);
  if (fix) envelope.fix = fix;
  if (classified.scope) envelope.scope = classified.scope;
  if (classified.feature) envelope.feature = classified.feature;
  if (classified.upgrade_to) envelope.upgrade_to = classified.upgrade_to;
  if (classified.hint) envelope.hint = classified.hint;
  if (classified.docs_url) envelope.docs_url = classified.docs_url;
  if (classified.request_id) envelope.request_id = classified.request_id;
  if (classified.reason) envelope.reason = classified.reason;
  if (classified.detail !== undefined) envelope.detail = sanitizeErrorDetail(classified.detail);
  if (classified.approval_url) envelope.approval_url = classified.approval_url;
  if (classified.preview_id) envelope.preview_id = classified.preview_id;
  if (classified.next) envelope.next = classified.next;
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
