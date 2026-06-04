/**
 * MCP client config helpers (Sprint 1 T1.5).
 *
 * Write/update the client-side JSON that tells Claude Desktop / Cursor /
 * Windsurf how to launch the Solid# MCP server. All pure — no fs here,
 * no network. Callers in src/commands/mcp.ts handle I/O.
 *
 * Supported client shapes (as of 2026-04):
 *
 *   Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):
 *     {
 *       "mcpServers": {
 *         "solid": { "command": "npx", "args": ["@solidnumber/mcp"],
 *                     "env": { "SOLID_API_KEY": "sk_..." } }
 *       }
 *     }
 *
 *   Cursor (~/.cursor/mcp.json): same shape as Claude Desktop
 *
 *   Windsurf (~/.codeium/windsurf/mcp_config.json): same shape
 *
 *   VS Code — Claude Code extension (~/.claude.json): same mcpServers
 *     shape, but the file holds LOTS of other Claude Code state — the
 *     merge MUST preserve unknown top-level keys (it does). This is the
 *     older-device path: the extension runs inside VS Code's own runtime,
 *     so it works on macOS versions where the native `claude` binary
 *     can't launch (needs 13+). Added 2026-06-04 after a real user hit
 *     exactly that wall.
 */
import * as os from 'os';
import * as path from 'path';

export type McpClient = 'claude' | 'cursor' | 'windsurf' | 'vscode';

export const SUPPORTED_CLIENTS: McpClient[] = ['claude', 'cursor', 'windsurf', 'vscode'];

/** Returns true if the string is a known supported client. */
export function isSupportedClient(value: string | undefined | null): value is McpClient {
  return !!value && (SUPPORTED_CLIENTS as string[]).includes(value);
}

export interface ServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface McpConfigFile {
  mcpServers?: Record<string, ServerEntry>;
  // Other unknown keys passed through untouched
  [k: string]: unknown;
}

/**
 * Per-OS default path for each supported client. Returns the path
 * relative to `homeDir` so callers can pass their own for testing.
 */
export function configPathForClient(
  client: McpClient,
  opts: { platform?: NodeJS.Platform; homeDir?: string } = {},
): string {
  const platform = opts.platform ?? process.platform;
  const home = opts.homeDir ?? os.homedir();

  switch (client) {
    case 'claude':
      if (platform === 'darwin') {
        return path.join(home, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
      }
      if (platform === 'win32') {
        // %APPDATA% → fall back to ~/AppData/Roaming when not set
        const appdata = opts.platform === undefined ? process.env.APPDATA : undefined;
        const base = appdata ?? path.join(home, 'AppData', 'Roaming');
        return path.join(base, 'Claude', 'claude_desktop_config.json');
      }
      // Linux — Claude Desktop isn't officially supported there but keep
      // a sane default so tests have something to assert.
      return path.join(home, '.config', 'Claude', 'claude_desktop_config.json');

    case 'cursor':
      return path.join(home, '.cursor', 'mcp.json');

    case 'windsurf':
      if (platform === 'darwin' || platform === 'linux') {
        return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');
      }
      if (platform === 'win32') {
        const appdata = opts.platform === undefined ? process.env.APPDATA : undefined;
        const base = appdata ?? path.join(home, 'AppData', 'Roaming');
        return path.join(base, 'Codeium', 'Windsurf', 'mcp_config.json');
      }
      return path.join(home, '.codeium', 'windsurf', 'mcp_config.json');

    case 'vscode':
      // User-scope MCP config shared by the Claude Code CLI and the
      // VS Code extension. Same path on every OS.
      return path.join(home, '.claude.json');
  }
}

export interface BuildEntryInput {
  /** API key or token the MCP server will use to call the backend. */
  apiKey?: string;
  /** Base URL for the backend. Defaults to api.solidnumber.com. */
  apiUrl?: string;
  /** Npm package to invoke via npx. Defaults to @solidnumber/mcp. */
  packageName?: string;
  /** Optional extra env vars (merged in). */
  extraEnv?: Record<string, string>;
  /** Company-id pin (adds X-Company-Id via SOLID_COMPANY_ID env). */
  companyId?: number | string;
}

/** Default package that ships the stdio MCP server. */
export const DEFAULT_MCP_PACKAGE = '@solidnumber/mcp';

/**
 * Build the `mcpServers.solid` entry. Pure — no I/O, no env reads.
 */
export function buildServerEntry(input: BuildEntryInput = {}): ServerEntry {
  const env: Record<string, string> = {};
  if (input.apiKey) env.SOLID_API_KEY = input.apiKey;
  if (input.apiUrl) env.SOLID_API_URL = input.apiUrl;
  if (input.companyId !== undefined && input.companyId !== null && input.companyId !== '') {
    env.SOLID_COMPANY_ID = String(input.companyId);
  }
  if (input.extraEnv) {
    for (const [k, v] of Object.entries(input.extraEnv)) {
      if (typeof v === 'string' && v.length > 0) env[k] = v;
    }
  }
  const entry: ServerEntry = {
    command: 'npx',
    args: ['-y', input.packageName ?? DEFAULT_MCP_PACKAGE],
  };
  if (Object.keys(env).length > 0) entry.env = env;
  return entry;
}

/**
 * Merge a new `solid` server entry into an existing config file.
 * Preserves any other mcpServers keys and any top-level keys we don't
 * recognize. Returns a NEW object — input is not mutated.
 */
export function mergeIntoConfig(
  existing: McpConfigFile | null | undefined,
  entry: ServerEntry,
  serverKey: string = 'solid',
): McpConfigFile {
  const base: McpConfigFile = existing && typeof existing === 'object' ? { ...existing } : {};
  const servers: Record<string, ServerEntry> = { ...(base.mcpServers ?? {}) };
  servers[serverKey] = entry;
  base.mcpServers = servers;
  return base;
}

/**
 * Remove the `solid` entry from a config, preserving other keys.
 * Returns the NEW config (unmutated input). When only `solid` existed
 * in mcpServers, keeps an empty `mcpServers: {}` to be explicit.
 */
export function removeFromConfig(
  existing: McpConfigFile | null | undefined,
  serverKey: string = 'solid',
): McpConfigFile {
  const base: McpConfigFile = existing && typeof existing === 'object' ? { ...existing } : {};
  if (base.mcpServers && typeof base.mcpServers === 'object') {
    const { [serverKey]: _, ...rest } = base.mcpServers;
    base.mcpServers = rest;
  }
  return base;
}

/**
 * Pretty-print a config with stable key order + 2-space indent. Writes
 * this string is the caller's responsibility.
 */
export function serializeConfig(cfg: McpConfigFile): string {
  return JSON.stringify(cfg, null, 2) + '\n';
}
