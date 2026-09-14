/**
 * Agent Plugins 1.1.0 packaging — the same skills, portable off Claude Code.
 *
 * ⛔ WHY THIS EXISTS. `installSkills` writes `.claude/skills/<name>/SKILL.md`,
 * which is the layout Claude Code reads and nothing else does. Agent Plugins
 * (Amazon, Cursor, Microsoft, OpenAI, Vercel; 1.0.0 published 2026-08-06)
 * standardises the OUTER packaging — a directory with a `plugin.json`
 * manifest, a `skills/` folder of exactly the SKILL.md files we already
 * generate, and an `mcp.json` naming the servers. Emitting that costs two
 * small JSON files and makes the identical content loadable by every client
 * that implements the standard.
 *
 * We are not inventing a format here and must not drift from one. The field
 * sets below are transcribed from the normative schemas at
 * https://agent-plugins.org/schemas/1.1.0/ — `plugin.schema.json` and
 * `mcp.schema.json` — both of which are CLOSED (`additionalProperties: false`)
 * with `$schema` and one other field required. A stray key is a validation
 * failure, not a hint, so every builder here emits exactly the permitted set.
 *
 * ⛔ NO CREDENTIAL EVER ENTERS mcp.json. A plugin directory is a DISTRIBUTABLE
 * artifact — that is its entire purpose — and `buildServerEntry` in
 * lib/mcp-client-config.ts puts `SOLID_API_KEY` into the env block because a
 * client config is a private file on one machine. The two look alike and are
 * opposites. This writer pins the tenant (`SOLID_COMPANY_ID`, not a secret,
 * and the plugin is already tenant-bound) and leaves the key to the
 * environment, so a shared plugin carries no way to act as anybody.
 *
 * ⛔ 1.1.0, NOT 1.0.0. The two plugin schemas are byte-identical apart from
 * the `$schema` constant, so there is no compatibility argument for pinning
 * the older one — and §5.2.1 requires the value to match the version targeted
 * exactly. Clients MUST reject a version they do not recognise, so this is the
 * one field that cannot be approximated.
 */
import * as fs from 'fs';
import * as path from 'path';

import type { Skill } from './index';

/** The Agent Plugins version this package targets. */
export const AGENT_PLUGINS_VERSION = '1.1.0';

export const PLUGIN_SCHEMA_URL =
  `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/plugin.schema.json`;
export const MCP_SCHEMA_URL =
  `https://agent-plugins.org/schemas/${AGENT_PLUGINS_VERSION}/mcp.schema.json`;

/**
 * Plugin root, relative to a tenant directory.
 *
 * Under `.solid/` because that is the directory `requireTenantManifest`
 * already governs: the plugin describes ONE company, and putting it anywhere
 * the guard does not cover would be a way to write tenant content outside the
 * boundary. `.claude/skills/` is still written alongside it — that is what
 * Claude Code reads today, and removing it to avoid duplicating two-kilobyte
 * files would break the client most likely to be pointed at this directory.
 */
export const PLUGIN_DIR = path.join('.solid', 'plugin');

/**
 * Manifest `name` constraints, transcribed from plugin.schema.json §5.5.
 * Lowercase alphanumeric with dots and hyphens inside, 1-64 characters,
 * alphanumeric at both ends, and no `--` or `..` anywhere.
 */
