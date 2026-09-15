/**
 * Keep the MCP credential pointing at the company the CLI is actually on.
 *
 * ⛔ WHY — 2026-09-15.
 *
 * `claude` reads the MCP server config in ~/.claude.json, which holds a STATIC
 * API key. The backend takes the tenant from the key record. Logging in — or
 * switching — writes ~/.solid/config.json, a file the MCP server never opens.
 *
 * So the agent served whatever company that key was minted for, forever, and no
 * login could change it. An operator logged in for one company, typed `claude`,
 * and got a confident session about a different one.
 *
 * This closes the loop: after login/switch, if the MCP key resolves to a
 * different company than the session, mint a key for the RIGHT company and
 * rewrite the config. Idempotent — a matching key is left alone, so this does
 * not pile up keys against the 25-per-company cap.
 */

import * as fs from 'fs';

import {
  configPathForClient,
  buildServerEntry,
  mergeIntoConfig,
  serializeConfig,
  type McpClient,
} from './mcp-client-config';
import { readMcpApiKey, resolveKeyCompany } from './mcp-tenant-check';

/** Clients whose config `claude` / the VS Code extension actually read. */
const SYNC_CLIENTS: McpClient[] = ['vscode', 'claude'];

export interface McpSyncResult {
  /** 'ok' — already correct. 'updated' — rewritten. 'skipped' — nothing to do. */
  status: 'ok' | 'updated' | 'skipped' | 'failed';
  companyId: number;
  /** Config files rewritten. */
  written: string[];
  /** Why we could not sync, when status is 'failed' or 'skipped'. */
  reason?: string;
}

export interface SyncDeps {
  /** Mint an API key scoped to the CURRENT session company. */
  createKey: (name: string, scopes: string[]) => Promise<string>;
  apiUrl: string;
}

/**
 * ⛔ NOT a silent re-mint on every call. We only touch the config when the key
 * present resolves to a DIFFERENT company (or there is none). Re-minting every
 * login would burn the 25-active-keys-per-company limit in a fortnight and
 * leave a trail of orphaned credentials nobody can attribute.
 */
export async function syncMcpCredential(
  companyId: number | undefined,
  deps: SyncDeps,
  clients: McpClient[] = SYNC_CLIENTS,
): Promise<McpSyncResult> {
  if (!companyId) {
    return { status: 'skipped', companyId: 0, written: [], reason: 'no company in session' };
  }

  // Which client configs actually have a Solid server to correct?
  const targets: Array<{ client: McpClient; configPath: string; apiKey: string }> = [];
  for (const client of clients) {
    const found = readMcpApiKey(client);
    if (found) targets.push({ client, configPath: found.configPath, apiKey: found.apiKey });
  }
  if (targets.length === 0) {
    return { status: 'skipped', companyId, written: [], reason: 'no Solid MCP server configured' };
  }

  // Resolve each key ONCE; identical keys across clients are the common case.
  const companyByKey = new Map<string, number | null>();
  const stale: typeof targets = [];
  for (const t of targets) {
    if (!companyByKey.has(t.apiKey)) {
      const { companyId: keyCompany } = await resolveKeyCompany(t.apiKey, deps.apiUrl);
      companyByKey.set(t.apiKey, keyCompany);
    }
    const keyCompany = companyByKey.get(t.apiKey) ?? null;
    // ⛔ Unresolvable is NOT stale. A network blip must not cause us to mint a
    // key and overwrite a config that was perfectly correct.
    if (keyCompany !== null && keyCompany !== companyId) stale.push(t);
  }

  if (stale.length === 0) {
    return { status: 'ok', companyId, written: [] };
  }

  let key: string;
  try {
    key = await deps.createKey(`solid ai (company ${companyId})`, ['kb:read', 'pages:read']);
  } catch (e) {
    return {
      status: 'failed',
      companyId,
      written: [],
      reason: e instanceof Error ? e.message : String(e),
    };
  }

  const written: string[] = [];
  for (const t of stale) {
    try {
      const configPath = configPathForClient(t.client);
      const existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const entry = buildServerEntry({ apiKey: key, apiUrl: deps.apiUrl, companyId });
      fs.writeFileSync(configPath, serializeConfig(mergeIntoConfig(existing, entry)));
      written.push(configPath);
    } catch {
      // One unwritable config must not abort the others; the caller reports
      // what was written and the guard in `solid ai` still catches the rest.
    }
  }

  return written.length
    ? { status: 'updated', companyId, written }
    : { status: 'failed', companyId, written: [], reason: 'could not write any MCP config' };
}

/**
 * Convenience wrapper: sync using the live CLI session.
 *
 * Callers are `solid auth login` and `solid switch` — the two moments the
 * session's company can change. Never throws: a failure here must not fail a
 * login, and `solid ai` still refuses to launch on a mismatch.
 */
export async function syncMcpForCurrentCompany(): Promise<McpSyncResult> {
  try {
    const { config } = await import('./config');
    const { apiClient } = await import('./api-client');
    return await syncMcpCredential(config.companyId, {
      apiUrl: config.apiUrl,
      createKey: async (name, scopes) => {
        const res = await apiClient.apiKeyCreate(name, scopes);
        return res.data.key;
      },
    });
  } catch (e) {
    return {
      status: 'failed',
      companyId: 0,
      written: [],
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}

/** One dim line for the terminal, or null when there is nothing worth saying. */
export function describeMcpSync(r: McpSyncResult): string | null {
  if (r.status === 'updated') {
    return `AI credential re-pointed to company ${r.companyId} (${r.written.length} config${r.written.length === 1 ? '' : 's'})`;
  }
  if (r.status === 'failed') {
    return `Could not re-point the AI credential: ${r.reason ?? 'unknown'}. Run: solid mcp install --company ${r.companyId}`;
  }
  return null;  // 'ok' and 'skipped' are silent — nothing changed, nothing to say.
}
