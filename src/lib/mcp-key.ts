/**
 * The long-lived sk_ key an MCP client config should carry.
 *
 * ⛔ A session token is never the answer here. `solid mcp install` used to
 * write the CLI's session access token into the client config; it expires,
 * and the MCP server then fails with 401s long after install "succeeded".
 * `solid setup` already minted an sk_ key for this; both paths now share it.
 *
 * The cached key (~/.solid/mcp-key) is reused ONLY if it still appears among
 * the current company's active keys. A key cached before `solid company
 * switch` belongs to the old company, and wiring it in again is how a client
 * ends up on a different tenant from the CLI (the `conflict` verdict in
 * `solid mcp doctor`).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export const MCP_KEY_NAME = 'mcp-server (auto-provisioned by solid setup)';

export function defaultMcpKeyFile(): string {
  return path.join(os.homedir(), '.solid', 'mcp-key');
}

export function readMcpKey(keyFile: string): string | null {
  try {
    if (!fs.existsSync(keyFile)) return null;
    const key = fs.readFileSync(keyFile, 'utf-8').trim();
    return key.startsWith('sk_') ? key : null;
  } catch { return null; }
}

export function writeMcpKey(keyFile: string, key: string): void {
  try {
    fs.mkdirSync(path.dirname(keyFile), { recursive: true });
    fs.writeFileSync(keyFile, key, { mode: 0o600 });
  } catch { /* best-effort */ }
}

export interface KeyApi {
  apiKeyList(): Promise<{ data: { api_keys?: Array<{ key_prefix: string; is_active?: boolean }>; available_scopes?: string[] } }>;
  apiKeyCreate(name: string, scopes: string[]): Promise<{ data: { key?: string } }>;
}

/** True when `key` matches an active key in `keys` (list prefixes end in "..."). */
export function keyIsListed(key: string, keys: Array<{ key_prefix: string; is_active?: boolean }>): boolean {
  return keys.some((k) => {
    if (k.is_active === false) return false;
    const p = String(k.key_prefix || '').replace(/\.\.\.$/, '');
    return p.length > 0 && key.startsWith(p);
  });
}

export type McpKeySource = 'cached' | 'minted';

/**
 * Reuse the cached key when it belongs to the current company and is active;
 * otherwise mint one with every scope the company may grant. Returns null
 * when no key can be had (not logged in, network, no scopes).
 */
export async function getOrCreateMcpApiKey(
  api: KeyApi,
  keyFile: string = defaultMcpKeyFile(),
): Promise<{ key: string; source: McpKeySource } | null> {
  const cached = readMcpKey(keyFile);
  let list;
  try {
    list = (await api.apiKeyList()).data;
  } catch {
    // Cannot verify. A cached key is still better than nothing; the doctor
    // will say if it points somewhere else.
    return cached ? { key: cached, source: 'cached' } : null;
  }
  if (cached && keyIsListed(cached, list.api_keys || [])) return { key: cached, source: 'cached' };

  const scopes = list.available_scopes || [];
  if (scopes.length === 0) return null;
  try {
    const key = (await api.apiKeyCreate(MCP_KEY_NAME, scopes)).data.key;
    if (!key) return null;
    writeMcpKey(keyFile, key);
    return { key, source: 'minted' };
  } catch {
    return null;
  }
}
