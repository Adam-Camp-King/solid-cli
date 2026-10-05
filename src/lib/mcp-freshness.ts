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
 * ⛔ "LAUNCHES THE LATEST" IS ABOUT THE NEXT START, NOT ABOUT NOW (2026-10-04).
 * A config with `@latest` is correct and `solid update` said so — "already
 * launches the latest" — minutes after 1.3.5 was published, while every AI app
 * open on that machine was still running the 1.3.4 server it had started that
 * morning. A person might guess a restart is needed; an agent reads "latest"
 * and believes it is on it. So the report now says what is RUNNING.
 *
 * ⛔ THE FOLDER ON DISK CANNOT ANSWER THAT ALONE. Every server on a machine is
 * launched from one npx cache folder, and fetching a new version overwrites
 * that folder under the servers already running from it. The folder then says
 * 1.3.5 while a process started an hour earlier is still executing 1.3.4. What
 * tells them apart is TIME: a process that started before its package was last
 * written to disk is running an older copy than the one on disk.
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
  /**
   * The Solid# MCP server processes running on this machine, or null when the
   * process list cannot be read here. Optional: an io without it reports
   * "could not check", never "none running".
   */
  runningMcpServers?(): RunningProcess[] | null;
  /** The version in a package folder and when it was last written, or null. */
  packageOnDisk?(pkgDir: string): { version: string; writtenAtMs: number } | null;
}

/** One running server process: who, since when, and the package folder it was started from. */
export interface RunningProcess {
  pid: number;
  startedAtMs: number | null;
  pkgDir: string | null;
}

/**
 * PURE. Server processes out of `ps -axo pid=,lstart=,command=` text.
 *
 * Only the server itself is kept — `node …/node_modules/.bin/solid-mcp` or a path
 * inside `node_modules/@solidnumber/mcp/`. The `npm exec @solidnumber/mcp@latest`
 * line above it is the launcher: same server, no path, and counting it would
 * report every server twice.
 */
export function parseRunning(psText: string): RunningProcess[] {
  const out: RunningProcess[] = [];
  for (const line of psText.split('\n')) {
    const m = /^\s*(\d+)\s+(\S+\s+\S+\s+\d+\s+[\d:]+\s+\d{4})\s+(.*)$/.exec(line);
    if (!m) continue;
    const command = m[3];
    const bin = /(\S*node_modules)\/\.bin\/solid-mcp(?:\s|$)/.exec(command);
    const inside = /(\S*node_modules\/@solidnumber\/mcp)\//.exec(command);
    const pkgDir = bin ? `${bin[1]}/@solidnumber/mcp` : inside ? inside[1] : null;
    if (!pkgDir) continue;
    const started = Date.parse(m[2]);
    out.push({ pid: parseInt(m[1], 10), startedAtMs: Number.isFinite(started) ? started : null, pkgDir });
  }
  return out;
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
    const r = spawnSync('npm', ['install', '-g', MCP_LATEST_SPEC, '--prefer-online'], { stdio: 'inherit' });
    return r.status === 0;
  },
  runningMcpServers() {
    // Windows has no `ps`; saying "could not check" is the honest answer there.
    if (process.platform === 'win32') return null;
    try {
      const out = spawnSync('ps', ['-axo', 'pid=,lstart=,command='], { encoding: 'utf8', timeout: 10_000 });
      if (out.status !== 0 || typeof out.stdout !== 'string') return null;
      return parseRunning(out.stdout);
    } catch {
      return null;
    }
  },
  packageOnDisk(pkgDir) {
    try {
      const file = `${pkgDir}/package.json`;
      const version = (JSON.parse(fs.readFileSync(file, 'utf-8')) as { version?: unknown }).version;
      if (typeof version !== 'string') return null;
      const st = fs.statSync(file);
      // npm extracts files with the tarball's own mtime on some versions, so the
      // later of mtime and ctime is when THIS copy landed on disk.
      return { version, writtenAtMs: Math.max(st.mtimeMs, st.ctimeMs) };
    } catch {
      return null;
    }
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

/**
 * What one running server is, relative to the newest release:
 *   current        started after the latest package was written to disk
 *   older_on_disk  its package folder still holds an older version
 *   older_in_memory the folder was updated after this process started — it is
 *                   still running the copy it loaded
 *   unknown        its start time or its package could not be read
 */
export type RunningState = 'current' | 'older_on_disk' | 'older_in_memory' | 'unknown';

export interface RunningServer {
  pid: number;
  state: RunningState;
  started_at: string | null;
  /** The version in the folder it was started from — NOT necessarily what it is running. */
  version_on_disk: string | null;
}

export interface RunningReport {
  /** False when this machine's process list could not be read: nothing is claimed. */
  checked: boolean;
  servers: RunningServer[];
  /** True when a running server is not on the latest release. Restart the AI app. */
  restart_needed: boolean;
}

export interface McpFreshnessReport {
  latest: string | null;
  clients: ClientReport[];
  global: { installed: string | null; action: 'none' | 'upgraded' | 'would_upgrade' | 'upgrade_failed' };
  /** Pinned specs we deliberately did not touch — someone chose that version. */
  pinned: Array<ServerFinding & { client: McpClient }>;
  /** What is running NOW — a correct config only decides the next start. */
  running: RunningReport;
}

/** A little slack so a process and the package it just installed are not judged by a few ms. */
const WRITE_SLACK_MS = 2_000;

/** PURE. Each running server judged against the newest release. */
export function judgeRunning(
  processes: RunningProcess[] | null,
  latest: string | null,
  packageOnDisk: (pkgDir: string) => { version: string; writtenAtMs: number } | null,
): RunningReport {
  if (processes === null) return { checked: false, servers: [], restart_needed: false };
  const servers: RunningServer[] = processes.map((p) => {
    const disk = p.pkgDir ? packageOnDisk(p.pkgDir) : null;
    const started_at = p.startedAtMs !== null ? new Date(p.startedAtMs).toISOString() : null;
    let state: RunningState = 'unknown';
    if (disk && latest && isNewer(disk.version, latest)) state = 'older_on_disk';
    else if (disk && p.startedAtMs !== null) {
      state = p.startedAtMs + WRITE_SLACK_MS < disk.writtenAtMs ? 'older_in_memory' : 'current';
    }
    return { pid: p.pid, state, started_at, version_on_disk: disk?.version ?? null };
  });
  return {
    checked: true,
    servers,
    restart_needed: servers.some((s) => s.state === 'older_on_disk' || s.state === 'older_in_memory'),
  };
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

  const running = judgeRunning(
    io.runningMcpServers ? io.runningMcpServers() : null,
    latest,
    (dir) => (io.packageOnDisk ? io.packageOnDisk(dir) : null),
  );
  return { latest, clients, global: { installed, action }, pinned, running };
}
