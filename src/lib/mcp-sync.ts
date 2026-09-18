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
import * as path from 'path';

import {
  configPathForClient,
  buildServerEntry,
  mergeIntoConfig,
  serializeConfig,
  type McpClient,
} from './mcp-client-config';
import { findSolidServerEntry, resolveKeyCompany } from './mcp-tenant-check';

/** Clients whose config `claude` / the VS Code extension actually read. */
const SYNC_CLIENTS: McpClient[] = ['vscode', 'claude'];

export interface McpSyncResult {
  /**
   * 'ok' — already correct. 'updated' — rewritten. 'created' — there was no
   * Solid server at all and we wrote one. 'skipped' — nothing to do.
   */
  status: 'ok' | 'updated' | 'created' | 'skipped' | 'failed';
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

export interface SyncOptions {
  /**
   * Write a Solid server into this client's config when the machine has NONE.
   *
   * ⛔⛔ WITHOUT THIS THE CLI CANNOT PAIR AN AGENT TO A COMPANY AT ALL — 2026-09-17.
   * Everything below repairs a server that already exists. On a machine that
   * has never had one (Adam's iMac: no source checkout, no ~/.claude.json
   * entry), login, switch and `solid ai` all reported success and left the
   * agent with no Solid door whatsoever. The only door was an account-level
   * claude.ai connector authorized months earlier from Claude Desktop, bound to
   * a DIFFERENT company, invisible to every local check — so the agent answered
   * confidently about company 1 while the terminal was authenticated as
   * company 61. The login was real (users.last_login_at proves it); the pairing
   * step simply did not exist.
   *
   * 'vscode' is ~/.claude.json — the user-scope config the `claude` CLI loads.
   * ⛔ NOT 'claude', which is Claude Desktop's config and is read by a program
   * the terminal never launches.
   */
  provisionInto?: McpClient;
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
  options: SyncOptions = {},
): Promise<McpSyncResult> {
  if (!companyId) {
    return { status: 'skipped', companyId: 0, written: [], reason: 'no company in session' };
  }

  // Which client configs actually have a Solid server to correct?
  const targets: Array<{ client: McpClient; configPath: string; apiKey: string | null }> = [];
  for (const client of clients) {
    // ⛔ findSolidServerEntry, NOT readMcpApiKey. A Solid server with no
    // SOLID_API_KEY is a target — it is the one that most needs a credential.
    // Skipping it is how Adam's ~/.claude.json stayed unauthenticated across
    // every login and switch while this function reported success.
    const found = findSolidServerEntry(client);
    if (found) targets.push({ client, configPath: found.configPath, apiKey: found.apiKey });
  }
  if (targets.length === 0) {
    if (!options.provisionInto) {
      return { status: 'skipped', companyId, written: [], reason: 'no Solid MCP server configured' };
    }
    return provisionServer(companyId, deps, options.provisionInto);
  }

  // Resolve each key ONCE; identical keys across clients are the common case.
  const companyByKey = new Map<string, number | null>();
  const stale: typeof targets = [];
  for (const t of targets) {
    // No key at all: unambiguously stale. Nothing to resolve, nothing to blip.
    if (t.apiKey === null) { stale.push(t); continue; }
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
 * No Solid server anywhere — write one, keyed to the current company.
 *
 * Creating the file when it is absent is the point: a machine that has never
 * run an agent has no ~/.claude.json, and refusing to create one is what left
 * the CLI with no way to hand a company to an LLM.
 */
async function provisionServer(
  companyId: number,
  deps: SyncDeps,
  client: McpClient,
): Promise<McpSyncResult> {
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

  try {
    const configPath = configPathForClient(client);
    let existing: unknown = {};
    if (fs.existsSync(configPath)) {
      try {
        existing = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      } catch {
        // ⛔ A config we cannot parse is NOT ours to rewrite — it is very likely
        // full of the user's other servers. Bail rather than clobber it.
        return {
          status: 'failed',
          companyId,
          written: [],
          reason: `${configPath} is not valid JSON — not overwriting it`,
        };
      }
    } else {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
    }
    const entry = buildServerEntry({ apiKey: key, apiUrl: deps.apiUrl, companyId });
    fs.writeFileSync(configPath, serializeConfig(mergeIntoConfig(existing as never, entry)));
    return { status: 'created', companyId, written: [configPath] };
  } catch (e) {
    return {
      status: 'failed',
      companyId,
      written: [],
      reason: e instanceof Error ? e.message : String(e),
    };
  }
}


/**
 * Convenience wrapper: sync using the live CLI session.
 *
 * Callers are `solid auth login` and `solid switch` — the two moments the
 * session's company can change. Never throws: a failure here must not fail a
 * login, and `solid ai` still refuses to launch on a mismatch.
 */
export async function syncMcpForCurrentCompany(
  options: SyncOptions = {},
): Promise<McpSyncResult> {
  try {
    const { config } = await import('./config');
    const { apiClient } = await import('./api-client');
    return await syncMcpCredential(config.companyId, {
      apiUrl: config.apiUrl,
      createKey: async (name, scopes) => {
        const res = await apiClient.apiKeyCreate(name, scopes);
        return res.data.key;
      },
    }, SYNC_CLIENTS, options);
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
  if (r.status === 'created') {
    // ⛔ SAY IT. This is the moment the user's AI became usable, and it is the
    // one thing they came here for. Silence is what made the old behaviour
    // indistinguishable from the broken one.
    return `Your AI is now connected to company ${r.companyId}`;
  }
  if (r.status === 'updated') {
    return `AI credential re-pointed to company ${r.companyId} (${r.written.length} config${r.written.length === 1 ? '' : 's'})`;
  }
  if (r.status === 'failed') {
    return `Could not re-point the AI credential: ${r.reason ?? 'unknown'}. Run: solid mcp install --company ${r.companyId}`;
  }
  return null;  // 'ok' and 'skipped' are silent — nothing changed, nothing to say.
}
