/**
 * Enumerate EVERY Solid# MCP provider an AI on this machine can reach — and
 * decide which company each one will actually serve.
 *
 * ⛔ WHY THIS EXISTS — 2026-09-15, and it is not the bug we already fixed.
 *
 * `mcp-tenant-check.ts` answers "does the local API key match my session?".
 * That was necessary and insufficient, because it can only see credentials that
 * live in a FILE. The failure Adam hit has two providers loaded at once:
 *
 *   claude.ai Solid#  https://api.solidnumber.com/mcp/connector   (account-level)
 *   solid             npx -y @solidnumber/mcp                     (local stdio)
 *
 * The first is an account-level connector. Its token was minted on the OAuth
 * consent screen and is pinned to the (user, company_id) captured there; it
 * lives on the backend, NOT in ~/.claude.json. `readMcpApiKey` therefore
 * returns null for it, `checkMcpTenant` returns null, and the old guard
 * concluded "nothing to compare" — the quietest possible answer to the loudest
 * possible problem.
 *
 * Measured on this machine, this session:
 *   ~/.solid/config.json   company 61  (ANGL, adam@anglebuild.com)   ← the CLI
 *   claude.ai Solid#       company 1   (Solid-dev)                   ← the AI
 *   solid (local stdio)    no credential at all — /auth/me 404s
 *
 * Three credentials; the one the agent actually uses is the one the CLI cannot
 * touch. `solid switch` moves the JWT, re-login re-mints the local key, and the
 * agent goes right on reporting company 1. There was no authority deciding
 * which provider wins, so the AI picked, and it picked the remote one.
 *
 * ⛔ THE RULE THIS MODULE ENFORCES: two active Solid# providers is not a
 * preference to resolve, it is a refusal. When we cannot prove which company an
 * agent will act on, we say so and stop — we never launch with a reassuring
 * line. A tenant mix-up that announces itself costs a minute; one that reads
 * correct and coherent about the wrong business costs whatever the agent then
 * writes.
 */

import { execFile } from 'child_process';
import * as fs from 'fs';
import { promisify } from 'util';

import { configPathForClient, SUPPORTED_CLIENTS, type McpClient } from './mcp-client-config';
import { resolveKeyCompany } from './mcp-tenant-check';

const execFileAsync = promisify(execFile);

/** Where a provider is configured — this decides who can change it. */
export type ProviderScope =
  | 'account'   // claude.ai connector. Server-side OAuth. The CLI CANNOT move it.
  | 'user'      // ~/.claude.json or a client config file. The CLI owns this.
  | 'project'   // .mcp.json in a repo.
  | 'unknown';

/** How the provider is reached. */
export type ProviderTransport = 'stdio' | 'remote';

export interface SolidProvider {
  /** Server name exactly as the client knows it (`claude mcp remove` needs it). */
  name: string;
  scope: ProviderScope;
  transport: ProviderTransport;
  /** Command line or URL, as reported. */
  target: string;
  /** Health string from `claude mcp list`, when it came from there. */
  health?: string;
  /** False when the client reported it as failed/pending — it serves nothing. */
  active: boolean;
  /** Config file this came from, when it came from a file. */
  configPath?: string;
  /**
   * Which client's config this entry belongs to.
   *
   * ⛔ REQUIRED FOR CORRECTNESS, NOT LABELLING. Every client names its server
   * "solid", so a name is NOT a unique key across configs. Adam's machine had
   * `solid` in BOTH Claude Desktop's config (a stale key on company 1) and
   * ~/.claude.json (no key at all). Merging them by name attributed Desktop's
   * company to the Claude Code entry and printed a company for a server that
   * has no credential — a wrong answer produced by the very tool written to
   * stop wrong answers.
   */
  client?: McpClient;
  /** Company this provider resolves to. null = we could not determine it. */
  companyId: number | null;
  companyName?: string;
  /** Why companyId is null. Present ONLY when it is null. */
  unresolved?: string;
  /** True when no local action can re-point this provider. */
  cliCanRepoint: boolean;
}

/**
 * Is this MCP server one of ours?
 *
 * ⛔ Deliberately narrow. Matching /solid/ anywhere would claim "SolidWorks" or
 * a customer's "solid-state" server and then refuse to launch over it — a false
 * refusal trains people to pass --allow-tenant-mismatch by reflex, which
 * disables the real check. Name must be `solid` as a word, or the target must
 * name our package or our host.
 */
