/**
 * API Client for Solid# Backend
 */

import axios, { AxiosInstance, AxiosError, AxiosRequestConfig, InternalAxiosRequestConfig } from 'axios';
import { randomUUID } from 'node:crypto';

/**
 * Centralised type for Axios request configs that carry our internal
 * `__solid_dry_run` / `__solid_dry_run_verify` flags. Closes Phase 0.12
 * — was 12 `as any` casts threading these flags through axios's typed
 * config; now they're a single declaration consumers can extend.
 *
 * Both flags are stripped before any network I/O — they exist purely
 * to communicate intent between the request interceptor (where we
 * decide to short-circuit) and the response interceptor (where we
 * convert the synthetic error into a user-visible dry-run summary).
 */
export interface ExtendedAxiosRequestConfig extends InternalAxiosRequestConfig {
  __solid_dry_run?: true;
  __solid_dry_run_verify?: true;
  __solid_offline_queue?: true;
}

export interface ExtendedAxiosError extends AxiosError {
  __solid_dry_run?: true;
  __solid_offline_queue?: true;
  /** Queue file path on the synthetic-success error shape. */
  __solid_queue_path?: string;
}

/** Adds the dry-run flags to a plain AxiosRequestConfig (used by callers
 *  who build a config and pass it to client.get/post/etc.). */
export interface ExtendedRequestConfig extends AxiosRequestConfig {
  __solid_dry_run?: true;
  __solid_dry_run_verify?: true;
  __solid_offline_queue?: true;
}
import * as fs from 'fs';
import * as path from 'path';
import { config } from './config';
import { deriveExistenceGet, isDryRun, makeDryRunResult } from './dry-run';
import { autoFlushQueue, enqueue, isAutoFlushInProgress, isQueueMode, queueSize } from './offline-queue';
import { applyListEnvelope } from './list-envelope';
import { checkSkewFromHeaders } from './version-skew';

// Resolve our package version once. Used for the X-Solid-CLI-Version header
// on every outbound request so the backend can log/compare CLI clients.
// Exported so other modules (schema verbs manifest, etc.) don't re-read
// package.json or duplicate the fallback.
export let CLI_VERSION = '0.0.0';
try {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  CLI_VERSION = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version || '0.0.0';
} catch {
  // leave as 0.0.0 — version-skew is best-effort, never fatal
}

interface ApiResponse<T = unknown> {
  data: T;
  status: number;
  success: boolean;
}

/**
 * Tenant Activity Gate — one company's full decision.
 *
 * Returned by both `/api/v1/tenant/my-gate-level` and
 * `/api/v1/admin/tenant-gate/{id}`. The `reason` field is a stable
 * machine-readable code — agents can pattern-match on it.
 *
 * See Owners-Manual/06-Operations/TENANT-ACTIVITY-GATE/05-API-REFERENCE.md
 */
/**
 * Q-Chain public verification metadata. Returned by
 * GET /.well-known/qchain.json (anonymous endpoint).
 */
export interface QChainWellKnown {
  version: number;
  signer_id: string;
  signers: Array<{ signer_id: string; algorithm: string; public_key_hex: string }>;
  hash_algorithm: string;
  signature_algorithm: string;
  chain_genesis_prev_hash: string;
  canonical_form: string;
  row_fields_in_canonical_form: string[];
  docs_url: string;
  verify_endpoint: string;
  export_endpoint: string;
  notes: string[];
}

/** Full row payload included in /substrate/export — every field that enters the hash. */
export interface QChainExportRow {
  id: number;
  company_id: number;
  agent: string;
  actor_user_id: number | null;
  action_type: string;
  action_input_jsonb: Record<string, unknown> | null;
  action_output_jsonb: Record<string, unknown> | null;
  related_entity_type: string | null;
  related_entity_id: number | null;
  action_taken_at: string | null;
  predicted_probability: number | null;
  predicted_tier: string | null;
  industry_template_slug: string | null;
  outcome_label: string | null;
  outcome_value_jsonb: Record<string, unknown> | null;
  outcome_value_amount: number | null;
  outcome_observed_at: string | null;
  attestation_hash: string | null;
  attestation_signature: string | null;
  attestation_signer_id: string | null;
  prev_hash: string | null;
}

export interface QChainExportResult {
  company_id: number;
  rows: QChainExportRow[];
  count: number;
  since: string | null;
  until: string | null;
  well_known_url: string;
}

export interface QChainVerifyResult {
  ok: boolean;
  rows_checked: number;
  rows_broken: Array<Record<string, unknown>>;
  signature_summary: Record<string, number>;
}

export interface TenantGateDecision {
  company_id: number;
  level: 'HOT' | 'WARM' | 'COLD' | 'DORMANT' | 'BLOCKED';
  level_value: number;
  reason: string;
  signals: {
    billing_exempt: boolean;
    in_hardcoded_set: boolean;
    is_deleted: boolean;
    is_suspended: boolean;
    is_archived: boolean;
    onboarding_status: string | null;
    subscription_status: string | null;
    last_login_at: string | null;
    last_token_usage_at: string | null;
    effective_last_activity_at: string | null;
  };
  bypass_reasons: string[];
  evaluated_at: string;
}

interface ApiError {
  message: string;
  code?: string;
  status: number;
  // Sprint 1 T1.1 — structured error surface for agents.
  hint?: string;
  docs_url?: string;
  scope?: string;
  feature?: string;
  upgrade_to?: string;
  request_id?: string;
}

// Global override for per-invocation auth. Set by `--token <val>` on the
// root program before any command runs; takes precedence over SOLID_API_KEY,
// SOLID_TOKEN, and the cached session.
let overrideToken: string | null = null;

export function setOverrideToken(token: string | null): void {
  overrideToken = token;
}

export function hasOverrideToken(): boolean {
  return overrideToken !== null;
}

// Global timeout override (ms). Set by `--timeout <seconds>` or
// SOLID_TIMEOUT_MS. Applied per-request by the interceptor so existing
// AxiosInstance timeout stays at the default.
let overrideTimeoutMs: number | null = null;
export function setOverrideTimeoutMs(ms: number | null): void { overrideTimeoutMs = ms; }

// Global API URL override (for sandbox/local testing without touching
// ~/.solid/config.json). Set via SOLID_API_URL env var at boot.
const ENV_API_URL = process.env.SOLID_API_URL || null;
export function getResolvedApiUrl(): string {
  return ENV_API_URL || config.apiUrl;
}

// How close to expiry (in seconds) we proactively refresh the access token.
// The refresh token is good for 7 days; the access token for 1 hour. Refreshing
// slightly before expiry avoids a 401+retry round-trip on every command an AI
// agent runs in the last minute of a token's life.
const REFRESH_LEAD_SECONDS = 60;

/**
 * Build the axios config fragment that pins a caller-supplied Idempotency-Key.
 * Returns `undefined` when no key is given, so the request interceptor falls
 * back to auto-generating a per-call key. Centralised so post/put/patch/delete
 * stay one-liners and the header name lives in exactly one place.
 */
function idempotencyConfig(options?: { idempotencyKey?: string }): { headers: Record<string, string> } | undefined {
  return options?.idempotencyKey ? { headers: { 'Idempotency-Key': options.idempotencyKey } } : undefined;
}

/**
 * Decide the Idempotency-Key for an outgoing request. Returns a fresh UUID for
 * mutating methods that don't already carry a key, else `null` (leave as-is).
 * Pure + exported so the interceptor rule is unit-testable without HTTP mocking.
 *   - GET/HEAD                    → null (reads need no idempotency)
 *   - existing key present        → null (caller pinned it; never overwrite)
 *   - SOLID_NO_IDEMPOTENCY set    → null (global opt-out)
 *   - POST/PUT/PATCH/DELETE       → new randomUUID()
 */
export function nextIdempotencyKey(
  method: string | undefined,
  hasExistingKey: boolean,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env.SOLID_NO_IDEMPOTENCY) return null;
  if (hasExistingKey) return null;
  const m = (method || 'get').toLowerCase();
  if (m === 'post' || m === 'put' || m === 'patch' || m === 'delete') return randomUUID();
  return null;
}

