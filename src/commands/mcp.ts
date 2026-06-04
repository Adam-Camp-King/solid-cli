/**
 * solid mcp — install / serve / tools for Claude Desktop, Cursor, Windsurf.
 *
 * Sprint 1 T1.5. Three subcommands:
 *
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
import { isJsonOutput } from '../lib/json-output';
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

// ---------------------------------------------------------------------------
// Root
// ---------------------------------------------------------------------------
export const mcpCommand = new Command('mcp').description(
  'Install / run the Solid# MCP server for Claude Desktop, Cursor, Windsurf, or VS Code (Claude Code extension)',
);

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
  .description('Diagnose MCP server health: API connectivity, auth, verb count, version alignment')
  .action(async () => {
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
    for (const client of SUPPORTED_CLIENTS) {
      const cfgPath = configPathForClient(client);
      const exists = cfgPath && fs.existsSync(cfgPath);
      let wired = false;
      if (exists && cfgPath) {
        try {
          const raw = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
          const servers = raw?.mcpServers || {};
          wired = 'solidnumber' in servers || 'solid' in servers;
        } catch { /* corrupt config */ }
      }
      checks.push({
        label: `${client} config`,
        ok: wired,
        detail: wired ? 'Solid# MCP wired' : exists ? 'Config exists, Solid# not wired' : 'No config file',
      });
    }

    // Print results
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
    console.log('');
  });

import { appendExamples as __ae_mcp } from '../lib/command-kit';
__ae_mcp(mcpCommand, [
  { cmd: 'solid mcp install claude',            why: 'Wire Solid# into Claude Desktop' },
  { cmd: 'solid mcp install vscode',            why: 'Wire Solid# into the Claude Code VS Code extension (works on older macOS)' },
  { cmd: 'solid mcp install cursor --company <id>', why: 'Install pinned to a specific company (find IDs via `solid auth companies`)' },
  { cmd: 'solid mcp install claude --preview',  why: 'Show what WOULD be written — no disk write' },
  { cmd: 'solid mcp tools --json',              why: 'Machine-readable tool manifest' },
  { cmd: 'solid mcp serve',                      why: 'Launch the stdio server directly' },
  { cmd: 'solid mcp doctor',                     why: 'Check MCP server health and client wiring' },
]);
