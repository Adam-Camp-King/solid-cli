/**
 * Keep the Solid# MCP server current — the half of `solid update` that is not
 * the CLI.
 *
 * The MCP server is never "installed" by an update: a client config launches it
 * with `npx -y <spec>`. Whether that is fresh depends entirely on the spec:
 *
 *   @solidnumber/mcp@latest   npx re-resolves on every launch        → current
 *   @solidnumber/mcp          npx reuses its cache from the first run → frozen
 *   @solidnumber/mcp@1.2.0    someone chose this version              → left alone
 *
 * ⛔ Every config written before 2026-09-24 (CLI < 2.24.8) carries the bare
 * spec, so those machines keep launching the MCP server from the day they set
 * it up, and updating the CLI changed nothing about that. `solid update` now
 * rewrites the bare spec to `@latest` — that one array element, nothing else —
 * in every client config the CLI knows, including Claude Code's per-project
 * servers inside ~/.claude.json.
 *
 * The MCP SDK ships INSIDE @solidnumber/mcp; it moves when we publish, never on
 * a user's machine.
 *
 * The planning functions are pure (config object in, plan out). File and npm
 * I/O sits behind an injectable `io` so tests never touch a real home dir.
 */
import * as fs from 'fs';
import { spawnSync } from 'child_process';

import { configPathForClient, McpClient, SUPPORTED_CLIENTS } from './mcp-client-config';

export const MCP_PACKAGE = '@solidnumber/mcp';
export const MCP_LATEST_SPEC = `${MCP_PACKAGE}@latest`;
const MCP_REGISTRY = `https://registry.npmjs.org/${MCP_PACKAGE}/latest`;

export type SpecKind = 'latest' | 'bare' | 'pinned';

/** What an npx argument says about @solidnumber/mcp, or null if it is not that package. */
export function classifySpec(arg: unknown): SpecKind | null {
  if (typeof arg !== 'string') return null;
  if (arg === MCP_PACKAGE) return 'bare';
  if (!arg.startsWith(`${MCP_PACKAGE}@`)) return null;
  return arg === MCP_LATEST_SPEC ? 'latest' : 'pinned';
}

export interface ServerFinding {
  /** Where in the file: "mcpServers" or "projects[<path>].mcpServers". */
  scope: string;
  server: string;
  spec: string;
  kind: SpecKind;
}

interface ServersRef {
  scope: string;
  servers: Record<string, unknown>;
}

/** Every mcpServers map in a client config: top level, and Claude Code's per-project maps. */
function serverMaps(cfg: Record<string, unknown>): ServersRef[] {
  const maps: ServersRef[] = [];
  const top = cfg.mcpServers;
  if (top && typeof top === 'object') maps.push({ scope: 'mcpServers', servers: top as Record<string, unknown> });
  const projects = cfg.projects;
  if (projects && typeof projects === 'object') {
    for (const [dir, proj] of Object.entries(projects as Record<string, unknown>)) {
      const servers = (proj as { mcpServers?: unknown } | null)?.mcpServers;
      if (servers && typeof servers === 'object') {
        maps.push({ scope: `projects[${dir}].mcpServers`, servers: servers as Record<string, unknown> });
      }
    }
  }
  return maps;
}

/**
 * Rewrite every bare `@solidnumber/mcp` launch spec to `@latest`. Pure: returns
 * a deep copy plus what it found; the input is not mutated. Matches on the
 * PACKAGE, never the server's name, and changes only that one argument.
 */
export function refreshConfig(cfg: Record<string, unknown>): {
  config: Record<string, unknown>;
  findings: ServerFinding[];
  changed: boolean;
} {
  const config = JSON.parse(JSON.stringify(cfg)) as Record<string, unknown>;
  const findings: ServerFinding[] = [];
  let changed = false;
  for (const { scope, servers } of serverMaps(config)) {
    for (const [server, entry] of Object.entries(servers)) {
      const args = (entry as { args?: unknown } | null)?.args;
      if (!Array.isArray(args)) continue;
      args.forEach((arg, i) => {
        const kind = classifySpec(arg);
        if (!kind) return;
        findings.push({ scope, server, spec: String(arg), kind });
        if (kind === 'bare') {
          args[i] = MCP_LATEST_SPEC;
          changed = true;
        }
      });
    }
  }
  return { config, findings, changed };
}