class ApiClient {
  private client: AxiosInstance;

  // Single-flight refresh: if an AI agent fires N parallel commands after
  // the token expired, all N interceptors would otherwise race to refresh.
  // Share one in-flight promise so exactly one /auth/refresh call happens.
  private refreshInFlight: Promise<boolean> | null = null;

  constructor() {
    this.client = axios.create({
      baseURL: ENV_API_URL || config.apiUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Apply per-request timeout override (from --timeout flag or
     // SOLID_TIMEOUT_MS env) before anything else. Leaves the default
     // 30 s in place when no override is set.
     this.client.interceptors.request.use((requestConfig) => {
       const envTimeout = Number(process.env.SOLID_TIMEOUT_MS);
       const ms = overrideTimeoutMs ?? (Number.isFinite(envTimeout) && envTimeout > 0 ? envTimeout : null);
       if (ms !== null) requestConfig.timeout = ms;
       return requestConfig;
     });

    // Add auth interceptor + T11.2 dry-run short-circuit
    this.client.interceptors.request.use(async (requestConfig) => {
      // T11.2 — dry-run: block mutations before they leave the process.
      // The flag is global (set by --dry-run or SOLID_DRY_RUN env var).
      // We signal "intercepted" via a special error shape the response
      // error-interceptor converts into a success result. No network I/O.
      const method = (requestConfig.method || 'get').toLowerCase();
      const isMutation = method === 'post' || method === 'put' || method === 'patch' || method === 'delete';
      const extConfig = requestConfig as ExtendedAxiosRequestConfig;

      // A+.6 — offline queue. Mutations get written to .solid/queue/
      // instead of dispatched. Read-side calls pass through (the read
      // path already supports offline via `.claude/solid-context.jsonld`).
      // Queue mode supersedes dry-run: if both are armed, queue wins
      // because it preserves state for replay; dry-run is fire-and-forget.
      if (isMutation && isQueueMode() && !extConfig.__solid_dry_run_verify) {
        const result = enqueue(method, requestConfig.url || '', requestConfig.data, {
          cliVersion: CLI_VERSION,
        });
        extConfig.__solid_offline_queue = true;
        const err = new Error('SOLID_OFFLINE_QUEUE_INTERCEPT') as ExtendedAxiosError;
        err.__solid_offline_queue = true;
        err.__solid_queue_path = result.path;
        err.config = requestConfig;
        throw err;
      }

      if (isMutation && isDryRun() && !extConfig.__solid_dry_run_verify) {
        // T1.2 — Existence verification before short-circuit. Mutations
        // targeted at a specific resource URL (PATCH/PUT/DELETE /foo/:id)
        // do a GET first; if the server says 404, we surface NOT_FOUND
        // instead of lying with synthetic success. Non-verifiable shapes
        // (POST to a collection, /publish actions, etc.) skip ahead.
        const verifyUrl = deriveExistenceGet(requestConfig.method, requestConfig.url);
        if (verifyUrl) {
          // Tag the GET config so the error interceptor can tell a verify
          // failure apart from a user-level GET failure — and so we don't
          // recursively re-verify (dry-run skip check above).
          const verifyCfg: ExtendedRequestConfig = {
            params: undefined,
            headers: { 'X-Solid-Dry-Run-Verify': '1' },
            __solid_dry_run_verify: true,
          };
          await this.client.get(verifyUrl, verifyCfg);
          // 200 on verify → existence confirmed; proceed to short-circuit.
        }
        // Tag the config so the error interceptor can recognize it.
        extConfig.__solid_dry_run = true;
        // Throwing from a request interceptor cancels the request.
        const err = new Error('SOLID_DRY_RUN_INTERCEPT') as ExtendedAxiosError;
        err.__solid_dry_run = true;
        err.config = requestConfig;
        throw err;
      }

      // Proactive refresh — refresh before sending when the cached access
      // token is within REFRESH_LEAD_SECONDS of expiry. Skipped when using an
      // override token (--token / env var) or when targeting /auth/login or
      // /auth/refresh itself (would loop). Best-effort: on failure we fall
      // through and let the existing 401-retry path surface the error.
      const isAuthEndpoint =
        !!requestConfig.url &&
        (requestConfig.url.includes('/auth/login') || requestConfig.url.includes('/auth/refresh'));
      const usingCachedSession =
        !overrideToken && !process.env.SOLID_API_KEY && !process.env.SOLID_TOKEN;
      if (
        usingCachedSession &&
        !isAuthEndpoint &&
        config.refreshToken &&
        this.isAccessTokenExpiringSoon()
      ) {
        await this.refreshTokenSingleFlight();
      }

      // Auth precedence (highest → lowest):
      //   1. `--token <x>` flag (per-invocation, never persisted to disk)
      //   2. SOLID_API_KEY / SOLID_TOKEN env vars (CI/CD, LLM agents)
      //   3. cached session from ~/.solid/config.json
      const chosen =
        overrideToken ||
        process.env.SOLID_API_KEY ||
        process.env.SOLID_TOKEN ||
        config.accessToken;
      if (chosen) {
        requestConfig.headers.Authorization = `Bearer ${chosen}`;
      }
      const companyId = config.companyId;
      if (companyId) {
        requestConfig.headers['X-Company-ID'] = companyId.toString();
      }
      // Advertise which CLI version is talking to the backend. The server
      // may return X-Solid-Min-CLI-Version / X-Solid-Latest-CLI-Version in
      // response headers to trigger the skew warning.
      requestConfig.headers['X-Solid-CLI-Version'] = CLI_VERSION;
      requestConfig.headers['User-Agent'] = `solid-cli/${CLI_VERSION} node/${process.version.slice(1)}`;

      // Agent-aware headers — when an AI (Claude/Cursor/Codex) drives the
      // CLI via `solid ai`, these tell the backend WHO is making the call
      // and WHICH human started the session. Backend audit logs can then
      // distinguish human-initiated vs agent-initiated mutations without
      // trusting the client for enforcement (the user still owns the
      // token; this is identification, not authentication).
      //
      //   X-Solid-Agent          claude | cursor | codex | <custom>
      //   X-Solid-Agent-Mode     customer | developer | agency | full
      //   X-Solid-Human-Initiator the email of the human who ran `solid ai`
      //
      // Set by `solid ai` via env vars so subprocesses inherit them.
      if (process.env.SOLID_AGENT) requestConfig.headers['X-Solid-Agent'] = process.env.SOLID_AGENT;
      if (process.env.SOLID_AGENT_MODE) requestConfig.headers['X-Solid-Agent-Mode'] = process.env.SOLID_AGENT_MODE;
      if (process.env.SOLID_HUMAN_INITIATOR) requestConfig.headers['X-Solid-Human-Initiator'] = process.env.SOLID_HUMAN_INITIATOR;
      // Sandbox flag — lets the backend record the event as dry-run so the
      // activity dashboard counts sandboxed vs real mutations separately.
      if (process.env.SOLID_AGENT_SANDBOX) requestConfig.headers['X-Solid-Agent-Sandbox'] = '1';

      // Idempotency — attach a key to every mutation so an internal retry
      // (401 refresh, transient network failure) can't double-execute the
      // write. Generated once here and reused on the 401-retry because axios
      // re-sends the SAME config object (the header is already present, so
      // nextIdempotencyKey returns null) — the key is stable across retries of
      // one logical request. A caller that set its own key (offline-queue
      // replay, or `solid apply` with a content-derived key) keeps it.
      // Backends that honor Idempotency-Key (payments, crm, orders,
      // onboarding, ...) dedupe; others ignore the header harmlessly.
      const idemKey = nextIdempotencyKey(requestConfig.method, !!requestConfig.headers['Idempotency-Key']);
      if (idemKey) requestConfig.headers['Idempotency-Key'] = idemKey;

      return requestConfig;
    });

    // Add response interceptor — retry once on 401 with token refresh,
    // and synthesize a success response for dry-run-intercepted requests.
    this.client.interceptors.response.use(
      (response) => {
        // Version-skew: check once per process from response headers.
        // No-op until the backend opts in by setting these headers.
        try { checkSkewFromHeaders(CLI_VERSION, response.headers as Record<string, unknown>); } catch {
          // Skew warnings are best-effort; never break a real response.
        }
        // T1.4 — list-envelope normalization. Aliases `.items` + `.total`
        // onto any response body that's shaped like a list (pages,
        // results, leads, logs, api_keys, ...). Non-destructive: original
        // keys stay. Opt out via SOLID_LEGACY_LIST_SHAPES=1.
        try {
          applyListEnvelope(response.data);
        } catch {
          // normalization is additive and best-effort; never break a response.
        }

        // A+.6b — auto-flush. A successful mutation response proves
        // connectivity. If there are queued mutations from a prior
        // offline window, drain them silently in the background.
        // Re-entry guard: each replay also returns a successful
        // response; isAutoFlushInProgress() short-circuits inner calls.
        try {
          const respMethod = (response.config?.method || 'get').toLowerCase();
          const respIsMutation =
            respMethod === 'post' || respMethod === 'put' ||
            respMethod === 'patch' || respMethod === 'delete';
          if (
            respIsMutation &&
            !isAutoFlushInProgress() &&
            !isQueueMode() &&
            queueSize() > 0
          ) {
            // Fire-and-forget: don't block the caller's response. The
            // dispatcher uses the same axios client so each replay
            // re-enters this interceptor (and is short-circuited by
            // the in-flight guard).
            const dispatch = async (method: string, url: string, body: unknown, idempotencyKey?: string) => {
              const m = method.toLowerCase();
              const headers = idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : undefined;
              if (m === 'post') await this.client.post(url, body, { headers });
              else if (m === 'put') await this.client.put(url, body, { headers });
              else if (m === 'patch') await this.client.patch(url, body, { headers });
              else if (m === 'delete') await this.client.delete(url, { headers });
              else throw new Error(`unknown queued method: ${method}`);
            };
            void autoFlushQueue(dispatch).then((stats) => {
              if (stats.succeeded > 0) {
                process.stderr.write(
                  `\x1b[36m[auto-flush]\x1b[0m replayed ${stats.succeeded} queued mutation${stats.succeeded === 1 ? '' : 's'}` +
                    (stats.failed > 0 ? `, ${stats.failed} still pending` : '') +
                    `.\n`,
                );
              }
            }).catch((err) => {
              process.stderr.write(
                `\x1b[36m[auto-flush]\x1b[0m queue replay error: ${(err as Error).message}\n`,
              );
            });
          }
        } catch {
          // never break a response over auto-flush plumbing
        }

        return response;
      },
      async (error: ExtendedAxiosError) => {
        // A+.6 — offline queue synthetic response. Mutation was written
        // to .solid/queue/ instead of dispatched; the caller's success
        // path runs as if the server accepted it.
        if (error.__solid_offline_queue) {
          const cfg = (error.config || {}) as ExtendedAxiosRequestConfig;
          return {
            data: {
              queued: true,
              queue_path: error.__solid_queue_path,
              status: 'queued',
              success: true,
              id: `queued_${Date.now()}`,
              message: 'mutation written to offline queue; replay with `solid push --flush`',
            },
            status: 202, // Accepted — semantically correct for "queued, will replay"
            statusText: 'QUEUED',
            headers: {},
            config: cfg,
          } as unknown as import('axios').AxiosResponse;
        }

        // A+.6b — auto-detect connectivity loss. If a mutation hits a
        // network-layer failure (ECONNREFUSED / ENOTFOUND / ECONNABORTED
        // / no response), AUTO-ENQUEUE instead of erroring. No flag, no
        // ceremony — the CLI just keeps working. User sees
        // `[QUEUED — offline]` and the next online run flushes.
        const cfgEarly = (error.config || {}) as ExtendedAxiosRequestConfig;
        const methodEarly = (cfgEarly.method || 'get').toLowerCase();
        const isMutationEarly =
          methodEarly === 'post' || methodEarly === 'put' ||
          methodEarly === 'patch' || methodEarly === 'delete';
        const isNetworkFailure =
          !error.response &&
          (error.code === 'ECONNREFUSED' ||
            error.code === 'ENOTFOUND' ||
            error.code === 'ECONNABORTED' ||
            error.code === 'ECONNRESET' ||
            error.code === 'EAI_AGAIN' ||
            error.message === 'Network Error');
        if (
          isMutationEarly &&
          isNetworkFailure &&
          !cfgEarly.__solid_dry_run_verify &&
          !cfgEarly.__solid_offline_queue &&
          // Skip for auth/refresh: queueing those would loop on next flush.
          !(cfgEarly.url || '').includes('/auth/login') &&
          !(cfgEarly.url || '').includes('/auth/refresh')
        ) {
          const result = enqueue(
            cfgEarly.method || 'POST',
            cfgEarly.url || '',
            cfgEarly.data,
            { cliVersion: CLI_VERSION },
          );
          process.stderr.write(
            `\x1b[36m[QUEUED — offline]\x1b[0m connection failed; mutation saved.\n` +
            `  Replay automatically on the next online command, or run: solid push --flush\n`,
          );
          return {
            data: {
              queued: true,
              queue_path: result.path,
              status: 'queued_auto',
              success: true,
              id: `queued_auto_${Date.now()}`,
              message: 'auto-queued on connectivity loss',
            },
            status: 202,
            statusText: 'QUEUED_AUTO',
            headers: {},
            config: cfgEarly,
          } as unknown as import('axios').AxiosResponse;
        }

        // Dry-run synthetic response — the mutation never left the process.
        if (error.__solid_dry_run) {
          const cfg = (error.config || {}) as ExtendedAxiosRequestConfig;
          const method = (cfg.method || 'POST').toUpperCase();
          const body = cfg.data;
          const parsed = typeof body === 'string' ? (() => { try { return JSON.parse(body); } catch { return body; } })() : body;
          return {
            data: makeDryRunResult(method, cfg.url || '', parsed),
            status: 200,
            statusText: 'DRY_RUN',
            headers: {},
            config: cfg,
          } as unknown as import('axios').AxiosResponse;
        }
        const originalRequest = error.config as AxiosError['config'] & { _retry?: boolean; _retry429?: number };

        // Retry on 429 (rate limit) with exponential backoff + Retry-After.
        // Cap at 3 attempts total (2 retries) to avoid runaway loops.
        if (
          error.response?.status === 429 &&
          originalRequest &&
          (originalRequest._retry429 ?? 0) < 2
        ) {
          originalRequest._retry429 = (originalRequest._retry429 ?? 0) + 1;
          const retryAfter = Number(error.response.headers?.['retry-after']);
          // Retry-After is either seconds (integer) or an HTTP-date. We only
          // handle the seconds form — the date form is rare in practice.
          const headerDelay = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : null;
          // Exponential backoff: 1s, 2s. Capped by header if present.
          const backoffMs = Math.min(headerDelay ?? Infinity, 1000 * 2 ** (originalRequest._retry429 - 1));
          await new Promise((r) => setTimeout(r, backoffMs));
          return this.client.request(originalRequest);
        }

        // Only attempt refresh if: 401, not already retried, not a login/refresh request itself
        if (
          error.response?.status === 401 &&
          originalRequest &&
          !originalRequest._retry &&
          !originalRequest.url?.includes('/auth/login') &&
          !originalRequest.url?.includes('/auth/refresh')
        ) {
          originalRequest._retry = true;
          const refreshed = await this.refreshTokenSingleFlight();
          if (refreshed) {
            return this.client.request(originalRequest);
          }
        }
        throw error;
      }
    );
  }

  // True when the cached access token is missing an expiry (unknown — skip
  // proactive refresh) or within REFRESH_LEAD_SECONDS of expiring. Exposed
  // via a method (not an inline expression) so tests can mock `Date.now`.
  private isAccessTokenExpiringSoon(): boolean {
    const expiresAt = config.tokenExpiresAt;
    if (!expiresAt) return false;
    const msUntilExpiry = expiresAt.getTime() - Date.now();
    return msUntilExpiry < REFRESH_LEAD_SECONDS * 1000;
  }

  // Wraps refreshToken() with single-flight semantics: concurrent callers
  // share one in-flight /auth/refresh call instead of each firing their own.
  private refreshTokenSingleFlight(): Promise<boolean> {
    if (this.refreshInFlight) return this.refreshInFlight;
    this.refreshInFlight = this.refreshToken().finally(() => {
      this.refreshInFlight = null;
    });
    return this.refreshInFlight;
  }

  // Public so `solid auth refresh` can force-rotate on demand.
  async forceRefreshToken(): Promise<boolean> {
    return this.refreshTokenSingleFlight();
  }

  private async refreshToken(): Promise<boolean> {
    const refreshToken = config.refreshToken;
    if (!refreshToken) return false;

    try {
      const response = await axios.post(`${config.apiUrl}/api/v1/auth/refresh`, {
        refresh_token: refreshToken,
      });

      config.accessToken = response.data.access_token;
      if (response.data.refresh_token) {
        config.refreshToken = response.data.refresh_token;
      }
      if (response.data.expires_at) {
        config.tokenExpiresAt = new Date(response.data.expires_at);
      } else if (response.data.expires_in) {
        config.tokenExpiresAt = new Date(Date.now() + response.data.expires_in * 1000);
      }

      return true;
    } catch (err) {
      if (process.env.SOLID_DEBUG) {
        process.stderr.write(
          `\x1b[33m[auth]\x1b[0m token refresh failed: ${(err as Error).message}\n`,
        );
      }
      return false;
    }
  }

  // Generic HTTP methods (used by droplet, dev, etc.)
  async get<T = unknown>(
    url: string,
    options?: {
      params?: Record<string, unknown>;
      // arraybuffer → for binary downloads (PDFs, images). Others pass-through to axios.
      responseType?: 'arraybuffer' | 'blob' | 'document' | 'json' | 'text' | 'stream';
    },
  ): Promise<ApiResponse<T>> {
    const response = await this.client.get(url, options);
    return { data: response.data, status: response.status, success: true };
  }

  // Dry-run interception happens at the request-interceptor layer —
  // every mutation (incl. those using this.client.* directly) is caught.
  // The optional `idempotencyKey` lets callers (offline-queue replay,
  // `solid apply`) pin a STABLE key so re-issuing the same logical write is a
  // server-side no-op. When omitted, the request interceptor auto-generates a
  // per-call key (stable across internal retries only). See the interceptor.
  async post<T = unknown>(url: string, data?: unknown, options?: { idempotencyKey?: string }): Promise<ApiResponse<T>> {
    const response = await this.client.post(url, data, idempotencyConfig(options));
    return { data: response.data, status: response.status, success: true };
  }

  async put<T = unknown>(url: string, data?: unknown, options?: { idempotencyKey?: string }): Promise<ApiResponse<T>> {
    const response = await this.client.put(url, data, idempotencyConfig(options));
    return { data: response.data, status: response.status, success: true };
  }

  async patch<T = unknown>(url: string, data?: unknown, options?: { idempotencyKey?: string }): Promise<ApiResponse<T>> {
    const response = await this.client.patch(url, data, idempotencyConfig(options));
    return { data: response.data, status: response.status, success: true };
  }

  async delete<T = unknown>(
    url: string,
    options?: { params?: Record<string, unknown>; idempotencyKey?: string },
  ): Promise<ApiResponse<T>> {
    const response = await this.client.delete(url, {
      params: options?.params,
      ...idempotencyConfig(options),
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Auth endpoints
  async login(email: string, password: string): Promise<ApiResponse<{
    access_token: string;
    refresh_token: string;
    expires_in: number;
    user: { id: number; email: string; company_id: number };
  }>> {
    const response = await this.client.post('/api/v1/auth/login', {
      email,
      password,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async authStatus(): Promise<ApiResponse<{
    authenticated: boolean;
    user?: { id: number; email: string; company_id: number };
  }>> {
    try {
      const response = await this.client.get('/api/v1/auth/me');
      const user = response.data?.user || response.data;
      return { data: { authenticated: true, user }, status: response.status, success: true };
    } catch {
      return { data: { authenticated: false }, status: 401, success: false };
    }
  }

  // Health endpoints
  async healthQuick(): Promise<ApiResponse<{ status: string; timestamp: string }>> {
    const response = await this.client.get('/api/v1/healthcheck/quick');
    return { data: response.data, status: response.status, success: true };
  }

  async healthFull(): Promise<ApiResponse<Record<string, any>>> {
    const response = await this.client.get('/api/v1/health');
    return { data: response.data, status: response.status, success: true };
  }

  async healthMcp(): Promise<ApiResponse<{
    status: string;
    mcp_enabled: boolean;
    agents: { total_agents: number };
  }>> {
    const response = await this.client.get('/api/v1/healthcheck/mcp');
    return { data: response.data, status: response.status, success: true };
  }

  // Integration endpoints
  async integrationsCatalog(): Promise<ApiResponse<{
    internal_apis: Record<string, unknown>;
    mcp_tools: Record<string, unknown>;
    external_integrations: Record<string, unknown>;
  }>> {
    const response = await this.client.get('/api/v1/vibe/integrations/catalog');
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsList(status?: string): Promise<ApiResponse<{
    integrations: Array<{
      id: string;
      name: string;
      description: string;
      integration_type: string;
      status: string;
      created_at: string;
    }>;
    total: number;
  }>> {
    const params = status ? { status } : {};
    const response = await this.client.get('/api/v1/vibe/integrations/', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsHealth(): Promise<ApiResponse<{
    healthy: boolean;
    can_proceed: boolean;
    checks: Record<string, { status: string; message: string }>;
    warnings: string[];
  }>> {
    const response = await this.client.get('/api/v1/vibe/integrations/health');
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsGenerate(params: {
    name: string;
    description: string;
    integration_type: string;
    method?: string;
    endpoint?: string;
    tool_name?: string;
    provider?: string;
  }): Promise<ApiResponse<{
    success: boolean;
    integration: { id: string; name: string; status: string };
    code_preview: string;
  }>> {
    const response = await this.client.post('/api/v1/vibe/integrations/generate', params);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsValidate(integrationId: string): Promise<ApiResponse<{
    valid: boolean;
    issues: Array<{ severity: string; code: string; message: string }>;
    blocking_issues_count: number;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/validate/${integrationId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsTest(integrationId: string, testParams?: Record<string, unknown>): Promise<ApiResponse<{
    success: boolean;
    message: string;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/test/${integrationId}`, {
      test_params: testParams || {},
    });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsDeploy(integrationId: string): Promise<ApiResponse<{
    success: boolean;
    integration_id: string;
    status: string;
    deployed_at: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/deploy/${integrationId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsDisable(integrationId: string, reason?: string): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/disable/${integrationId}`, { reason });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsRollback(integrationId: string, reason?: string): Promise<ApiResponse<{
    success: boolean;
    status: string;
  }>> {
    const response = await this.client.post(`/api/v1/vibe/integrations/rollback/${integrationId}`, { reason });
    return { data: response.data, status: response.status, success: true };
  }

  async integrationsLogs(integrationId: string, limit = 100): Promise<ApiResponse<{
    logs: Array<{
      id: string;
      action: string;
      success: boolean;
      created_at: string;
    }>;
    total: number;
  }>> {
    const response = await this.client.get(`/api/v1/vibe/integrations/${integrationId}/logs`, {
      params: { limit },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Vibe endpoints
  async vibeAnalyze(prompt: string): Promise<ApiResponse<{
    intent: { action: string; entity_type: string };
    parsed: Record<string, unknown>;
    safety_check: { passed: boolean; blocked: boolean };
    preview_id?: string;
  }>> {
    const response = await this.client.post('/api/v1/vibe/analyze', { prompt });
    return { data: response.data, status: response.status, success: true };
  }

  async vibeApply(previewId: string): Promise<ApiResponse<{
    success: boolean;
    message: string;
    entity_id?: number;
  }>> {
    const response = await this.client.post('/api/v1/vibe/apply', {
      preview_id: previewId,
      confirm: true,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Company info
  async companyInfo(): Promise<ApiResponse<{ status: string; company: Record<string, unknown> }>> {
    const response = await this.client.post('/api/v1/rpc/Company/info', {
      query: { id: config.companyId },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // KB endpoints (via REST API)
  async kbSearch(query: string, limit = 20, offset = 0): Promise<ApiResponse<{ results: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/kb/company', {
      params: { search: query, limit, offset },
    });
    const data = response.data as Record<string, unknown>;
    return {
      data: {
        results: (data.entries || data.items || []) as unknown[],
        total: (data.total || 0) as number,
      },
      status: response.status,
      success: true,
    };
  }

  async kbCreate(params: {
    title: string;
    content: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean; id?: number }>> {
    const response = await this.client.post('/api/v1/kb/company', params);
    const data = response.data as Record<string, unknown>;
    return { data: { success: true, id: data.id as number | undefined }, status: response.status, success: true };
  }

  async kbUpdate(id: number, params: {
    title?: string;
    content?: string;
    category?: string;
  }): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.put(`/api/v1/kb/company/${id}`, params);
    void response.data; // response acknowledged
    return { data: { success: true }, status: response.status, success: true };
  }

  async kbDelete(id: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.delete(`/api/v1/kb/company/${id}`);
    void response.data;
    return { data: { success: true }, status: response.status, success: true };
  }

  // CMS Pages
  async pagesList(params?: { site_id?: number; page_type?: string }): Promise<ApiResponse<{ pages: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/cms/pages', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async pagesPublish(pageId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post(`/api/v1/cms/pages/${pageId}/publish`);
    return { data: response.data, status: response.status, success: true };
  }

  async pagesUnpublish(pageId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.post(`/api/v1/cms/pages/${pageId}/unpublish`);
    return { data: response.data, status: response.status, success: true };
  }

  // Services
  async servicesList(): Promise<ApiResponse<{ items: unknown[]; total: number }>> {
    const response = await this.client.get(`/api/v1/services/catalog`);
    return { data: response.data, status: response.status, success: true };
  }

  // Products
  async productsList(params?: { category?: string; featured_only?: boolean }): Promise<ApiResponse<{ items: unknown[]; total: number }>> {
    const companyId = config.companyId;
    const response = await this.client.get(`/api/v1/cms/public/products`, {
      params: { company_id: companyId, ...params },
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Website settings update
  async updateWebsiteSettings(settings: Record<string, unknown>): Promise<ApiResponse<unknown>> {
    const companyId = config.companyId;
    const response = await this.client.patch(`/api/v1/companies/${companyId}`, {
      website_settings: settings,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Single page (full detail with layout_json)
  async pageGet(pageId: number): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.get(`/api/v1/cms/pages/${pageId}`);
    return { data: response.data, status: response.status, success: true };
  }

  // Update page
  async pageUpdate(pageId: number, data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.patch(`/api/v1/cms/pages/${pageId}`, data);
    return { data: response.data, status: response.status, success: true };
  }

  // Create page
  async pageCreate(data: Record<string, unknown>): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.post(`/api/v1/cms/pages`, data);
    return { data: response.data, status: response.status, success: true };
  }

  // Sites (solid site)
  async sitesList(): Promise<ApiResponse<{ sites: unknown[]; count: number }>> {
    const response = await this.client.get('/api/v1/sites');
    return { data: response.data, status: response.status, success: true };
  }

  async siteGet(siteId: number): Promise<ApiResponse<{ site: Record<string, unknown> }>> {
    const response = await this.client.get(`/api/v1/sites/${siteId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async siteCreate(slug: string, template?: string, name?: string, isLive?: boolean): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.post('/api/v1/sites', {
      slug,
      template: template || 'basecamp',
      name: name || undefined,
      is_live: isLive ?? false,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async siteDelete(siteId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.delete(`/api/v1/sites/${siteId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async siteTemplates(): Promise<ApiResponse<{ templates: unknown[]; recommended: string }>> {
    const response = await this.client.get('/api/v1/sites/templates');
    return { data: response.data, status: response.status, success: true };
  }

  // Page management (additional)
  async pageDelete(pageId: number): Promise<ApiResponse<{ success: boolean }>> {
    const response = await this.client.delete(`/api/v1/cms/pages/${pageId}`);
    return { data: response.data, status: response.status, success: true };
  }

  // AI Chat (talk to agents)
  async agentChat(message: string, agentName = 'sarah'): Promise<ApiResponse<{ response: string }>> {
    const response = await this.client.post('/api/v1/chat/', {
      message,
      agent: agentName,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // Templates (solid clone)
  async templatesList(): Promise<ApiResponse<{ templates: unknown[]; total: number }>> {
    const response = await this.client.get('/api/v1/cli/templates/');
    return { data: response.data, status: response.status, success: true };
  }

  async templatePreview(name: string): Promise<ApiResponse<Record<string, unknown>>> {
    const response = await this.client.get(`/api/v1/cli/templates/${name}`);
    return { data: response.data, status: response.status, success: true };
  }

  async templateClone(name: string): Promise<ApiResponse<{
    success: boolean;
    template: string;
    display_name: string;
    created: { kb_entries: number; pages?: number; services?: number };
  }>> {
    const response = await this.client.post(`/api/v1/cli/templates/${name}/clone`);
    return { data: response.data, status: response.status, success: true };
  }

  // Multi-company (CLI Agency)
  async companiesList(): Promise<ApiResponse<{
    companies: Array<{ id: number; name: string; role: string; is_active: boolean; joined_at?: string }>;
    active_company_id: number;
    count: number;
  }>> {
    const response = await this.client.get('/api/v1/cli/companies/');
    return { data: response.data, status: response.status, success: true };
  }

  async companyCreate(name: string, template?: string, industry?: string): Promise<ApiResponse<{
    status: string;
    company: { id: number; name: string; slug: string };
    membership: { role: string };
    template?: unknown;
  }>> {
    const response = await this.client.post('/api/v1/cli/companies/', { name, template, industry });
    return { data: response.data, status: response.status, success: true };
  }

  async companySwitch(companyId: number): Promise<ApiResponse<{
    status: string;
    company: { id: number; name: string };
    role: string;
    access_token: string;
    refresh_token: string;
    expires_in: number;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/switch`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyMembers(companyId: number): Promise<ApiResponse<{
    company_id: number;
    members: Array<{ user_id: number; email: string; name?: string; role: string; joined_at?: string }>;
    count: number;
  }>> {
    const response = await this.client.get(`/api/v1/cli/companies/${companyId}/members`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyMemberRevoke(companyId: number, userId: number): Promise<ApiResponse<{
    status: string;
    message: string;
    company_id: number;
    user_id: number;
  }>> {
    const response = await this.client.delete(`/api/v1/cli/companies/${companyId}/members/${userId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyInvite(companyId: number, email: string, role = 'developer'): Promise<ApiResponse<{
    status: string;
    message: string;
    token?: string;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/invite`, { email, role });
    return { data: response.data, status: response.status, success: true };
  }

  // ── T10 — Agency-managed companies + design-lock ─────────────────
  async companyCreateForClient(payload: {
    name: string;
    client_email: string;
    client_name?: string;
    industry?: string;
    template?: string;
    initial_unlocked_areas?: string[];
  }): Promise<ApiResponse<{
    status: string;
    company: { id: number; name: string; slug: string };
    agency: { company_id: number; agency_managed: boolean; agency_owner_user_id: number; locks: Record<string, boolean> };
    invitation: { sent: boolean; invitation_id?: number; token?: string; expires_at?: string };
    next_steps: string[];
  }>> {
    const response = await this.client.post('/api/v1/cli/companies/for-client', payload);
    return { data: response.data, status: response.status, success: true };
  }

  async companyLockStatus(companyId: number): Promise<ApiResponse<{
    company_id: number;
    agency_managed: boolean;
    agency_owner_user_id: number | null;
    locks: Record<string, boolean>;
  }>> {
    const response = await this.client.get(`/api/v1/cli/companies/${companyId}/lock-status`);
    return { data: response.data, status: response.status, success: true };
  }

  async companyLock(companyId: number, areas: string[]): Promise<ApiResponse<{
    company_id: number;
    agency_managed: boolean;
    agency_owner_user_id: number;
    locks: Record<string, boolean>;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/lock`, { areas });
    return { data: response.data, status: response.status, success: true };
  }

  async companyUnlock(companyId: number, areas: string[], all = false): Promise<ApiResponse<{
    company_id: number;
    agency_managed: boolean;
    agency_owner_user_id: number;
    locks: Record<string, boolean>;
  }>> {
    const body: Record<string, unknown> = { all };
    if (!all) body.areas = areas;
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/unlock`, body);
    return { data: response.data, status: response.status, success: true };
  }

  async companyRequestUnlock(companyId: number, areas: string[], reason: string): Promise<ApiResponse<{
    status: string;
    company_id: number;
    areas: string[];
    agency_owner_user_id: number;
    message: string;
  }>> {
    const response = await this.client.post(`/api/v1/cli/companies/${companyId}/request-unlock`, {
      areas,
      reason,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // ── Tenant Activity Gate ────────────────────────────────────────────────
  // See Owners-Manual/06-Operations/TENANT-ACTIVITY-GATE/ for the full spec.

  async tenantGateMine(): Promise<ApiResponse<TenantGateDecision>> {
    const response = await this.client.get('/api/v1/tenant/my-gate-level');
    return { data: response.data as TenantGateDecision, status: response.status, success: true };
  }

  async tenantGateAdminDebug(companyId: number): Promise<ApiResponse<TenantGateDecision>> {
    const response = await this.client.get(`/api/v1/admin/tenant-gate/${companyId}`);
    return { data: response.data as TenantGateDecision, status: response.status, success: true };
  }

  async tenantGateAdminActive(min: string): Promise<ApiResponse<{
    min_level: string;
    count: number;
    company_ids: number[];
  }>> {
    const response = await this.client.get('/api/v1/admin/tenant-gate/active', {
      params: { min },
    });
    return { data: response.data as { min_level: string; count: number; company_ids: number[] }, status: response.status, success: true };
  }

  async tenantGateAdminAllowlist(): Promise<ApiResponse<{
    hardcoded_ids: number[];
    billing_exempt: Array<{ id: number; name: string }>;
  }>> {
    const response = await this.client.get('/api/v1/admin/tenant-gate/allowlist');
    return { data: response.data as { hardcoded_ids: number[]; billing_exempt: Array<{ id: number; name: string }> }, status: response.status, success: true };
  }

  // ── Q-Chain — External auditor surface ──────────────────────────────────
  // See Owners-Manual/75-Qchain/08-EXTERNAL-AUDITOR-FLOW.md

  async qchainWellKnown(): Promise<ApiResponse<QChainWellKnown>> {
    // Anonymous endpoint — uses platform host, no auth required, no token leak.
    const response = await this.client.get('/.well-known/qchain.json');
    return { data: response.data as QChainWellKnown, status: response.status, success: true };
  }

  async qchainExport(params: { since?: string; until?: string; limit?: number }): Promise<ApiResponse<QChainExportResult>> {
    const response = await this.client.get('/api/v1/predictions/substrate/export', { params });
    return { data: response.data as QChainExportResult, status: response.status, success: true };
  }

  async qchainVerify(limit?: number): Promise<ApiResponse<QChainVerifyResult>> {
    const response = await this.client.get('/api/v1/predictions/substrate/verify', {
      params: limit ? { limit } : {},
    });
    return { data: response.data as QChainVerifyResult, status: response.status, success: true };
  }

  // CLI API Keys
  async apiKeyCreate(name: string, scopes: string[], expiresInDays?: number): Promise<ApiResponse<{
    status: string;
    key: string;
    warning: string;
    api_key: { id: number; name: string; key_prefix: string; scopes: string[] };
  }>> {
    const response = await this.client.post('/api/v1/cli/api-keys/', {
      name,
      scopes,
      expires_in_days: expiresInDays,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async apiKeyList(): Promise<ApiResponse<{
    api_keys: Array<{ id: number; name: string; key_prefix: string; scopes: string[]; is_active: boolean; last_used_at?: string }>;
    count: number;
    available_scopes: string[];
  }>> {
    const response = await this.client.get('/api/v1/cli/api-keys/');
    return { data: response.data, status: response.status, success: true };
  }

  async apiKeyRevoke(keyId: number): Promise<ApiResponse<{ status: string; id: number }>> {
    const response = await this.client.delete(`/api/v1/cli/api-keys/${keyId}`);
    return { data: response.data, status: response.status, success: true };
  }

  // Agent management endpoints
  async agentsList(): Promise<ApiResponse<{
    agents: Array<{
      agent_type: string;
      name: string;
      description: string;
      autonomy_level: number;
      tool_count: number;
    }>;
    total: number;
  }>> {
    // Trailing slash required — without it FastAPI returns 307 redirect
    // and axios/follow-redirects strips the Authorization header, causing
    // spurious 401s under SOLID_API_KEY auth. Verified 2026-04-19.
    const response = await this.client.get('/api/v1/cli/agents/');
    return { data: response.data, status: response.status, success: true };
  }

  async agentDetail(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    name: string;
    description: string;
    autonomy_level: number;
    system_prompt: string;
    features: Record<string, boolean>;
    approval_thresholds: Record<string, number>;
    tools: string[];
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}`);
    return { data: response.data, status: response.status, success: true };
  }

  async agentTools(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    tools: Record<string, string[]>;
    total: number;
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}/tools`);
    return { data: response.data, status: response.status, success: true };
  }

  async agentData(agentType: string): Promise<ApiResponse<{
    agent_type: string;
    performance: {
      total_reflections: number;
      avg_score: number;
      pass_rate: number;
    };
    reflections: Array<{
      id: number;
      score: number;
      passed: boolean;
      notes: string;
      criteria_scores: Record<string, number>;
      tools_used: string[];
      created_at: string;
    }>;
  }>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}/data`);
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationDashboard(): Promise<ApiResponse<{
    agents: Array<{
      id: number;
      name: string;
      agent_type: string;
      status: string;
      current_task_id: string | null;
      last_active: string | null;
      tasks_today: number;
    }>;
    active_tasks: number;
    total_agents: number;
  }>> {
    const response = await this.client.get('/api/orchestration/dashboard');
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAgents(statusFilter?: string): Promise<ApiResponse<{
    agents: Array<{
      id: number;
      name: string;
      agent_type: string;
      status: string;
      last_active: string | null;
      tasks_today: number;
      tasks_failed_today: number;
    }>;
  }>> {
    const params = statusFilter ? { status_filter: statusFilter } : {};
    const response = await this.client.get('/api/orchestration/agents', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAgentDetail(agentId: number): Promise<ApiResponse<{
    agent: {
      name: string;
      role: string;
      status: string;
      current_task_id: string | null;
      last_active: string;
      tasks_today: number;
      avg_response_time: number;
      total_tasks: number;
      performance_30d: {
        total_tasks: number;
        completed: number;
        failed: number;
        success_rate: number;
        avg_response_time: number;
      };
    };
  }>> {
    const response = await this.client.get(`/api/orchestration/agents/${agentId}`);
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationDelegate(agentId: number, task: string, priority?: number): Promise<ApiResponse<{
    task_id: string;
    status: string;
    agent_id: number;
  }>> {
    const response = await this.client.post('/api/orchestration/delegate', {
      agent_id: agentId,
      task,
      priority: priority || 5,
    });
    return { data: response.data, status: response.status, success: true };
  }

  async orchestrationAnalytics(days?: number): Promise<ApiResponse<{
    period_days: number;
    total_tasks: number;
    completed: number;
    failed: number;
    success_rate: number;
    avg_response_time: number;
    top_agents: Array<{ name: string; tasks: number; success_rate: number }>;
  }>> {
    const params = days ? { days } : {};
    const response = await this.client.get('/api/orchestration/analytics', { params });
    return { data: response.data, status: response.status, success: true };
  }

  // Dragon — Mission orchestration
  async missionCreate(mission: string, agentIds?: number[]): Promise<ApiResponse<{
    mission_id: string;
    status: string;
    steps: Array<{
      step_index: number;
      agent_id: number;
      agent_name: string;
      task: string;
      status: string;
    }>;
    conversation_id: string;
  }>> {
    const body: Record<string, unknown> = { mission };
    if (agentIds && agentIds.length > 0) body.agent_ids = agentIds;
    const response = await this.client.post('/api/v1/agents/missions', body);
    return { data: response.data, status: response.status, success: true };
  }

  async missionExecute(missionId: string): Promise<ApiResponse<{
    status: string;
    mission_id: string;
    steps_dispatched: number;
    results: Array<{
      step_index: number;
      agent_name: string;
      status: string;
      response?: string;
    }>;
  }>> {
    const response = await this.client.post(`/api/v1/agents/missions/${missionId}/execute`);
    return { data: response.data, status: response.status, success: true };
  }

  // Dragon — Telemetry
  async telemetrySummary(): Promise<ApiResponse<{
    total_tokens: number;
    avg_latency_ms: number;
    estimated_cost: number;
    revenue_attributed: number;
    active_agents: number;
    missions_active: number;
  }>> {
    const response = await this.client.get('/api/v1/telemetry/agents/summary');
    return { data: response.data, status: response.status, success: true };
  }
  // =========================================================================
  // CLI History & Rollback
  // =========================================================================

  async historyPages(slug?: string, limit = 50): Promise<ApiResponse<unknown>> {
    const url = slug ? `/api/v1/cli/history/pages/${slug}` : '/api/v1/cli/history/pages';
    const response = await this.client.get(url, { params: { limit } });
    return { data: response.data, status: response.status, success: true };
  }

  async historyPageVersion(slug: string, version: number): Promise<ApiResponse<unknown>> {
    const response = await this.client.get(`/api/v1/cli/history/pages/${slug}/${version}`);
    return { data: response.data, status: response.status, success: true };
  }

  async rollbackPage(slug: string, version: number): Promise<ApiResponse<unknown>> {
    const response = await this.client.post(`/api/v1/cli/history/pages/${slug}/rollback`, { version });
    return { data: response.data, status: response.status, success: true };
  }

  async historyKB(entryId?: number, limit = 50): Promise<ApiResponse<unknown>> {
    const url = entryId ? `/api/v1/cli/history/kb/${entryId}` : '/api/v1/cli/history/kb';
    const response = await this.client.get(url, { params: { limit } });
    return { data: response.data, status: response.status, success: true };
  }

  async rollbackKB(entryId: number, version: number): Promise<ApiResponse<unknown>> {
    const response = await this.client.post(`/api/v1/cli/history/kb/${entryId}/rollback`, { version });
    return { data: response.data, status: response.status, success: true };
  }

  async createSnapshot(source = 'cli', changeSummary?: string): Promise<ApiResponse<unknown>> {
    const response = await this.client.post('/api/v1/cli/history/snapshot', {
      source,
      change_summary: changeSummary,
    });
    return { data: response.data, status: response.status, success: true };
  }

  // =========================================================================
  // CLI Preview Deployments
  // =========================================================================

  async previewCreate(options: {
    title?: string;
    ttl_hours?: number;
    pages_only?: boolean;
    kb_only?: boolean;
  } = {}): Promise<ApiResponse<unknown>> {
    const response = await this.client.post('/api/v1/cli/preview', options);
    return { data: response.data, status: response.status, success: true };
  }

  async previewList(status?: string, limit = 20): Promise<ApiResponse<unknown>> {
    const params: Record<string, unknown> = { limit };
    if (status) params.status = status;
    const response = await this.client.get('/api/v1/cli/preview', { params });
    return { data: response.data, status: response.status, success: true };
  }

  async previewGet(token: string): Promise<ApiResponse<unknown>> {
    const response = await this.client.get(`/api/v1/cli/preview/${token}`);
    return { data: response.data, status: response.status, success: true };
  }

  async previewPromote(token: string): Promise<ApiResponse<unknown>> {
    const response = await this.client.post(`/api/v1/cli/preview/${token}/promote`, { confirm: true });
    return { data: response.data, status: response.status, success: true };
  }

  async previewExpire(token: string): Promise<ApiResponse<unknown>> {
    const response = await this.client.delete(`/api/v1/cli/preview/${token}`);
    return { data: response.data, status: response.status, success: true };
  }

  // =========================================================================
  // CLI Agent Logs & Testing
  // =========================================================================

  async agentLogs(agentType?: string, options: { hours?: number; limit?: number; event_type?: string } = {}): Promise<ApiResponse<unknown>> {
    const url = agentType ? `/api/v1/cli/agents/${agentType}/logs` : '/api/v1/cli/agents/logs';
    const response = await this.client.get(url, { params: options });
    return { data: response.data, status: response.status, success: true };
  }

  async agentErrors(agentType: string, hours = 24, limit = 50): Promise<ApiResponse<unknown>> {
    const response = await this.client.get(`/api/v1/cli/agents/${agentType}/logs/errors`, { params: { hours, limit } });
    return { data: response.data, status: response.status, success: true };
  }

  async agentTest(options: {
    agent_type: string;
    prompt: string;
    assertions?: string[];
    not_assertions?: string[];
    timeout_seconds?: number;
  }): Promise<ApiResponse<unknown>> {
    const response = await this.client.post('/api/v1/cli/agents/test', options);
    return { data: response.data, status: response.status, success: true };
  }

  async agentTestResults(hours = 24, limit = 50): Promise<ApiResponse<unknown>> {
    const response = await this.client.get('/api/v1/cli/agents/test/results', { params: { hours, limit } });
    return { data: response.data, status: response.status, success: true };
  }

  // =========================================================================
  // CLI Company Migration
  // =========================================================================

  async migratePreview(options: {
    source_company_id: number;
    target_company_id: number;
    include_pages?: boolean;
    include_kb?: boolean;
    include_settings?: boolean;
    page_slugs?: string[];
    kb_ids?: number[];
    overwrite_existing?: boolean;
  }): Promise<ApiResponse<unknown>> {
    const response = await this.client.post('/api/v1/cli/migrate/preview', options);
    return { data: response.data, status: response.status, success: true };
  }

  async migrateExecute(options: {
    source_company_id: number;
    target_company_id: number;
    include_pages?: boolean;
    include_kb?: boolean;
    include_settings?: boolean;
    page_slugs?: string[];
    kb_ids?: number[];
    overwrite_existing?: boolean;
  }): Promise<ApiResponse<unknown>> {
    const response = await this.client.post('/api/v1/cli/migrate/execute', options);
    return { data: response.data, status: response.status, success: true };
  }
}

export const apiClient = new ApiClient();

// Redact Bearer tokens + common secret-looking strings from any message the
// CLI might print. Belt-and-suspenders — tokens should never end up in error
// strings in the first place, but if they do, we don't leak them to logs.
function redactSecrets(s: string): string {
  return s
    .replace(/Bearer\s+[A-Za-z0-9._\-=]{6,}/g, 'Bearer ***')
    .replace(/(sk_|pk_|rk_|pat_|tok_)[A-Za-z0-9_\-]{6,}/g, '$1***')
    .replace(/(password|secret|apikey|api_key|token)=([^&\s]+)/gi, '$1=***');
}

// Flatten a FastAPI 422 detail array into "field: reason; field: reason".
function flattenValidation(detail: unknown): string {
  if (!Array.isArray(detail)) return String(detail ?? 'Validation failed');
  return detail
    .map((d) => {
      if (d && typeof d === 'object') {
        const loc = Array.isArray((d as any).loc)
          // FastAPI prepends "body" / "query" / "path" — drop it; the user
          // doesn't care, they just want the field name.
          ? (d as any).loc.filter((p: unknown) => p !== 'body' && p !== 'query' && p !== 'path').join('.')
          : '';
        const msg = (d as any).msg || JSON.stringify(d);
        return loc ? `${loc}: ${msg}` : msg;
      }
      return String(d);
    })
    .join('; ');
}

// Sprint 1 T1.1 — pure structured classifier + envelope.
import { classifyError, type ClassifiedError } from './error-codes';

export function handleApiError(error: unknown): ApiError {
  // Non-axios errors: plain Error or unknown. Return as-is with light redaction.
  if (!axios.isAxiosError(error)) {
    const raw = error instanceof Error ? error.message : 'Unknown error';
    const classified = classifyError({ status: 500 });
    return enrichApiError({ message: redactSecrets(raw), status: 500 }, classified);
  }

  const axiosError = error as AxiosError<{
    detail?: unknown;
    message?: string;
    error?: string;
    // Backend feature-gate middleware adds these on 403s.
    // AI agents (Claude, Cursor) rely on them to distinguish a tier limit
    // from an actual bug — without this, they'll file a "403 Forbidden" issue.
    code?: string;
    feature?: string;
    upgrade_to?: string;
  }>;
  const status = axiosError.response?.status ?? 0;
  const method = (axiosError.config?.method || 'GET').toUpperCase();
  const url = axiosError.config?.url || '';

  // Extract the server's own message first — most actionable.
  const d = axiosError.response?.data;
  const rawDetail = d?.detail ?? d?.message ?? d?.error ?? '';
  let serverMessage =
    typeof rawDetail === 'string'
      ? rawDetail
      : Array.isArray(rawDetail)
        ? flattenValidation(rawDetail)
        : rawDetail && typeof rawDetail === 'object'
          ? JSON.stringify(rawDetail)
          : '';

  serverMessage = redactSecrets(serverMessage);

  // Network-layer failures (no response): most common culprit is "offline"
  // or "wrong SOLID_API_URL". Don't parrot "Network Error" — say what to do.
  if (!axiosError.response) {
    const host = (() => { try { return new URL(url, 'http://x').host || 'unknown'; } catch { return 'unknown'; } })();
    const hint = process.env.SOLID_API_URL
      ? ` (SOLID_API_URL=${process.env.SOLID_API_URL})`
      : '';
    const baseErr: ApiError = {
      message:
        axiosError.code === 'ECONNABORTED'
          ? `Request timed out after ${axiosError.config?.timeout ?? 30000}ms. Try --timeout=60, or check: solid health`
          : `Couldn't reach the Solid# backend${hint}. Check network, or run: solid health`,
      status: 0,
    };
    // T1.1 BUG-4 fix: classify network errors too so the JSON envelope
    // emits code=NETWORK_ERROR / TIMEOUT instead of falling through to
    // the SERVER_ERROR default. Without this, agents can't distinguish
    // "backend is down" from "backend returned 500".
    const classified = classifyError({
      status: 0,
      networkErrorCode: axiosError.code,
    });
    return enrichApiError(baseErr, classified);
  }

  // Status-code-specific hints. These make the CLI *feel* world-class —
  // users know what to do next, not just "something broke".
  let message: string;
  switch (status) {
    case 401:
      message = serverMessage
        ? `Not authenticated: ${serverMessage}. Run: solid auth login`
        : `Not authenticated. Run: solid auth login (or set SOLID_TOKEN)`;
      break;
    case 403:
      // When the backend signals a tier-gate explicitly, emit a structured
      // message so AI agents (Claude/Cursor) recognize it as an upgrade path,
      // not an application bug worth filing.
      if (d?.code === 'FEATURE_GATED' && d?.feature) {
        const required = d.upgrade_to ? ` (requires ${d.upgrade_to} tier)` : '';
        message =
          `Tier limit: the ${d.feature} feature${required} is not on your current plan. ` +
          `This is a subscription limit, not a bug. ` +
          `Run: solid whoami --features  ·  Upgrade: solid upgrade`;
      } else {
        message = serverMessage
          ? `Forbidden: ${serverMessage}. Check your tier: solid whoami --features`
          : `Forbidden. Your subscription tier may not include this. Check: solid whoami --features`;
      }
      break;
    case 404:
      message = serverMessage
        ? `Not found: ${serverMessage}`
        : `Not found: ${method} ${url}. Check the ID, or: solid api list`;
      break;
    case 409:
      message = serverMessage
        ? `Conflict: ${serverMessage}`
        : `Conflict — this resource already exists or is in an incompatible state`;
      break;
    case 422:
      message = serverMessage
        ? `Validation failed — ${serverMessage}`
        : `Validation failed. Run with --help to see required flags`;
      break;
    case 429:
      message = `Rate limited. The CLI retries automatically; if you see this, the retries were exhausted. Slow down or run with --timeout=60`;
      break;
    case 500:
    case 502:
    case 503:
    case 504:
      message = serverMessage
        ? `Solid# backend error (${status}): ${serverMessage}. Try again, or: solid health`
        : `Solid# backend error (${status}). Try again, or: solid health`;
      break;
    default:
      message = serverMessage || axiosError.message || `Request failed (${status})`;
      break;
  }

  // --debug: append the request context so users can reproduce with curl.
  if (process.env.SOLID_DEBUG === '1' || process.argv.includes('--debug')) {
    const bodyPreview =
      axiosError.config?.data
        ? ` body=${redactSecrets(typeof axiosError.config.data === 'string' ? axiosError.config.data : JSON.stringify(axiosError.config.data)).slice(0, 200)}`
        : '';
    message += `\n  [debug] ${method} ${url} → ${status}${bodyPreview}`;
  }

  // T1.1 — attach structured classification for agents / --json consumers.
  const requestId =
    (axiosError.response?.headers?.['x-request-id'] as string | undefined) ||
    (axiosError.response?.headers?.['X-Request-ID'] as string | undefined);
  const classified = classifyError({
    status,
    data: axiosError.response?.data,
    networkErrorCode: axiosError.code,
    requestId,
  });
  return enrichApiError({ message, status }, classified);
}

/**
 * Print an API error to stderr and exit non-zero.
 *
 * `handleApiError` only RETURNS an ApiError — it doesn't print or
 * throw. Every catch-block that called `handleApiError(e)` and then
 * fell out of scope was silently swallowing the failure, leaving AI
 * agents that parse stdout with exit 0 + empty output and the
 * (incorrect) inference that the call succeeded.
 *
 * Use `failApi(e)` in every catch block where you'd otherwise have
 * called `handleApiError(e)` alone. The `never` return type lets
 * TypeScript know nothing after it is reachable.
 *
 * Caught + fixed 2026-05-22 after `solid verbs invoke` reported
 * exit 0 on a 502 outage.
 */
export function failApi(error: unknown): never {
  // Local require to avoid forcing every importer to pull chalk just
  // for the type. Chalk is already a transitive dep of every CLI cmd.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chalk = require('chalk');
  const err = handleApiError(error);
  process.stderr.write(chalk.red(err.message || 'Request failed.') + '\n');
  if (err.hint) process.stderr.write(chalk.dim(err.hint) + '\n');
  if (err.docs_url) process.stderr.write(chalk.dim(`  see: ${err.docs_url}`) + '\n');
  process.exit(1);
}

/** Copy structured fields from a ClassifiedError onto an ApiError. Pure. */
function enrichApiError(err: ApiError, c: ClassifiedError): ApiError {
  err.code = c.code;
  if (c.hint) err.hint = c.hint;
  if (c.docs_url) err.docs_url = c.docs_url;
  if (c.scope) err.scope = c.scope;
  if (c.feature) err.feature = c.feature;
  if (c.upgrade_to) err.upgrade_to = c.upgrade_to;
  if (c.request_id) err.request_id = c.request_id;
  return err;
}
