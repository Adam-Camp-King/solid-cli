/**
 * solid mcp — install / serve / tools for Claude Desktop, Cursor, Windsurf.
 *
 * Sprint 1 T1.5. Three subcommands:
 *
 *   solid mcp connect [tool]     # point ANY AI at this business (start here)
 *   solid mcp install <client>   # wire Claude/Cursor/Windsurf config
 *   solid mcp install <client> --uninstall
 *   solid mcp serve              # spawn the stdio MCP server (npx @solidnumber/mcp)
 *   solid mcp tools              # hit /api/v1/mcp/manifest, print tool list
 *   solid mcp tools --json       # same, machine-readable
 *
 * Pure config logic lives in src/lib/mcp-client-config.ts — this file
 * is the thin fs/network/spawn wrapper.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, mergeGlobalJson } from '../lib/json-output';
import {
  McpClient,
  SUPPORTED_CLIENTS,
  buildServerEntry,
  configPathForClient,
  isSupportedClient,
  mergeIntoConfig,
  removeFromConfig,
  serializeConfig,
  DEFAULT_MCP_PACKAGE,
} from '../lib/mcp-client-config';
import {
  AI_TOOLS,
  AiTool,
  CONNECTOR_URL,
  findTool,
  toolIds,
} from '../lib/ai-tool-connect';

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export const mcpCommand = new Command('mcp').description(
  'Connect an AI to this business, and install / run the Solid# MCP server',
);

// ---------------------------------------------------------------------------
// solid mcp connect [tool] — the first thing a new user should run
// ---------------------------------------------------------------------------
//
// ⛔ THE DEAD END THIS EXISTS TO REMOVE.
//
// install.sh says it "wires Claude Code". What it does is run `claude mcp add`,
// which requires `claude` on PATH — and when it is absent the step no-ops
// SILENTLY. The user then types `claude`, gets `command not found`, and stops.
// The docs never say to install Claude Code first, and Prerequisites correctly
// says Claude is not required. Both true; together a wall.
//
// So this command's most important job is the case where the tool is NOT
// installed: name the missing binary, print the one line that installs it, and
// offer the browser path that needs nothing at all. Never no-op, never assume.

function binaryExists(bin: string): boolean {
  // `command -v` without a shell: probe PATH ourselves so this stays portable
  // and cannot be tricked by a shell alias that does not exist for the agent.
  const paths = (process.env.PATH || '').split(path.delimiter).filter(Boolean);
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', '.bat', ''] : [''];
  for (const dir of paths) {
    for (const ext of exts) {
      try {
        fs.accessSync(path.join(dir, bin + ext), fs.constants.X_OK);
        return true;
      } catch {
        /* keep looking */
      }
    }
  }
  return false;
}

function printTool(tool: AiTool): void {
  const missing = tool.requiresBinary && !binaryExists(tool.requiresBinary);

  console.log('');
  console.log(chalk.bold(`Connect ${tool.label}`));
  // "nothing to install" is only true when nothing has to be installed.
  // claude-code speaks the hosted connector AND needs the claude binary, and
  // saying otherwise recreates the exact dead end this command exists to fix.
  const transportLine =
    tool.transport === 'connector'
      ? tool.requiresBinary
        ? `hosted OAuth connector — requires ${tool.requiresBinary}`
        : 'hosted OAuth connector — nothing to install'
      : 'local MCP server (stdio)';
  console.log(chalk.dim(`  transport: ${transportLine}`));
  console.log('');

  if (missing) {
    console.log(chalk.yellow(`  ⚠ ${tool.requiresBinary} is not installed on this machine.`));
    if (tool.installHint) {
      console.log(chalk.yellow('    Install it first:'));
      console.log(`      ${chalk.cyan(tool.installHint)}`);
    }
    console.log(chalk.yellow('    Or skip it entirely — the browser path needs nothing:'));
    console.log(`      ${chalk.cyan('solid mcp connect claude-web')}`);
    console.log('');
  }

  tool.steps.forEach((step, i) => {
    const looksLikeCommand = /^(solid|claude|npx|npm) /.test(step);
    console.log(`  ${chalk.dim(String(i + 1) + '.')} ${looksLikeCommand ? chalk.cyan(step) : step}`);
  });

  if (tool.notes?.length) {
    console.log('');
    for (const note of tool.notes) console.log(chalk.dim(`  note: ${note}`));
  }

  if (tool.transport === 'stdio') {
    // The tenant-pinning trap, printed where it is acted on rather than
    // discovered later by an agent answering about the wrong company.
    console.log('');
    console.log(chalk.dim('  note: the local server authenticates with a stored API key, and the'));
    console.log(chalk.dim('        company comes from that key — `solid switch` does NOT move it.'));
  }
  console.log('');
}

