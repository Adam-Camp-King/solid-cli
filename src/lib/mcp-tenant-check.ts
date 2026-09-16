/**
 * Does the MCP credential point at the same company as this CLI session?
 *
 * ⛔ WHY THIS EXISTS — 2026-09-15.
 *
 * Adam logged the CLI into company 61 (ANGL, a real client), typed `claude`,
 * and the agent confidently reported on company 1 (Solid-dev) — listing its
 * plumbing pages, asking which of *its* cards to extend. Every answer was
 * correct about the wrong business.
 *
 * The cause is two credential stores that never talk to each other:
 *
 *   ~/.solid/config.json          a JWT, re-scoped by `solid switch`
 *   ~/.claude.json  mcpServers    a STATIC SOLID_API_KEY, written once
 *
 * The backend derives the tenant from the key record itself
 * (`_authenticate_api_key` → "company_id from the key record"), and the MCP
 * server sends no company of its own. So `solid switch` cannot move the agent,
 * and nothing anywhere says so.
 *
 * This is NOT a tenant leak — the key returns its own company's data, which is
 * correct for the credential presented. It is worse in one specific way: an
 * isolation failure gets noticed, whereas this produces confident, coherent,
 * completely wrong answers about someone else's business.
 *
 * `solid ai` already loud-fails on a mismatched *context manifest*. It never
 * checked the *credential*, which is the one that decides what the agent can
 * actually see.
 */

import * as fs from 'fs';

import { configPathForClient, type McpClient } from './mcp-client-config';

export interface McpTenantStatus {
  /** Which client config we read. */
  client: McpClient;
  configPath: string;
  /** Name of the MCP server entry carrying the key. */
  serverName: string;
  /** Company the API key actually resolves to, per the backend. */
  keyCompanyId: number | null;
  keyCompanyName?: string;
  /** Company this CLI session is scoped to. */
  sessionCompanyId: number;
  /** True when the agent would act on a different tenant than the session. */
  mismatch: boolean;
  /** Set when we could not determine the key's company (offline, bad key…). */
  unresolved?: string;
}

interface Serverish {
  env?: Record<string, string>;
}

/**
 * Find a Solid MCP server entry and its API key in a client config.
 * Returns null when the client has no Solid server configured at all — that is
 * a normal state (the user may not have run `solid mcp install`), not an error.
 */
export function readMcpApiKey(
  client: McpClient,
): { serverName: string; apiKey: string; configPath: string } | null {
  let configPath: string;
  try {
    configPath = configPathForClient(client);
  } catch {
    return null;
  }
  if (!configPath || !fs.existsSync(configPath)) return null;

  let parsed: { mcpServers?: Record<string, Serverish> };
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    // A malformed client config is the user's to fix and not worth blocking a
    // launch over — we simply cannot answer the question from it.
    return null;
  }

  const servers = parsed.mcpServers || {};
  for (const [name, cfg] of Object.entries(servers)) {
    if (!/solid/i.test(name)) continue;
    const key = cfg?.env?.SOLID_API_KEY;
    if (key && key.trim()) return { serverName: name, apiKey: key.trim(), configPath };
  }
  return null;
}

/**
 * Ask the backend which company a key belongs to.
 *
 * ⛔ Deliberately asks the SERVER rather than parsing the key. The tenant is a
 * column on the key record, not something encoded in the string — any local
 * guess would be exactly the kind of inference that caused this bug.
 */
export async function resolveKeyCompany(
  apiKey: string,
  apiUrl: string,
  timeoutMs = 4000,
): Promise<{ companyId: number | null; companyName?: string; error?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${apiUrl.replace(/\/+$/, '')}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: ctrl.signal,
    });
    if (!res.ok) return { companyId: null, error: `auth/me returned ${res.status}` };
    const body: any = await res.json();
    const user = body?.user ?? body;
    const companyId = user?.company_id ?? null;
    return {
      companyId: typeof companyId === 'number' ? companyId : null,
      companyName: user?.company_name ?? body?.company?.name,
    };
  } catch (e) {
    return { companyId: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Full check. Returns null when there is nothing to compare — no Solid MCP
 * server configured, or no session company — because "cannot tell" must not be
 * reported as "matches".
 */
export async function checkMcpTenant(
  sessionCompanyId: number | undefined,
  apiUrl: string,
  clients: McpClient | McpClient[] = ['vscode', 'claude'],
): Promise<McpTenantStatus | null> {
  if (!sessionCompanyId) return null;

  // ⛔ 'vscode' FIRST, and that is not a typo. `configPathForClient` maps
  // 'vscode' to ~/.claude.json — "the user-scope MCP config shared by the
  // Claude Code CLI and the VS Code extension" — while 'claude' maps to Claude
  // DESKTOP's claude_desktop_config.json. `solid ai` launches the Claude Code
  // CLI, so ~/.claude.json is the authoritative file; checking only 'claude'
  // reads a config the launched agent may never load. Both are scanned because
  // a stale key in either is worth saying out loud.
  const list = Array.isArray(clients) ? clients : [clients];
  const seen: McpTenantStatus[] = [];

  for (const client of list) {
    const found = readMcpApiKey(client);
    if (!found) continue;
    const { companyId, companyName, error } = await resolveKeyCompany(found.apiKey, apiUrl);
    const status: McpTenantStatus = {
      client,
      configPath: found.configPath,
      serverName: found.serverName,
      keyCompanyId: companyId,
      keyCompanyName: companyName,
      sessionCompanyId,
      // ⛔ Unresolved is NOT a mismatch. Failing a launch because the network
      // blipped would make the check the problem instead of the thing it guards.
      mismatch: companyId !== null && companyId !== sessionCompanyId,
      unresolved: error,
    };
    if (status.mismatch) return status;  // a mismatch anywhere wins
    seen.push(status);
  }
  return seen[0] ?? null;
}


/**
 * Find a Solid MCP server entry whether or not it carries a credential.
 *
 * ⛔ WHY THIS IS SEPARATE FROM readMcpApiKey. That function returns null unless
 * an entry has a SOLID_API_KEY, which is correct for "whose company is this
 * key?" and wrong for "is there a server here that NEEDS a key?". The sync used
 * the first for both, so on Adam's machine — where ~/.claude.json held the
 * Solid server with only SOLID_API_URL — it found no target, reported
 * "skipped: no Solid MCP server configured", and left the entry unauthenticated
 * through every login and switch. A server that exists and cannot authenticate
 * is the case most needing repair, and it was the one case we ignored.
 */
export function findSolidServerEntry(
  client: McpClient,
): { serverName: string; apiKey: string | null; configPath: string } | null {
  let configPath: string;
  try {
    configPath = configPathForClient(client);
  } catch {
    return null;
  }
  if (!configPath || !fs.existsSync(configPath)) return null;

  let parsed: { mcpServers?: Record<string, Serverish> };
  try {
    parsed = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch {
    return null;
  }

  const servers = parsed.mcpServers || {};
  let keyless: { serverName: string; apiKey: null; configPath: string } | null = null;
  for (const [name, cfg] of Object.entries(servers)) {
    if (!/solid/i.test(name)) continue;
    const key = cfg?.env?.SOLID_API_KEY;
    // Prefer a keyed entry; remember a keyless one in case that is all there is.
    if (key && key.trim()) return { serverName: name, apiKey: key.trim(), configPath };
    if (!keyless) keyless = { serverName: name, apiKey: null, configPath };
  }
  return keyless;
}