export function isSolidProvider(name: string, target: string): boolean {
  if (/\bsolid#?\b/i.test(name)) return true;
  if (/@solidnumber\/mcp/i.test(target)) return true;
  if (/(^|\/\/|\.)solidnumber\.com/i.test(target)) return true;
  return false;
}

interface ParsedLine {
  name: string;
  target: string;
  health: string;
}

/**
 * Parse `claude mcp list` stdout.
 *
 * The format is `name: target - health`, and BOTH separators are ambiguous:
 * the target holds `://` and can hold ` - `. So we take the name up to the
 * FIRST `: ` and the health after the LAST ` - `, which is the only split that
 * survives `claude.ai Solid#: https://api.solidnumber.com/mcp/connector - ✔ Connected`.
 */
export function parseClaudeMcpList(stdout: string): ParsedLine[] {
  const out: ParsedLine[] = [];
  for (const raw of stdout.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    // Header/status chatter from the health check pass.
    if (/^Checking MCP server health/i.test(line)) continue;
    if (/^No MCP servers configured/i.test(line)) continue;

    const colon = line.indexOf(': ');
    if (colon === -1) continue;
    const name = line.slice(0, colon).trim();
    let rest = line.slice(colon + 2).trim();
    if (!name || !rest) continue;

    let health = '';
    const dash = rest.lastIndexOf(' - ');
    if (dash !== -1) {
      health = rest.slice(dash + 3).trim();
      rest = rest.slice(0, dash).trim();
    }
    out.push({ name, target: rest, health });
  }
  return out;
}

/** `Scope: claude.ai config` → 'account'. That line is the whole discriminator. */
export function parseScope(getStdout: string): ProviderScope {
  const m = /^\s*Scope:\s*(.+)$/im.exec(getStdout);
  if (!m) return 'unknown';
  const v = m[1].toLowerCase();
  if (v.includes('claude.ai')) return 'account';
  // ⛔ ORDER IS LORE, NOT STYLE. The real user-scope line reads
  // "User config (available in all your projects)" — it contains the word
  // "projects". Testing for 'project' first classifies every user-scoped
  // server as project-scoped, which sends the operator to edit a .mcp.json
  // that does not exist. Caught by the fixture taken off the actual terminal.
  if (/\buser\b|\blocal\b/.test(v)) return 'user';
  if (v.includes('project') || v.includes('.mcp.json')) return 'project';
  return 'unknown';
}

/** A health string that means "this server is serving tools right now". */
export function isActiveHealth(health: string): boolean {
  if (!health) return true; // came from a file, not a health check
  if (/pending|approval/i.test(health)) return false;
  if (/fail|error|disconnect/i.test(health)) return false;
  return /connect/i.test(health) || /✔|✓/.test(health);
}

export interface EnumerateDeps {
  apiUrl: string;
  /** Override for tests. Returns stdout, or throws. */
  runClaude?: (args: string[]) => Promise<string>;
  /** Override for tests. */
  readFileSync?: (p: string) => string;
  existsSync?: (p: string) => boolean;
  clients?: McpClient[];
}

async function defaultRunClaude(args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('claude', args, {
    timeout: 20000,
    maxBuffer: 4 * 1024 * 1024,
    encoding: 'utf8',
  });
  return stdout;
}

/**
 * Ask the `claude` CLI what IT loads. This is the only way to see an
 * account-level connector: it is not in any file on this machine.
 *
 * Returns [] when `claude` is absent or errors — a missing binary is a normal
 * state (Cursor-only machine), not a fault to surface.
 */
export async function providersFromClaudeCli(deps: EnumerateDeps): Promise<SolidProvider[]> {
  const run = deps.runClaude ?? defaultRunClaude;
  let listed: ParsedLine[];
  try {
    listed = parseClaudeMcpList(await run(['mcp', 'list']));
  } catch {
    return [];
  }

  const found: SolidProvider[] = [];
  for (const entry of listed) {
    if (!isSolidProvider(entry.name, entry.target)) continue;

    let scope: ProviderScope = 'unknown';
    try {
      scope = parseScope(await run(['mcp', 'get', entry.name]));
    } catch {
      // Keep the provider — we know it exists, we just cannot say whose config
      // it came from. Dropping it would hide the conflict we exist to report.
    }

    const transport: ProviderTransport = /^https?:\/\//i.test(entry.target) ? 'remote' : 'stdio';
    found.push({
      name: entry.name,
      scope,
      transport,
      target: entry.target,
      health: entry.health,
      active: isActiveHealth(entry.health),
      companyId: null,
      // ⛔ An account connector's company was fixed on the consent screen and
      // its token lives on the backend. There is no local read that answers
      // "which company", and guessing would be the exact inference that made
      // this bug invisible. Unknown is reported as unknown.
      unresolved:
        scope === 'account'
          ? 'account-level connector — its company was fixed when you approved it, and is not readable from this machine'
          : 'no credential found for this server',
      cliCanRepoint: scope !== 'account',
    });
  }
  return found;
}

/**
 * Solid# providers configured in client config FILES, with their key resolved
 * to a company. Covers Cursor/Windsurf/Desktop, which have no `claude mcp list`.
 */
export async function providersFromConfigFiles(deps: EnumerateDeps): Promise<SolidProvider[]> {
  const exists = deps.existsSync ?? fs.existsSync;
  const read = deps.readFileSync ?? ((p: string) => fs.readFileSync(p, 'utf8'));
  const clients = deps.clients ?? SUPPORTED_CLIENTS;
  const out: SolidProvider[] = [];

  for (const client of clients) {
    let configPath: string;
    try {
      configPath = configPathForClient(client);
    } catch {
      continue;
    }
    if (!configPath || !exists(configPath)) continue;

    let parsed: { mcpServers?: Record<string, any> };
    try {
      parsed = JSON.parse(read(configPath));
    } catch {
      continue;
    }

    for (const [name, cfg] of Object.entries(parsed.mcpServers || {})) {
      const target = cfg?.url || [cfg?.command, ...(cfg?.args || [])].filter(Boolean).join(' ');
      if (!isSolidProvider(name, String(target || ''))) continue;

      const apiKey: string | undefined = cfg?.env?.SOLID_API_KEY;
      let companyId: number | null = null;
      let companyName: string | undefined;
      let unresolved: string | undefined;

      if (apiKey && apiKey.trim()) {
        const r = await resolveKeyCompany(apiKey.trim(), deps.apiUrl);
        companyId = r.companyId;
        companyName = r.companyName;
        if (companyId === null) unresolved = r.error || 'key did not resolve to a company';
      } else {
        // ⛔ REAL, AND MEASURED HERE: the local `solid` entry had only
        // SOLID_API_URL. It is configured, it health-checks as Connected, and
        // it is authenticated as nobody. "Connected" is not "working".
        unresolved = 'no SOLID_API_KEY in this entry — it authenticates as nobody';
      }

      out.push({
        name,
        client,
        scope: 'user',
        transport: cfg?.url ? 'remote' : 'stdio',
        target: String(target || ''),
        active: true,
        configPath,
        companyId,
        companyName,
        unresolved,
        cliCanRepoint: true,
      });
    }
  }
  return out;
}

/**
 * Every Solid# provider reachable from this machine, de-duplicated.
 *
 * When the same server appears both in `claude mcp list` and in a config file,
 * we keep ONE entry and prefer the file's resolved company — the CLI read the
 * actual credential there, where the CLI listing only knows a name.
 */
export async function enumerateSolidProviders(deps: EnumerateDeps): Promise<SolidProvider[]> {
  const [cli, files] = await Promise.all([
    providersFromClaudeCli(deps),
    providersFromConfigFiles(deps),
  ]);

  const merged: SolidProvider[] = [];
  const consumed = new Set<SolidProvider>();

  for (const c of cli) {
    // ⛔ `claude mcp list` reports what the Claude Code CLI loads, and that
    // client's user-scope file is ~/.claude.json — the 'vscode' path in
    // configPathForClient. So a user-scoped entry from the listing may ONLY be
    // enriched from that file. Matching any file with the same name pulls in
    // Claude Desktop's separate, differently-keyed server.
    const match =
      c.scope === 'account'
        ? undefined
        : files.find((f) => f.name === c.name && f.client === 'vscode');

    if (match) {
      consumed.add(match);
      merged.push({
        ...c,
        client: match.client,
        configPath: match.configPath,
        companyId: match.companyId,
        companyName: match.companyName,
        unresolved: match.companyId === null ? (match.unresolved ?? c.unresolved) : undefined,
        cliCanRepoint: true,
      });
    } else {
      merged.push(c);
    }
  }

  // Everything else is a real, separate provider — a Cursor or Desktop server
  // the `claude` CLI never reports. Adam's stale Desktop key lives here, and
  // dropping it would hide a credential on the wrong company.
  for (const f of files) {
    if (!consumed.has(f)) merged.push(f);
  }
  return merged;
}

export type ProviderVerdict =
  | 'ok'          // exactly one active provider, proven on the session company
  | 'none'        // no Solid# provider at all — the AI has no business data
  | 'conflict'    // more than one active provider: nothing decides which wins
  | 'mismatch'    // a provider is proven to be on a DIFFERENT company
  | 'unverified'; // one provider, but we cannot prove its company

export interface ProviderAssessment {
  verdict: ProviderVerdict;
  providers: SolidProvider[];
  active: SolidProvider[];
  sessionCompanyId?: number;
  /** One line stating the finding. */
  headline: string;
}

/**
 * Decide whether an AI may be launched.
 *
 * ⛔ ORDER MATTERS, AND IT IS NOT THE OBVIOUS ONE. `conflict` outranks
 * `mismatch`: if two providers are live, a matching company on one of them
 * proves nothing, because nothing guarantees the agent uses that one. Measured
 * on this machine, the agent used the other one.
 */
export function assessProviders(
  providers: SolidProvider[],
  sessionCompanyId?: number,
): ProviderAssessment {
  const active = providers.filter((p) => p.active);
  const base = { providers, active, sessionCompanyId };

  if (active.length === 0) {
    return { ...base, verdict: 'none', headline: 'No Solid# connection is active — an AI here sees no business data.' };
  }
  if (active.length > 1) {
    return {
      ...base,
      verdict: 'conflict',
      headline: `${active.length} Solid# connections are active at once — nothing decides which one the AI uses.`,
    };
  }

  const only = active[0];
  if (only.companyId === null) {
    return {
      ...base,
      verdict: 'unverified',
      headline: `Cannot prove which company "${only.name}" serves.`,
    };
  }
  if (sessionCompanyId && only.companyId !== sessionCompanyId) {
    return {
      ...base,
      verdict: 'mismatch',
      headline: `This session is company ${sessionCompanyId}; the AI would act on company ${only.companyId}.`,
    };
  }
  return {
    ...base,
    verdict: 'ok',
    headline: `One Solid# connection, on company ${only.companyId}${only.companyName ? ` (${only.companyName})` : ''}.`,
  };
}

/**
 * Render a verdict as operator-readable lines.
 *
 * ⛔ EVERY BRANCH ENDS IN A COMMAND OR A SETTING THE READER CAN ACT ON. The
 * version of this that shipped told people their setup was fine, and the
 * version before that said nothing at all. A diagnostic that names a problem
 * without naming the fix just relocates the confusion.
 */
export function renderProviderVerdict(a: ProviderAssessment): string[] {
  // Local import keeps mcp-providers.ts itself free of presentation deps for
  // the pure-function tests.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chalk = require('chalk');
  const L: string[] = [];

  const describe = (p: SolidProvider) => {
    const who =
      p.companyId !== null
        ? chalk.bold(`company ${p.companyId}`) + (p.companyName ? chalk.dim(` (${p.companyName})`) : '')
        : chalk.yellow('company unknown');
    const where =
      p.scope === 'account'
        ? chalk.dim('account connector — lives on claude.ai, not on this machine')
        : chalk.dim(`${p.client ? `${p.client}: ` : ''}${p.configPath || p.scope}`);
    L.push(`    ${p.active ? chalk.green('●') : chalk.dim('○')} ${chalk.bold(p.name)}  →  ${who}`);
    L.push(`      ${where}`);
    if (p.unresolved) L.push(`      ${chalk.dim(p.unresolved)}`);
  };

  if (a.verdict === 'conflict') {
    // ⛔ COUNT IT, DO NOT SPELL IT. This read "Two Solid# connections" while
    // the census below it listed three — the summary contradicting its own
    // evidence, on the screen whose entire job is to be believed.
    L.push(chalk.red.bold(`  ✗ ${a.active.length} Solid# connections are active. Nothing decides which one the AI uses.`));
    L.push('');
    for (const p of a.active) describe(p);
    L.push('');
    L.push(chalk.dim('    Measured 2026-09-15: with both live, the agent used the account'));
    L.push(chalk.dim('    connector and reported on its company, not this session\'s.'));
    L.push('');
    L.push(`    ${chalk.bold('Leave exactly one active:')}`);
    const account = a.active.find((p) => p.scope === 'account');
    if (account) {
      L.push(`      ${chalk.dim('•')} Turn off ${chalk.bold(account.name)} in ${chalk.cyan('claude.ai → Settings → Connectors')},`);
      L.push(`        ${chalk.dim('or re-authorize it for the company you actually want. Its company was')}`);
      L.push(`        ${chalk.dim('fixed when you approved it — no CLI command can move it.')}`);
    }
    // ⛔ NAME THE FILE, NOT JUST THE SERVER. Every client calls it "solid", so
    // "keep solid" is not an instruction when three of them are listed above.
    const locals = a.active.filter((p) => p.scope !== 'account');
    for (const l of locals) {
      const where = l.client ? `${l.client} (${l.configPath})` : l.name;
      L.push(`      ${chalk.dim('•')} ${chalk.bold(l.name)} in ${chalk.dim(where)}`);
    }
    if (locals.length) {
      L.push(`        ${chalk.dim('Keep ONE and point it at this session:')} ${chalk.cyan('solid mcp connect')}`);
      if (locals.length > 1) {
        L.push(`        ${chalk.dim('Remove the others:')} ${chalk.cyan('claude mcp remove <name> -s user')} ${chalk.dim('or edit the file.')}`);
      }
    }
    return L;
  }

  if (a.verdict === 'mismatch') {
    const p = a.active[0];
    L.push(chalk.red.bold('  ✗ The AI would act on a different company than this session.'));
    L.push('');
    L.push(`    ${chalk.dim('This session:')}  company ${chalk.bold(String(a.sessionCompanyId))}`);
    L.push(`    ${chalk.dim('The AI:')}        company ${chalk.bold.red(String(p.companyId))}${p.companyName ? chalk.dim(` (${p.companyName})`) : ''}`);
    L.push('');
    for (const q of a.active) describe(q);
    L.push('');
    L.push(p.cliCanRepoint
      ? `    ${chalk.bold('Fix:')} ${chalk.cyan('solid mcp connect')}`
      : `    ${chalk.bold('Fix:')} re-authorize it in ${chalk.cyan('claude.ai → Settings → Connectors')} — this CLI cannot move it.`);
    return L;
  }

  if (a.verdict === 'unverified') {
    const p = a.active[0];
    L.push(chalk.yellow.bold('  ⚠ Cannot prove which company this AI will act on.'));
    L.push('');
    describe(p);
    L.push('');
    if (p.scope === 'account') {
      L.push(chalk.dim('    An account connector carries a token minted on the consent screen and'));
      L.push(chalk.dim('    held on the backend. Nothing on this machine can read or change it.'));
      L.push('');
      L.push(`    ${chalk.bold('To be certain:')} ask the AI ${chalk.cyan('"what company do you see"')}`);
      // ⛔ NAME THE PLACE. "Turn the connector off" is not an instruction if
      // the reader does not know where it lives — and by definition they do
      // not, because it is the one piece of this that is NOT on their machine.
      L.push(`    ${chalk.bold('To control it here:')} turn it off in ${chalk.cyan('claude.ai → Settings → Connectors')},`);
      L.push(`                        ${chalk.dim('then run')} ${chalk.cyan('solid mcp connect')}`);
    } else {
      L.push(`    ${chalk.bold('Fix:')} ${chalk.cyan('solid mcp connect')}`);
    }
    return L;
  }

  if (a.verdict === 'none') {
    L.push(chalk.yellow.bold('  ⚠ No Solid# connection is active — an AI here sees no business data.'));
    L.push('');
    L.push(`    ${chalk.bold('Fix:')} ${chalk.cyan('solid mcp connect')}`);
    return L;
  }

  L.push(chalk.green(`  ✓ ${a.headline}`));
  return L;
}