function printToolList(): void {
  console.log('');
  console.log(chalk.bold('Point your AI at this business.'));
  console.log(chalk.dim(`If your tool speaks MCP, the whole integration is one URL:`));
  console.log(`  ${chalk.cyan(CONNECTOR_URL)}`);
  console.log('');
  console.log(chalk.bold('  Nothing to install (browser / OAuth):'));
  for (const t of AI_TOOLS.filter((x) => x.transport === 'connector' && !x.requiresBinary)) {
    console.log(`    ${chalk.green(t.id.padEnd(16))} ${t.label}`);
  }
  console.log('');
  console.log(chalk.bold('  Needs the tool installed locally:'));
  for (const t of AI_TOOLS.filter((x) => x.transport === 'stdio' || x.requiresBinary)) {
    const mark = t.requiresBinary && !binaryExists(t.requiresBinary)
      ? chalk.yellow(' (not installed)')
      : '';
    console.log(`    ${chalk.green(t.id.padEnd(16))} ${t.label}${mark}`);
  }
  console.log('');
  console.log(chalk.dim(`  solid mcp connect <tool>     e.g. solid mcp connect gpt`));
  console.log('');
}

mcpCommand
  .command('connect [tool]')
  .description(`Point an AI at this business (${toolIds().slice(0, 6).join(' | ')} | ...)`)
  .option('--json', 'Emit the connection recipe as JSON')
  .action(async (tool: string | undefined, opts: Record<string, unknown>) => {
    if (!tool) {
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ connector_url: CONNECTOR_URL, tools: AI_TOOLS }, null, 2) + '\n');
        return;
      }
      printToolList();
      return;
    }

    const found = findTool(tool);
    if (!found) {
      // ⛔ An unknown name must never dead-end either. The connector URL works
      // for anything that speaks MCP, so the fallback is an ANSWER, not an error.
      const msg = `No recipe for '${tool}'. Known: ${toolIds().join(', ')}`;
      if (isJsonOutput(opts)) {
        process.stdout.write(
          JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400, message: msg },
                           connector_url: CONNECTOR_URL }, null, 2) + '\n',
        );
        process.exit(1);
      }
      console.log(chalk.yellow(`\n  ${msg}`));
      console.log(chalk.dim('  If it speaks MCP, this URL is the whole integration:'));
      console.log(`  ${chalk.cyan(CONNECTOR_URL)}\n`);
      process.exit(1);
    }

    if (isJsonOutput(opts)) {
      process.stdout.write(
        JSON.stringify({
          ...found,
          connector_url: CONNECTOR_URL,
          prerequisite_missing: found.requiresBinary ? !binaryExists(found.requiresBinary) : false,
        }, null, 2) + '\n',
      );
      return;
    }

    printTool(found);
  });