// ── I/O ─────────────────────────────────────────────────────────────────────

export interface FreshnessIo {
  readFile(p: string): string | null;
  writeFile(p: string, body: string): void;
  /** Version of a global npm install of @solidnumber/mcp, or null when there is none. */
  globalMcpVersion(): string | null;
  /** Upgrade the global install; true on success. */
  upgradeGlobalMcp(): boolean;
}

export const realIo: FreshnessIo = {
  readFile(p) {
    try {
      return fs.existsSync(p) ? fs.readFileSync(p, 'utf-8') : null;
    } catch {
      return null;
    }
  },
  writeFile(p, body) {
    fs.writeFileSync(p, body);
  },
  globalMcpVersion() {
    try {
      const out = spawnSync('npm', ['ls', '-g', MCP_PACKAGE, '--depth=0', '--json'], {
        encoding: 'utf8',
        timeout: 20_000,
      });
      const deps = (JSON.parse(out.stdout || '{}') as { dependencies?: Record<string, { version?: string }> })
        .dependencies;
      return deps?.[MCP_PACKAGE]?.version ?? null;
    } catch {
      return null;
    }
  },
  upgradeGlobalMcp() {
    const r = spawnSync('npm', ['install', '-g', MCP_LATEST_SPEC], { stdio: 'inherit' });
    return r.status === 0;
  },
};

/** Newest published @solidnumber/mcp, or null. Never throws. */
export async function latestMcpVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(MCP_REGISTRY, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

export interface ClientReport {
  client: McpClient;
  path: string;
  /** "rewritten", "would_rewrite", "current", "unreadable", or "write_failed". */
  status: 'rewritten' | 'would_rewrite' | 'current' | 'unreadable' | 'write_failed';
  findings: ServerFinding[];
  error?: string;
}

export interface McpFreshnessReport {
  latest: string | null;
  clients: ClientReport[];
  global: { installed: string | null; action: 'none' | 'upgraded' | 'would_upgrade' | 'upgrade_failed' };
  /** Pinned specs we deliberately did not touch — someone chose that version. */
  pinned: Array<ServerFinding & { client: McpClient }>;
}

function isNewer(current: string, candidate: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parts(current), parts(candidate)];
  for (let i = 0; i < 3; i += 1) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

/**
 * Bring every Solid# MCP launch on this machine to the current release.
 * `apply: false` reports what it would do and changes nothing.
 */
export async function refreshMcp(opts: {
  apply: boolean;
  io?: FreshnessIo;
  homeDir?: string;
  fetchImpl?: typeof fetch;
}): Promise<McpFreshnessReport> {
  const io = opts.io ?? realIo;
  const latest = await latestMcpVersion(opts.fetchImpl);
  const clients: ClientReport[] = [];
  const pinned: McpFreshnessReport['pinned'] = [];
  const seen = new Set<string>();

  for (const client of SUPPORTED_CLIENTS) {
    const p = configPathForClient(client, opts.homeDir ? { homeDir: opts.homeDir } : {});
    if (seen.has(p)) continue;
    seen.add(p);
    const raw = io.readFile(p);
    if (raw === null) continue; // client not on this machine
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      clients.push({ client, path: p, status: 'unreadable', findings: [] });
      continue;
    }
    const { config, findings, changed } = refreshConfig(cfg);
    if (!findings.length) continue; // Solid# is not wired in this client
    for (const f of findings) if (f.kind === 'pinned') pinned.push({ ...f, client });
    if (!changed) {
      clients.push({ client, path: p, status: 'current', findings });
      continue;
    }
    if (!opts.apply) {
      clients.push({ client, path: p, status: 'would_rewrite', findings });
      continue;
    }
    try {
      io.writeFile(p, JSON.stringify(config, null, 2) + '\n');
      clients.push({ client, path: p, status: 'rewritten', findings });
    } catch (err) {
      clients.push({ client, path: p, status: 'write_failed', findings, error: (err as Error).message });
    }
  }

  const installed = io.globalMcpVersion();
  let action: McpFreshnessReport['global']['action'] = 'none';
  if (installed && latest && isNewer(installed, latest)) {
    if (!opts.apply) action = 'would_upgrade';
    else action = io.upgradeGlobalMcp() ? 'upgraded' : 'upgrade_failed';
  }

  return { latest, clients, global: { installed, action }, pinned };
}
