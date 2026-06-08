/**
 * @solidnumber/cli/client — programmatic capability surface.
 *
 * Embed the Solid# platform in another Node program instead of shelling out to
 * the `solid` binary or re-implementing against raw HTTP. This wraps the same
 * api-client the CLI uses, so you inherit idempotency keys, token refresh, the
 * typed error envelope, dry-run, and agent headers — and adds the high-level
 * capabilities (verb dispatch + declarative apply) on top.
 *
 *   import { createSolidClient } from '@solidnumber/cli/client';
 *   const solid = createSolidClient({ apiKey: process.env.SOLID_API_KEY });
 *   await solid.dispatch('crm_lead_promote', { contact_id: 1 });
 *   const report = await solid.apply(fs.readFileSync('infra.yaml', 'utf8'));
 *
 * Auth resolves exactly like the CLI: SOLID_API_KEY (or an existing
 * `solid auth login` session), SOLID_COMPANY_ID, SOLID_API_URL. Passing
 * `apiKey`/`companyId` here sets those for the process. Note: `apiUrl` is read
 * once when the api-client module first loads, so to target a non-default host
 * set SOLID_API_URL in the environment BEFORE importing this module.
 */
import { apiClient } from './lib/api-client';
import { parseManifest, reconcile, ReconcileOptions, ReconcileReport } from './lib/apply/engine';
import { knownKinds } from './lib/apply/registry';

export interface SolidClientOptions {
  /** API key (sk_…) or JWT. Sets SOLID_API_KEY for the process. */
  apiKey?: string;
  /** Tenant to operate on. Sets SOLID_COMPANY_ID for the process. */
  companyId?: number | string;
  /** Base URL. Only honored if set before the api-client module loaded — prefer the SOLID_API_URL env var. */
  apiUrl?: string;
}

export interface DispatchOptions {
  /** Required for write verbs — the equivalent of clicking Confirm in the UI. */
  confirm?: boolean;
  /** Typed-phrase confirmation for WRITE_FINANCIAL / IRREVERSIBLE verbs. */
  typedPhrase?: string;
}

export interface SolidClient {
  get<T = unknown>(url: string): Promise<T>;
  post<T = unknown>(url: string, body?: unknown): Promise<T>;
  put<T = unknown>(url: string, body?: unknown): Promise<T>;
  patch<T = unknown>(url: string, body?: unknown): Promise<T>;
  del<T = unknown>(url: string): Promise<T>;
  /** Invoke any platform verb (the universal capability surface). */
  dispatch<T = unknown>(verb: string, args?: Record<string, unknown>, opts?: DispatchOptions): Promise<T>;
  /** List the available platform verbs. */
  listVerbs<T = unknown>(): Promise<T>;
  /** Reconcile a YAML/JSON manifest (or pre-parsed resources) to desired state. */
  apply(manifest: string, opts?: ReconcileOptions): Promise<ReconcileReport>;
  /** Poll the company event stream once. */
  signalTail<T = unknown>(opts?: { topic?: string; sinceId?: number; limit?: number }): Promise<T>;
  /** Resource kinds `apply` understands. */
  applyKinds(): string[];
}

export function createSolidClient(options: SolidClientOptions = {}): SolidClient {
  if (options.apiKey) process.env.SOLID_API_KEY = options.apiKey;
  if (options.companyId !== undefined && options.companyId !== null) {
    process.env.SOLID_COMPANY_ID = String(options.companyId);
  }
  if (options.apiUrl && !process.env.SOLID_API_URL) process.env.SOLID_API_URL = options.apiUrl;

  return {
    async get<T>(url: string) { return (await apiClient.get<T>(url)).data; },
    async post<T>(url: string, body?: unknown) { return (await apiClient.post<T>(url, body)).data; },
    async put<T>(url: string, body?: unknown) { return (await apiClient.put<T>(url, body)).data; },
    async patch<T>(url: string, body?: unknown) { return (await apiClient.patch<T>(url, body)).data; },
    async del<T>(url: string) { return (await apiClient.delete<T>(url)).data; },

    async dispatch<T>(verb: string, args: Record<string, unknown> = {}, opts: DispatchOptions = {}) {
      const res = await apiClient.post<T>('/api/v1/ada/cli-dispatch', {
        verb,
        args,
        confirm: !!opts.confirm,
        typed_phrase: opts.typedPhrase ?? null,
      });
      return res.data;
    },

    async listVerbs<T>() { return (await apiClient.get<T>('/api/v1/agent/verbs')).data; },

    async apply(manifest: string, opts: ReconcileOptions = {}) {
      const resources = parseManifest(manifest);
      // apiClient satisfies the ApplyClient surface (get/post/put/patch/delete
      // with idempotency-key options), so the reconcile inherits idempotency.
      return reconcile(apiClient, resources, opts);
    },

    async signalTail<T>(opts: { topic?: string; sinceId?: number; limit?: number } = {}) {
      const qs = new URLSearchParams({ topic: opts.topic ?? 'agent.any', limit: String(opts.limit ?? 50) });
      if (opts.sinceId !== undefined) qs.set('since_id', String(opts.sinceId));
      return (await apiClient.get<T>(`/api/v1/signal/tail?${qs.toString()}`)).data;
    },

    applyKinds() { return knownKinds(); },
  };
}