// ---------------------------------------------------------------------------
// solid mcp install <client>
// ---------------------------------------------------------------------------
mcpCommand
  .command('install <client>')
  .description(`Wire the Solid# MCP into a client config (${SUPPORTED_CLIENTS.join(' | ')})`)
  .option('--api-url <url>', 'Backend URL (defaults to https://api.solidnumber.com)')
  .option('--api-key <key>', 'Explicit API key (otherwise taken from saved session)')
  .option('--company <id>', 'Pin the MCP server to a specific company_id')
  .option('--package <name>', `MCP npm package to invoke (default: ${DEFAULT_MCP_PACKAGE})`)
  .option('--uninstall', 'Remove the Solid# entry from the client config')
  .option('--preview', "Print what would be written without touching disk")
  .option('--json', 'Emit the resulting config as JSON on stdout')
  .action(async (client: string, opts: Record<string, unknown>) => {
    if (!isSupportedClient(client)) {
      const msg = `Unknown MCP client '${client}'. Supported: ${SUPPORTED_CLIENTS.join(', ')}`;
      if (isJsonOutput(opts)) {
        process.stdout.write(
          JSON.stringify({ error: { code: 'VALIDATION_FAILED', status: 400, message: msg } }, null, 2) + '\n',
        );
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }

    const configPath = configPathForClient(client);
    const existing = readExistingConfig(configPath);

    let nextConfig;
    if (opts.uninstall) {
      nextConfig = removeFromConfig(existing);
    } else {
      const apiKey =
        (typeof opts.apiKey === 'string' && opts.apiKey) ||
        process.env.SOLID_API_KEY ||
        config.accessToken ||
        undefined;
      const apiUrl =
        (typeof opts.apiUrl === 'string' && opts.apiUrl) ||
        process.env.SOLID_API_URL ||
        'https://api.solidnumber.com';
      const entry = buildServerEntry({
        apiKey,
        apiUrl,
        companyId: (opts.company as string | number | undefined) ?? undefined,
        packageName: typeof opts.package === 'string' ? opts.package : undefined,
      });
      nextConfig = mergeIntoConfig(existing, entry);
    }

    const serialized = serializeConfig(nextConfig);

    // BUG-1 fix: `--dry-run` at program level is a global (src/index.ts:142)
    // that commander consumes before the subcommand action sees it. We use
    // `--preview` here and ALSO honor the global isDryRun() so both paths
    // short-circuit before any fs.writeFileSync. Writing a real JWT to disk
    // from a command that claimed --dry-run was a real safety failure.
    const { isDryRun } = await import('../lib/dry-run');
    if (opts.preview || isDryRun()) {
      if (isJsonOutput(opts)) {
        process.stdout.write(serialized);
      } else {
        console.log(chalk.yellow('[preview] would write to:'), configPath);
        console.log(serialized);
      }
      return;
    }

    try {
      fs.mkdirSync(path.dirname(configPath), { recursive: true });
      fs.writeFileSync(configPath, serialized);
    } catch (err) {
      const msg = `Failed to write ${configPath}: ${(err as Error).message}`;
      if (isJsonOutput(opts)) {
        process.stdout.write(
          JSON.stringify({ error: { code: 'SERVER_ERROR', status: 500, message: msg } }, null, 2) + '\n',
        );
      } else {
        console.error(chalk.red(msg));
      }
      process.exit(1);
    }

    if (isJsonOutput(opts)) {
      process.stdout.write(serialized);
      return;
    }
    const action = opts.uninstall ? 'Removed' : 'Installed';
    console.log(chalk.green(`${action} Solid# MCP in ${client} config:`));
    console.log(chalk.dim(`  ${configPath}`));
    if (!opts.uninstall) {
      console.log('');
      console.log(chalk.bold('Next steps:'));
      console.log(`  1. Quit and relaunch ${clientLaunchName(client)}`);
      console.log(`  2. Ask the agent: "list solid tools"`);
    }
  });

// ---------------------------------------------------------------------------
// solid mcp serve
// ---------------------------------------------------------------------------
mcpCommand
  .command('serve')
  .description(`Spawn the Solid# MCP server (stdio). Passes SOLID_API_KEY + SOLID_API_URL through.`)
  .option('--package <name>', `Npm package to invoke (default: ${DEFAULT_MCP_PACKAGE})`)
  .option('--api-url <url>', 'Backend URL override')
  .option('--company <id>', 'Pin the MCP server to a specific company_id')
  .action(async (opts: Record<string, unknown>) => {
    const pkg = typeof opts.package === 'string' ? opts.package : DEFAULT_MCP_PACKAGE;
    const env: NodeJS.ProcessEnv = { ...process.env };
    // Priority: explicit flag > existing env > session-cached token
    if (typeof opts.apiUrl === 'string' && opts.apiUrl) env.SOLID_API_URL = opts.apiUrl;
    if (!env.SOLID_API_KEY && config.accessToken) env.SOLID_API_KEY = config.accessToken;
    if (opts.company !== undefined && opts.company !== null && opts.company !== '') {
      env.SOLID_COMPANY_ID = String(opts.company);
    }
    const child = spawn('npx', ['-y', pkg], {
      stdio: 'inherit',
      env,
    });
    child.on('exit', (code) => {
      process.exit(code ?? 0);
    });
    child.on('error', (err) => {
      console.error(chalk.red(`Failed to launch ${pkg}: ${err.message}`));
      process.exit(1);
    });
  });

// ---------------------------------------------------------------------------
// solid mcp tools
// ---------------------------------------------------------------------------
mcpCommand
  .command('tools')
  .description('List MCP tools available to AI clients (reads /api/v1/agent/verbs)')
  .option('--json', 'Emit the full manifest as JSON')
  .action(async (opts: Record<string, unknown>) => {
    const resp = await apiClient.get<Record<string, unknown>>('/api/v1/agent/verbs', {
      params: { surface: 'mcp_stdio' },
    });
    const data = resp.data;

    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify(data, null, 2) + '\n');
      return;
    }
    const verbs = Array.isArray(data.verbs) ? (data.verbs as Array<Record<string, unknown>>) : [];
    const total = typeof data.count === 'number' ? data.count : verbs.length;
    console.log('');
    console.log(chalk.bold(`Solid# MCP tools — ${total} verbs available to AI clients`));
    const grouped = new Map<string, typeof verbs>();
    for (const v of verbs) {
      const ns = typeof v.name === 'string' ? (v.name as string).split('.')[0] : 'other';
      if (!grouped.has(ns)) grouped.set(ns, []);
      grouped.get(ns)!.push(v);
    }
    const sorted = [...grouped.entries()].sort((a, b) => b[1].length - a[1].length);
    for (const [ns, list] of sorted) {
      console.log('');
      console.log(chalk.cyan(`  ${ns}`), chalk.dim(`(${list.length})`));
      for (const v of list.slice(0, 8)) {
        const name = typeof v.name === 'string' ? v.name : '?';
        const shape = typeof v.shape === 'string' ? chalk.dim(`[${v.shape}]`) : '';
        console.log(`    ${chalk.green('●')} ${chalk.bold(name)} ${shape}`);
      }
      if (list.length > 8) console.log(chalk.dim(`    ... and ${list.length - 8} more`));
    }
    console.log('');
    console.log(chalk.dim(`  Run with --json for full machine output.`));
    console.log('');
  });

