/**
 * Server-side sandbox over the agent verbs.
 *
 * `solid sandbox fork/status/diff/promote/exit/preview` used to call
 * `/api/v1/sandbox/{status,enabled,publish,exit}` — routes that resolve the
 * tenant from the Host header ("sandbox.acme.solidnumber.com"). Through
 * api.solidnumber.com they answered 404 "No tenant found for this domain" for
 * EVERY company. The sandbox.* verbs are the working surface, scoped by the
 * caller's credential, and are what HTTP-verb and MCP agents already use, so
 * every transport now shares one sandbox:
 *
 *   POST /api/v1/agent/sandbox/{fork,status,diff,promote,exit}
 *
 * Pure (no chalk/ora) so it is unit-testable.
 */

export interface VerbClient {
  post(url: string, body?: unknown): Promise<{ data: unknown }>;
}

export interface SandboxStatus {
  active: boolean;
  status?: string;
  session_token?: string;
  scope?: Record<string, unknown> | null;
  created_at?: string | null;
}

export interface SandboxPageChange {
  entity_type: string;
  entity_id: number;
  change?: 'created' | 'edited' | string;
  title?: string | null;
  slug?: string | null;
  fields?: string[];
  publish_on_promote?: boolean | null;
  filename?: string | null;
}

export interface SandboxDiff {
  status?: string;
  session_token?: string;
  changes: SandboxPageChange[] | Array<Record<string, unknown>>;
  pages?: SandboxPageChange[];
  assets?: SandboxPageChange[];
  total_changes?: number;
}

/** The verb surface answers either bare or as {ok, verb, result}. */
export function unwrapVerb<T = Record<string, unknown>>(data: unknown): T {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if ('result' in d && d.result && typeof d.result === 'object' && ('ok' in d || 'verb' in d)) {
      return d.result as T;
    }
  }
  return (data ?? {}) as T;
}

const VERB = (name: string) => `/api/v1/agent/sandbox/${name}`;

export async function sandboxStatus(client: VerbClient): Promise<SandboxStatus> {
  const r = unwrapVerb<SandboxStatus>((await client.post(VERB('status'), {})).data);
  return { ...r, active: Boolean(r.active) };
}

/** Writes carry `confirm: true` — running the command IS the caller's consent. */
export async function sandboxFork(client: VerbClient, scope?: Record<string, boolean> | null) {
  const body: Record<string, unknown> = { confirm: true };
  if (scope) body.scope = scope;
  return unwrapVerb((await client.post(VERB('fork'), body)).data);
}

export async function sandboxDiff(client: VerbClient): Promise<SandboxDiff> {
  const r = unwrapVerb<SandboxDiff>((await client.post(VERB('diff'), {})).data);
  return { ...r, changes: r.changes || [] };
}

export async function sandboxPromote(client: VerbClient) {
  return unwrapVerb((await client.post(VERB('promote'), { confirm: true })).data);
}

export async function sandboxExit(client: VerbClient) {
  return unwrapVerb((await client.post(VERB('exit'), { confirm: true })).data);
}

/** `--scope pages|data|all` → the verb's scope object. */
export function scopeFromFlag(flag: string | undefined): Record<string, boolean> | null {
  switch ((flag || 'all').toLowerCase()) {
    case 'pages': return { pages: true, assets: true, kb: false, data: false };
    case 'data': return { pages: false, assets: false, kb: false, data: true };
    case 'all': return null; // server default: everything
    default: throw new Error(`Unknown --scope "${flag}". Use pages, data or all.`);
  }
}

/** The page entries of a diff, whatever server version produced it. */
export function pageChanges(diff: SandboxDiff): SandboxPageChange[] {
  if (Array.isArray(diff.pages)) return diff.pages;
  return (diff.changes as SandboxPageChange[]).filter((c) => c && c.entity_type === 'website_page');
}

/** One human line per change. */
export function diffLines(diff: SandboxDiff): string[] {
  const out: string[] = [];
  for (const c of diff.changes as SandboxPageChange[]) {
    if (!c) continue;
    if (c.entity_type === 'website_page') {
      const mark = c.change === 'created' ? '+' : '~';
      const name = c.slug ? `/${String(c.slug).replace(/^\//, '')}` : `page ${c.entity_id}`;
      const fields = c.fields && c.fields.length ? ` (${c.fields.join(', ')})` : '';
      const pub = c.publish_on_promote ? ' — publishes on promote' : '';
      out.push(`${mark} page #${c.entity_id} ${name}${c.title ? ` "${c.title}"` : ''}${fields}${pub}`);
    } else if (c.entity_type === 'asset') {
      out.push(`+ asset #${c.entity_id}${c.filename ? ` ${c.filename}` : ''}`);
    } else {
      const v = (c as unknown as Record<string, unknown>).verb_name;
      out.push(`~ ${c.entity_type} #${c.entity_id}${v ? ` (${v})` : ''}`);
    }
  }
  return out;
}

/** Join the API base and a relative preview path the backend returns. */
export function absoluteUrl(apiBase: string, p: string): string {
  if (/^https?:\/\//i.test(p)) return p;
  return `${apiBase.replace(/\/+$/, '')}/${p.replace(/^\/+/, '')}`;
}

export const NO_SANDBOX_MESSAGE =
  'No active sandbox for this company. Run `solid sandbox fork` first — nothing to preview.';