export const PLUGIN_NAME_RE = /^(?!.*(?:--|\.\.))[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;

export function isValidPluginName(name: string): boolean {
  return name.length >= 1 && name.length <= 64 && PLUGIN_NAME_RE.test(name);
}

export interface PluginManifest {
  $schema: string;
  name: string;
  version?: string;
  description?: string;
  author?: { name?: string; email?: string; url?: string };
  homepage?: string;
  repository?: string;
  license?: string;
  keywords?: string[];
  extensions?: Record<string, Record<string, unknown>>;
}

export interface BuildManifestInput {
  /** Plugin name. Must satisfy isValidPluginName. */
  name?: string;
  /** Usually the CLI version that generated it. */
  version?: string;
  description?: string;
  homepage?: string;
}

/**
 * Build `plugin.json`. Pure.
 *
 * Optional fields are OMITTED rather than set to empty strings: the schema
 * types them as strings, so `""` validates and then shows up in a client's
 * plugin list as a blank description. Absent is the honest encoding of
 * "we do not know this".
 */
export function buildPluginManifest(input: BuildManifestInput = {}): PluginManifest {
  const name = input.name ?? 'solid';
  if (!isValidPluginName(name)) {
    throw new Error(
      `plugin name "${name}" violates Agent Plugins ${AGENT_PLUGINS_VERSION} §5.5 ` +
      '(1-64 chars, lowercase alphanumeric with . or -, alphanumeric at both ends, no -- or ..)',
    );
  }
  const manifest: PluginManifest = { $schema: PLUGIN_SCHEMA_URL, name };
  if (input.version) manifest.version = input.version;
  if (input.description) manifest.description = input.description;
  if (input.homepage) manifest.homepage = input.homepage;
  manifest.license = 'BUSL-1.1';
  manifest.keywords = ['solid', 'business-operations', 'crm', 'mcp'];
  return manifest;
}

export interface StdioServer {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
}

export interface McpConfig {
  $schema: string;
  mcpServers: Record<string, StdioServer>;
}

export interface BuildMcpInput {
  /** Backend base URL. Omitted when it is the default. */
  apiUrl?: string;
  /** Tenant pin. Not a secret; the plugin is tenant-bound by construction. */
  companyId?: number | string;
  /** Npm package that ships the stdio server. */
  packageName?: string;
}

/** Default package that ships the stdio MCP server. Mirrors mcp-client-config. */
export const DEFAULT_MCP_PACKAGE = '@solidnumber/mcp';

/**
 * Build `mcp.json`. Pure.
 *
 * ⛔ `type` IS REQUIRED HERE AND IS NOT IN OUR OWN CLIENT CONFIGS. The
 * Agent Plugins server object is a `oneOf` over stdio / streamable-http / sse
 * discriminated on `type`, so omitting it — which the native Claude/Cursor
 * formats tolerate — fails the schema outright. This is exactly the kind of
 * difference that makes copying `buildServerEntry` the wrong move.
 */
export function buildMcpConfig(input: BuildMcpInput = {}): McpConfig {
  const env: Record<string, string> = {};
  if (input.apiUrl) env.SOLID_API_URL = input.apiUrl;
  if (input.companyId !== undefined && input.companyId !== null && input.companyId !== '') {
    env.SOLID_COMPANY_ID = String(input.companyId);
  }

  const server: StdioServer = {
    type: 'stdio',
    command: 'npx',
    args: ['-y', input.packageName ?? DEFAULT_MCP_PACKAGE],
  };
  if (Object.keys(env).length > 0) server.env = env;

  return { $schema: MCP_SCHEMA_URL, mcpServers: { solid: server } };
}

export interface WrittenFile {
  /** Path relative to the plugin root, as the spec names it. */
  rel: string;
  path: string;
  state: 'written' | 'unchanged';
}

export interface WritePluginInput {
  manifest?: BuildManifestInput;
  mcp?: BuildMcpInput;
}

/** Write `file` only when its bytes would change. Keeps re-runs quiet. */
function writeIfChanged(file: string, content: string, rel: string): WrittenFile {
  if (fs.existsSync(file)) {
    try {
      if (fs.readFileSync(file, 'utf8') === content) return { rel, path: file, state: 'unchanged' };
    } catch {
      /* unreadable — fall through and rewrite */
    }
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
  return { rel, path: file, state: 'written' };
}

/**
 * Write the Agent Plugins package under `<baseDir>/.solid/plugin/`.
 *
 * ⛔ The caller owns the tenant guard, exactly as `installSkills` documents.
 * This writes tenant-describing content and must never be reachable without a
 * verified `.solid/manifest.json`.
 */
export function writePlugin(
  baseDir: string,
  skills: readonly Skill[],
  input: WritePluginInput = {},
): WrittenFile[] {
  const root = path.join(baseDir, PLUGIN_DIR);
  const out: WrittenFile[] = [];

  // Trailing newline on both: these are files a human may open in an editor,
  // and every other JSON this CLI writes ends in one.
  out.push(
    writeIfChanged(
      path.join(root, 'plugin.json'),
      `${JSON.stringify(buildPluginManifest(input.manifest), null, 2)}\n`,
      'plugin.json',
    ),
  );
  out.push(
    writeIfChanged(
      path.join(root, 'mcp.json'),
      `${JSON.stringify(buildMcpConfig(input.mcp), null, 2)}\n`,
      'mcp.json',
    ),
  );

  for (const skill of skills) {
    const rel = path.join('skills', skill.dirname, 'SKILL.md');
    out.push(writeIfChanged(path.join(root, rel), skill.content, rel));
  }

  return out;
}