// ---------------------------------------------------------------------------
// Helpers (thin I/O) — kept here since they're test-via-integration only.
// ---------------------------------------------------------------------------

function readExistingConfig(filePath: string): Record<string, unknown> | null {
  if (!fs.existsSync(filePath)) return null;
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(raw);
  } catch {
    // Corrupt/empty — treat as absent so we write a fresh one.
    return null;
  }
}

function clientLaunchName(client: McpClient): string {
  switch (client) {
    case 'claude': return 'Claude Desktop';
    case 'cursor': return 'Cursor';
    case 'windsurf': return 'Windsurf';
    case 'vscode': return 'VS Code (Claude Code extension)';
  }
}

// ---------------------------------------------------------------------------
// solid mcp doctor
// ---------------------------------------------------------------------------
mcpCommand
  .command('doctor')
  .description('Diagnose every Solid# connection an AI here can reach, and which company each one serves')
  // ⛔ --json was documented in the examples block and accepted by the shell
  // but never DEFINED, so `solid mcp doctor --json` printed the human report
  // and exited 0. A script reading that got prose and no way to know. Seen on
  // Adam's terminal 2026-09-15.
  .option('--json', 'Machine-readable report (every connection, with its company)')
  .action(async (rawOptions: { json?: boolean }, cmd?: Command) => {
    // ⛔ THE SUBCOMMAND'S OWN opts() DOES NOT SEE --json, AND THAT IS NOT A
    // TYPO. Declaring `.option('--json')` on `doctor` is necessary but not
    // sufficient: `solid` declares a program-wide `--json` too, and commander
    // binds the flag to the ROOT there — measured, `cmd.opts()` is `{}` while
    // `program.opts()` is `{ json: true }`. Reading the local options alone is
    // why `solid mcp doctor --json` printed prose. `mergeGlobalJson` is the
    // house convention for exactly this and must be used by every subcommand
    // that offers --json.
    const options = mergeGlobalJson(rawOptions, cmd);
    const ora = (await import('ora')).default;
    const checks: Array<{ label: string; ok: boolean; detail: string }> = [];

    // 1. Auth check
    const hasAuth = config.isLoggedIn();
    checks.push({
      label: 'Authentication',
      ok: hasAuth,
      detail: hasAuth ? 'Logged in' : 'Not logged in — run `solid auth login`',
    });

    // 2. API connectivity
    let apiOk = false;
    let verbCount = 0;
    const spinner = ora('Checking API connectivity...').start();
    try {
      const res = await apiClient.get<{ verbs: Array<Record<string, unknown>>; count: number }>(
        '/api/v1/agent/verbs?surface=mcp_stdio',
      );
      apiOk = true;
      verbCount = res.data?.count ?? res.data?.verbs?.length ?? 0;
      spinner.stop();
    } catch (err) {
      spinner.stop();
    }
    checks.push({
      label: 'API connectivity',
      ok: apiOk,
      detail: apiOk ? `Reachable at ${config.apiUrl || 'default'}` : 'Cannot reach backend',
    });

    // 3. Verb count
    checks.push({
      label: 'Verb count',
      ok: verbCount > 0,
      detail: verbCount > 0 ? `${verbCount} verbs on mcp_stdio surface` : 'No verbs returned',
    });

    // ⛔ 3b. THE CENSUS: EVERY Solid# CONNECTION, AND WHOSE DATA IT SERVES.
    //
    // This replaces a check that asked "does the local key match my session?".
    // That question was too small. On Adam's machine, 2026-09-15, TWO Solid#
    // providers were live at once:
    //
    //   claude.ai Solid#   https://api.solidnumber.com/mcp/connector   company 1
    //   solid              npx -y @solidnumber/mcp                     no credential
    //
    // while the CLI was signed in to company 61 (ANGL). The old check read
    // local files only, found no key, returned null, and said nothing. The
    // agent used the remote connector and reported confidently on company 1.
    //
    // ⛔ A DIAGNOSTIC MUST REPORT WHAT IT CANNOT SEE. `solid ai` tolerates
    // "unknown" so a network blip never becomes an outage; the doctor has the
    // opposite duty — unknown is printed as not-ok, with the reason, because
    // the whole point of running it is to find out.
    let assessment: import('../lib/mcp-providers').ProviderAssessment | null = null;
    const { renderProviderVerdict } = await import('../lib/mcp-providers.js');
    try {
      const { enumerateSolidProviders, assessProviders } = await import('../lib/mcp-providers.js');
      const providers = await enumerateSolidProviders({ apiUrl: config.apiUrl });
      assessment = assessProviders(providers, config.companyId);

      checks.push({
        label: 'Solid# connections',
        ok: assessment.verdict === 'ok',
        detail: assessment.headline,
      });

      // One line per connection — the thing that was impossible to see before.
      for (const pr of assessment.providers) {
        const where =
          pr.scope === 'account' ? 'account connector (claude.ai)'
          : pr.configPath ? pr.configPath
          : pr.scope;
        const company =
          pr.companyId !== null
            ? `company ${pr.companyId}${pr.companyName ? ` (${pr.companyName})` : ''}`
            : `company UNKNOWN — ${pr.unresolved}`;
        checks.push({
          label: `  ↳ ${pr.name}`,
          ok: pr.companyId !== null && pr.companyId === config.companyId && pr.active,
          detail: `${pr.active ? 'active' : 'inactive'} · ${where} · ${company}` +
                  (pr.cliCanRepoint ? '' : ' · this CLI cannot re-point it'),
        });
      }
    } catch (err) {
      checks.push({
        label: 'Solid# connections',
        ok: false,
        detail: `Could not enumerate: ${(err as Error).message}`,
      });
    }

    // 4. MCP package installed check
    let packageInstalled = false;
    try {
      const { execSync } = await import('child_process');
      const out = execSync('npm list -g @solidnumber/mcp --depth=0 2>/dev/null', { encoding: 'utf-8' });
      packageInstalled = out.includes('@solidnumber/mcp');
    } catch { /* not installed globally */ }
    checks.push({
      label: '@solidnumber/mcp installed',
      ok: packageInstalled,
      detail: packageInstalled ? 'Installed globally' : 'Not found globally — clients use npx on demand',
    });

    // 5. Client config check
    //
    // ⛔ THIS USED TO BE A FALSE GREEN, AND IT REPORTED ONE ON THE VERY MACHINE
    // THAT HAD THE BUG. It asked only `'solid' in servers` — does a key with
    // that name exist. Adam's ~/.claude.json held:
    //
    //     "solid": { "command": "npx", "args": ["-y", "@solidnumber/mcp"],
    //                "env": { "SOLID_API_URL": "https://api.solidnumber.com" } }
    //
    // No SOLID_API_KEY. That server authenticates as nobody — /auth/me returns
    // 404 — and the doctor printed "✓ claude config: Solid# MCP wired" beside
    // it. "An entry exists" is not "an AI can use it"; presence is not a
    // credential. Now we require a resolvable credential to call it wired.
    for (const client of SUPPORTED_CLIENTS) {
      const cfgPath = configPathForClient(client);
      const exists = cfgPath && fs.existsSync(cfgPath);
      let entryName: string | null = null;
      let hasKey = false;
      if (exists && cfgPath) {
        try {
          const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const servers = raw?.mcpServers || {};
          for (const [name, cfg] of Object.entries<any>(servers)) {
            if (name !== 'solid' && name !== 'solidnumber' && !/\bsolid#?\b/i.test(name)) continue;
            entryName = name;
            hasKey = !!(cfg?.env?.SOLID_API_KEY && String(cfg.env.SOLID_API_KEY).trim());
            if (hasKey) break;
          }
        } catch { /* corrupt config */ }
      }
      checks.push({
        label: `${client} config`,
        ok: !!entryName && hasKey,
        detail: !entryName
          ? (exists ? 'Config exists, Solid# not wired' : 'No config file')
          : hasKey
            ? `Solid# wired with a credential ("${entryName}")`
            : `"${entryName}" is present but carries NO SOLID_API_KEY — it authenticates as nobody. Run \`solid mcp connect\`.`,
      });
    }

    // Print results
    if (options.json) {
      console.log(JSON.stringify({
        sessionCompanyId: config.companyId ?? null,
        verdict: assessment?.verdict ?? 'unknown',
        headline: assessment?.headline ?? null,
        providers: assessment?.providers ?? [],
        checks,
        passing: checks.filter(c => c.ok).length,
        total: checks.length,
      }, null, 2));
      // ⛔ Non-zero on a tenant verdict so CI and scripts can gate on it. A
      // doctor that always exits 0 cannot be used by anything but a human.
      if (assessment && assessment.verdict !== 'ok') process.exitCode = 1;
      return;
    }

    console.log('');
    console.log(chalk.bold('  MCP Doctor'));
    console.log('');
    for (const c of checks) {
      const icon = c.ok ? chalk.green('✓') : chalk.red('✗');
      console.log(`  ${icon} ${chalk.bold(c.label)}: ${c.ok ? chalk.dim(c.detail) : chalk.yellow(c.detail)}`);
    }
    const passing = checks.filter(c => c.ok).length;
    console.log('');
    console.log(chalk.dim(`  ${passing}/${checks.length} checks passing`));

    // ⛔ THE VERDICT GETS ITS OWN BLOCK. Burying "two connections disagree"
    // as one ✗ among eight lines is how it went unnoticed: the screenshot that
    // reported this bug showed "5/8 checks passing" and the operator read it
    // as fine.
    if (assessment && assessment.verdict !== 'ok') {
      console.log('');
      for (const line of renderProviderVerdict(assessment)) console.log(line);
      process.exitCode = 1;
    }
    console.log('');
  });

import { appendExamples as __ae_mcp } from '../lib/command-kit';
__ae_mcp(mcpCommand, [
  { cmd: 'solid mcp install claude',            why: 'Wire Solid# into Claude Desktop' },
  { cmd: 'solid mcp install vscode',            why: 'Wire Solid# into the Claude Code VS Code extension (works on older macOS)' },
  { cmd: 'solid mcp install cursor --company <id>', why: 'Install pinned to a specific company (find IDs via `solid company list`)' },
  { cmd: 'solid mcp install claude --preview',  why: 'Show what WOULD be written — no disk write' },
  { cmd: 'solid mcp tools --json',              why: 'Machine-readable tool manifest' },
  { cmd: 'solid mcp serve',                      why: 'Launch the stdio server directly' },
  { cmd: 'solid mcp doctor',                     why: 'Check MCP server health and client wiring' },
]);
