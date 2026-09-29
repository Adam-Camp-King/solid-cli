/**
 * solid update — get to the latest CLI, whichever way this copy was installed.
 *
 * The notifier already tells you a new version exists (see the update-notifier
 * block in index.ts) and then leaves you to remember the incantation. This runs
 * it — and, more usefully, it knows WHICH incantation, because the right one
 * depends on how this copy got here:
 *
 *   npm    npm install -g @solidnumber/cli@latest
 *   brew   brew upgrade solidnumber/tap/cli
 *   scoop  scoop update solid
 *
 * ⛔ THE BUG THIS EXISTS FOR IS THE SECOND COPY. A machine can carry more than
 * one `solid` on PATH — an npm global under nvm AND a Homebrew formula. Whichever
 * comes first in PATH wins, so upgrading one leaves the other lying in wait: a
 * new shell before nvm initialises, or a Node version switch, and you are
 * silently running a CLI from weeks ago that disagrees with the backend about
 * which verbs exist. Found on Adam's own machine 2026-09-12: nvm 2.17.0 in front
 * of a Homebrew 2.11.13 — seven releases apart, and nothing said a word. The
 * notifier CANNOT see this: it only ever looks at the copy that is running.
 *
 * It also brings the MCP server current: every client config that launches a
 * bare `@solidnumber/mcp` (frozen in npx's cache) is switched to `@latest`, and
 * a global npm install is upgraded. See lib/mcp-freshness.ts.
 *
 * Then everything else the CLI put on the machine — see refreshMachine() — and
 * after a CLI upgrade that part is run by the NEW binary (`update --finish`).
 * Full design: Owners-Manual/45-Developer-CLI/25-SOLID-UPDATE.md.
 *
 *   solid update                  upgrade the CLI and the MCP server
 *   solid update --check          say what would happen, change nothing
 *   solid update --json           do it, and report it as JSON (for an agent)
 *   solid update --check --json   report only, as JSON
 */
import { spawnSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { delimiter, join } from 'path';

import chalk from 'chalk';
import { Command, Option } from 'commander';

import { CLI_VERSION } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { refreshCachedChromium } from '../lib/browser-install';
import { refreshClaudeHook } from '../lib/claude-hook';
import { MCP_LATEST_SPEC, McpFreshnessReport, refreshMcp } from '../lib/mcp-freshness';
import { KitReport, refreshAllKits } from '../lib/project-kits';
import { refreshInstalledCompletions } from './completion';


export const PACKAGE_NAME = '@solidnumber/cli';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;
/** The first release whose `solid update` understands `--finish`. */
export const FINISH_SINCE = '2.24.12';

export type Installer = 'npm' | 'brew' | 'scoop' | 'unknown';

export interface InstallInfo {
  installer: Installer;
  /** argv to run, or null when we cannot tell — then we say so rather than guess. */
  command: string[] | null;
  /**
   * Run before `command`, when the upgrade needs something in place first.
   * Homebrew's is `brew tap solidnumber/tap`: `brew upgrade user/repo/formula`
   * does NOT auto-tap (only `brew install` does), so on a machine whose tap has
   * gone missing the upgrade dies with "requires the tap solidnumber/tap".
   * Tapping is idempotent and cheap, so we just do it every time.
   */
  preflight?: string[];
}

export interface OtherCopy {
  path: string;
  version: string | null;
}

/** Which package manager owns the file at `path`. Pure — the tests drive it directly. */
export function detectInstaller(path: string | null): InstallInfo {
  if (!path) return { installer: 'unknown', command: null };
  const p = path.replace(/\\/g, '/').toLowerCase();

  // Homebrew before npm: a brew formula's payload also lives in a node_modules
  // directory (the formula installs into the keg's libexec), so the npm check
  // would swallow it and print the wrong command.
  //
  // ⛔ THE TEST IS /Cellar/, NEVER /homebrew/. A Homebrew PREFIX is not a
  // Homebrew INSTALL: `npm i -g` under a brew-installed node lands in
  // /opt/homebrew/lib/node_modules/@solidnumber/cli — an npm global that merely
  // lives inside the brew tree. Calling that brew sent `brew upgrade
  // solidnumber/tap/cli` to a machine that had never tapped, which is exactly
  // the error Adam hit on the iMac 2026-09-17. install.sh has always matched
  // */Cellar/* — this is the same rule, finally spelled the same way.
  if (p.includes('/cellar/')) {
    return {
      installer: 'brew',
      command: ['brew', 'upgrade', 'solidnumber/tap/cli'],
      preflight: ['brew', 'tap', 'solidnumber/tap'],
    };
  }
  if (p.includes('/scoop/') || p.includes('scoop/apps/')) {
    return { installer: 'scoop', command: ['scoop', 'update', 'solid'] };
  }
  if (p.includes('node_modules/@solidnumber/cli')) {
    // --prefer-online: right after a release npm's cached package list does not have
    // the new version yet, so `@latest` resolved to a version the cache could not
    // find (ETARGET) — solid update failed for the first minutes of every release.
    return { installer: 'npm', command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`, '--prefer-online'] };
  }
  return { installer: 'unknown', command: null };
}

/** semver-ish compare, enough for "is b newer than a". Pre-release tags ignored. */
export function isNewer(current: string, candidate: string): boolean {
  const parts = (v: string) => v.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
  const [a, b] = [parts(current), parts(candidate)];
  for (let i = 0; i < 3; i += 1) {
    if ((b[i] ?? 0) > (a[i] ?? 0)) return true;
    if ((b[i] ?? 0) < (a[i] ?? 0)) return false;
  }
  return false;
}

/** The newest published version, or null. Never throws — being offline is not an error here. */
export async function latestVersion(fetchImpl: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(REGISTRY, { headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { version?: unknown };
    return typeof body.version === 'string' ? body.version : null;
  } catch {
    return null;
  }
}

/** Every OTHER `solid` on PATH — the copies the update notifier can never see. */
export function otherCopiesOnPath(selfPath: string | null, env = process.env): OtherCopy[] {
  const names = process.platform === 'win32' ? ['solid.cmd', 'solid.exe', 'solid'] : ['solid'];
  const seen = new Set<string>();
  if (selfPath) seen.add(selfPath);
  const found: OtherCopy[] = [];

  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      let real = candidate;
      try {
        real = realpathSync(candidate);
      } catch {
        /* a broken symlink is not worth failing over */
      }
      if (seen.has(real)) continue;
      seen.add(real);
      found.push({ path: real, version: versionOf(candidate) });
    }
  }
  return found;
}

function versionOf(bin: string): string | null {
  try {
    const out = spawnSync(bin, ['--version'], { encoding: 'utf8', timeout: 10_000 });
    const match = (out.stdout || '').match(/\d+\.\d+\.\d+/);
    return match ? match[0] : null;
  } catch {
    return null;
  }
}

function selfPath(): string | null {
  try {
    return process.argv[1] ? realpathSync(process.argv[1]) : null;
  } catch {
    return process.argv[1] || null;
  }
}

type CliAction =
  | 'current'
  | 'would_update'
  | 'updated'
  | 'update_failed'
  | 'formula_behind'
  | 'updated_unverified'
  | 'offline';

export interface Route {
  installer: Exclude<Installer, 'unknown'>;
  command: string[];
  preflight?: string[];
}

const NPM_ROUTE: Route = {
  installer: 'npm',
  command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`, '--prefer-online'],
};
const BREW_ROUTE: Route = {
  installer: 'brew',
  command: ['brew', 'upgrade', 'solidnumber/tap/cli'],
  preflight: ['brew', 'tap', 'solidnumber/tap'],
};
const SCOOP_ROUTE: Route = { installer: 'scoop', command: ['scoop', 'update', 'solid'] };

/**
 * Every way to update this machine, the one that owns this copy first. Pure.
 *
 * ⛔ A WRONG GUESS MUST NEVER STRAND A CUSTOMER. 2.23.0 read any path containing
 * /homebrew/ as a Homebrew install, ran `brew upgrade` on an npm global, and when
 * that failed printed the same failing command back as "Run it yourself" — the
 * customer on the iMac 2026-09-29 was left with no way forward the CLI offered.
 * Detection is a guess about someone else's machine; the ladder makes the guess
 * cheap to get wrong. `brew upgrade` and `scoop update` only touch a copy that is
 * already installed, so trying them on a machine that lacks one changes nothing.
 */
export function updateRoutes(detected: InstallInfo, platform: string = process.platform): Route[] {
  const routes: Route[] = [];
  if (detected.installer === 'brew') routes.push(BREW_ROUTE);
  if (detected.installer === 'scoop') routes.push(SCOOP_ROUTE);
  if (detected.installer === 'npm') routes.push(NPM_ROUTE);
  for (const r of platform === 'win32' ? [NPM_ROUTE, SCOOP_ROUTE] : [NPM_ROUTE, BREW_ROUTE]) {
    if (!routes.includes(r)) routes.push(r);
  }
  return routes;
}

/** The `solid` a new shell will run, and its version — the only proof an update worked. */
function onPath(me: string | null, env = process.env): { path: string | null; version: string | null } {
  const names = process.platform === 'win32' ? ['solid.cmd', 'solid.exe', 'solid'] : ['solid'];
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return { path: candidate, version: versionOf(candidate) };
    }
  }
  return { path: me, version: me ? versionOf(me) : null };
}

interface Attempt {
  installer: Route['installer'];
  command: string;
  exit: number | null;
  version_after: string | null;
}

/**
 * Walk the ladder until the `solid` on PATH reports `latest`. A zero exit is not
 * success — only the version a new shell will run is.
 */
function runLadder(routes: Route[], latest: string, me: string | null, json: boolean): { action: CliAction; attempts: Attempt[] } {
  const attempts: Attempt[] = [];
  let anyExitedClean = false;
  for (const route of routes) {
    if (route.preflight) spawnSync(route.preflight[0], route.preflight.slice(1), { stdio: 'ignore' });
    if (!json) console.log(`Running ${chalk.cyan(route.command.join(' '))} …\n`);
    // JSON mode keeps stdout clean for the agent: the installer's own output goes to stderr.
    const result = spawnSync(route.command[0], route.command.slice(1), { stdio: json ? ['ignore', 2, 2] : 'inherit' });
    const exit = result?.status ?? null;
    const after = exit === 0 ? onPath(me).version : null;
    attempts.push({ installer: route.installer, command: route.command.join(' '), exit, version_after: after });
    if (exit !== 0) continue;
    anyExitedClean = true;
    if (after && !isNewer(after, latest)) return { action: 'updated', attempts };
    // Homebrew's formula follows npm on a 4-hour poll. It upgraded to the newest
    // formula there is; installing an npm copy on top would only make two.
    if (route.installer === 'brew') return { action: 'formula_behind', attempts };
    if (!json) console.log(chalk.dim(`That finished, but \`solid --version\` still says ${after ?? 'nothing readable'} — trying the next way.\n`));
  }
  // Every route ran and the `solid` a new shell runs is STILL old: it is another
  // copy, first on PATH. When that copy is an npm global under a different
  // prefix (nvm keeps one per Node version), update it where it lives.
  const shadow = onPath(me).path;
  const prefix = shadow ? npmPrefixOf(shadow) : null;
  if (prefix) {
    const command = [...NPM_ROUTE.command, '--prefix', prefix];
    if (!json) console.log(`Running ${chalk.cyan(command.join(' '))} …\n`);
    const result = spawnSync(command[0], command.slice(1), { stdio: json ? ['ignore', 2, 2] : 'inherit' });
    const exit = result?.status ?? null;
    const after = exit === 0 ? onPath(me).version : null;
    attempts.push({ installer: 'npm', command: command.join(' '), exit, version_after: after });
    if (after && !isNewer(after, latest)) return { action: 'updated', attempts };
    if (exit === 0) anyExitedClean = true;
  }
  return { action: anyExitedClean ? 'updated_unverified' : 'update_failed', attempts };
}

/**
 * The npm prefix that owns a `solid` on PATH, or null when it is not an npm
 * global. `<prefix>/bin/solid` → `<prefix>/lib/node_modules/@solidnumber/cli`
 * on macOS/Linux; `<prefix>\\solid.cmd` → `<prefix>\\node_modules\\…` on Windows.
 */
export function npmPrefixOf(binPath: string): string | null {
  let real = binPath;
  try {
    real = realpathSync(binPath);
  } catch {
    /* use it as given */
  }
  const p = real.replace(/\\/g, '/');
  if (detectInstaller(p).installer !== 'npm') return null;
  const i = p.indexOf('/lib/node_modules/@solidnumber/cli');
  if (i > 0) return real.slice(0, i);
  const j = p.indexOf('/node_modules/@solidnumber/cli');
  return j > 0 ? real.slice(0, j) : null;
}

function printMcp(report: McpFreshnessReport, check: boolean): void {
  const wired = report.clients.filter((c) => c.status !== 'unreadable');
  console.log(chalk.bold('\nSolid# MCP') + chalk.dim(report.latest ? `  (latest ${report.latest})` : ''));
  if (!wired.length && !report.global.installed) {
    console.log(chalk.dim('  Not set up on this machine — `solid mcp install <client>` when you want it.'));
  }
  for (const c of report.clients) {
    const where = chalk.dim(c.path);
    if (c.status === 'rewritten') console.log(chalk.green(`  ✓ ${c.client}: now launches ${MCP_LATEST_SPEC}  `) + where);
    else if (c.status === 'would_rewrite') console.log(`  ${c.client}: would switch to ${MCP_LATEST_SPEC}  ${where}`);
    else if (c.status === 'current') console.log(chalk.green(`  ✓ ${c.client}: already launches the latest  `) + where);
    else if (c.status === 'unreadable') console.log(chalk.yellow(`  ${c.client}: config is not valid JSON — left alone  `) + where);
    else console.log(chalk.red(`  ✗ ${c.client}: could not write (${c.error ?? 'unknown error'})  `) + where);
  }
  for (const pin of report.pinned) {
    console.log(chalk.yellow(`  ${pin.client}: "${pin.server}" is pinned to ${pin.spec} — left as chosen`));
  }
  const g = report.global;
  if (g.installed) {
    if (g.action === 'upgraded') console.log(chalk.green(`  ✓ global install: ${g.installed} → ${report.latest}`));
    else if (g.action === 'would_upgrade') console.log(`  global install: would upgrade ${g.installed} → ${report.latest}`);
    else if (g.action === 'upgrade_failed') console.log(chalk.red(`  ✗ global install: upgrade failed — run npm install -g ${MCP_LATEST_SPEC}`));
    else console.log(chalk.green(`  ✓ global install: ${g.installed}`));
  }
  if (report.clients.some((c) => c.status === 'rewritten')) {
    console.log(chalk.dim('  Restart the AI app so it relaunches the server.'));
  }
  if (!check) console.log(chalk.dim('  The MCP SDK ships inside the server, so it is current whenever the server is.'));
}

type PartState = 'absent' | 'current' | 'updated' | 'would_update' | 'failed' | 'offline';

export interface PartReport {
  id: 'claude_hook' | 'completion' | 'project_kits' | 'browser';
  label: string;
  state: PartState;
  detail: string;
  projects?: KitReport[];
}

/**
 * EVERYTHING ELSE the CLI put on this machine, after the CLI and the MCP
 * server. One list, one shape — a thing `solid` installs and this list does
 * not name is a thing that silently goes stale. Each part refreshes only what
 * is already installed; none of them adds something the user did not set up.
 */
export async function refreshMachine(root: Command, apply: boolean): Promise<PartReport[]> {
  const parts: PartReport[] = [];
  const hook = refreshClaudeHook(apply);
  parts.push({ id: 'claude_hook', label: 'Claude Code session hook', ...hook });

  const completion = refreshInstalledCompletions(root, apply);
  parts.push({ id: 'completion', label: 'Shell completion', ...completion });

  const kits = refreshAllKits(CLI_VERSION, apply);
  const kitState: PartState = !kits.length
    ? 'absent'
    : kits.some((k) => k.state === 'failed')
      ? 'failed'
      : kits.some((k) => k.state === 'updated')
        ? 'updated'
        : kits.some((k) => k.state === 'would_update')
          ? 'would_update'
          : 'current';
  parts.push({
    id: 'project_kits',
    label: 'Agent skills + plugin',
    state: kitState,
    detail: kits.length ? `${kits.length} project${kits.length === 1 ? '' : 's'}` : 'none set up',
    projects: kits,
  });

  const browser = await refreshCachedChromium(apply);
  parts.push({ id: 'browser', label: 'Render browser', ...browser });
  return parts;
}

function printParts(parts: PartReport[]): void {
  console.log(chalk.bold('\nOn this machine'));
  for (const p of parts) {
    const line = `${p.label}: ${p.detail}`;
    if (p.state === 'updated') console.log(chalk.green(`  ✓ ${p.label}: updated  `) + chalk.dim(p.detail));
    else if (p.state === 'current') console.log(chalk.green(`  ✓ ${p.label}: current  `) + chalk.dim(p.detail));
    else if (p.state === 'would_update') console.log(`  ${p.label}: would update  ${chalk.dim(p.detail)}`);
    else if (p.state === 'offline') console.log(chalk.yellow(`  ${line} — try again when online`));
    else if (p.state === 'failed') console.log(chalk.red(`  ✗ ${line}`));
    else console.log(chalk.dim(`  ${p.label}: not set up`));
    for (const k of p.projects ?? []) {
      if (k.state === 'failed') console.log(chalk.red(`      ✗ ${k.dir}: ${k.error}`));
      else if (k.state !== 'current') console.log(chalk.dim(`      ${k.dir}: ${k.files} file${k.files === 1 ? '' : 's'}`));
    }
  }
}

/**
 * Hand the rest of the update to the binary that was just installed.
 *
 * ⛔ The process running now is the OLD CLI. Skills, completions and the hook
 * are compiled into the CLI, so if the old process wrote them it would write
 * the old version's — a perfectly executed update that leaves every generated
 * file one release behind. The new binary finishes the job with its own code.
 * Null when it could not be started; the caller then finishes in-process,
 * because a slightly stale refresh beats none.
 */
function handOff(binary: string, json: boolean): { status: number | null; stdout: string } | null {
  const r = spawnSync(binary, ['update', '--finish', ...(json ? ['--json'] : [])], {
    encoding: 'utf8',
    stdio: json ? ['ignore', 'pipe', 2] : 'inherit',
  });
  if (!r || r.error || r.status === null) return null;
  return { status: r.status, stdout: r.stdout || '' };
}

export const updateCommand = new Command('update')
  .description('Update everything Solid# on this machine: the CLI, the MCP server, and every file the CLI set up')
  .option('--check', 'Say what would happen; change nothing')
  .option('--json', 'Emit JSON (runs the update unless --check)')
  .addOption(new Option('--finish', 'Internal: the freshly installed CLI finishing an update').hideHelp())
  .action(async function (this: Command, opts) {
    const check = Boolean(opts.check);
    const json = isJsonOutput(opts);
    const root = this.parent ?? this;

    // ── the new binary, finishing what the old one started ──────────────────
    if (opts.finish) {
      const mcp = await refreshMcp({ apply: !check });
      const parts = await refreshMachine(root, !check);
      if (mcp.clients.some((c) => c.status === 'write_failed') || mcp.global.action === 'upgrade_failed' || parts.some((p) => p.state === 'failed')) {
        process.exitCode = 1;
      }
      if (json) {
        process.stdout.write(JSON.stringify({ finished_by: CLI_VERSION, mcp, machine: parts }, null, 2) + '\n');
        return;
      }
      printMcp(mcp, check);
      printParts(parts);
      return;
    }

    const me = selfPath();
    const detected = detectInstaller(me);
    const { installer } = detected;
    const routes = updateRoutes(detected);
    const latest = await latestVersion();
    const others = otherCopiesOnPath(me);
    const behind = latest ? isNewer(CLI_VERSION, latest) : false;
    const first = routes[0];
    const recipe = [first.preflight, first.command].filter(Boolean).map((s) => s!.join(' ')).join(' && ');

    // ── 1. the CLI ──────────────────────────────────────────────────────────
    let cliAction: CliAction;
    let attempts: Attempt[] = [];
    if (!latest) cliAction = 'offline';
    else if (!behind) cliAction = 'current';
    else if (check) cliAction = 'would_update';
    else {
      if (!json) console.log(`${chalk.bold('Update available')}  ${CLI_VERSION} → ${chalk.green(latest)}`);
      ({ action: cliAction, attempts } = runLadder(routes, latest, me, json));
    }

    const cliFailed = cliAction === 'update_failed';

    // The other copies matter even when this one is current, so say it first.
    if (!json && others.length && latest) {
      console.log(chalk.yellow(`\n⚠ Another 'solid' is on your PATH:`));
      for (const other of others) {
        const stale = other.version && isNewer(other.version, latest);
        console.log(
          `  ${other.path}  ${other.version ?? '(version unknown)'}` + (stale ? chalk.red('  ← behind') : ''),
        );
      }
      console.log(chalk.dim('  Whichever comes first in PATH is the one that runs.'));
      console.log(chalk.dim(`  Update it too, or remove it so there is only one.\n`));
    }

    if (!json) {
      console.log(chalk.bold('Solid# CLI'));
      if (cliAction === 'offline') {
        console.log(chalk.yellow('  Could not reach the npm registry — try again, or run:'));
        console.log(`    ${first.command.join(' ')}`);
      } else if (cliAction === 'current') {
        console.log(chalk.green(`  ✓ Already on the latest — ${CLI_VERSION}.`));
      } else if (cliAction === 'would_update') {
        console.log(`  Update available  ${CLI_VERSION} → ${chalk.green(latest)}`);
        console.log(`  Would run: ${chalk.cyan(recipe)}`);
      } else if (cliAction === 'updated') {
        console.log(chalk.green(`  ✓ Updated to ${latest}.`));
      } else if (cliAction === 'formula_behind') {
        console.log(chalk.yellow(`  Homebrew does not have ${latest} yet — it follows npm within 4 hours.`));
        console.log('  Nothing is broken. Run solid update again later.');
      } else if (cliAction === 'updated_unverified') {
        const runs = onPath(me);
        console.log(chalk.yellow(`  Installed ${latest}, but the solid first on your PATH is still ${runs.version ?? 'unreadable'}:`));
        console.log(`    ${runs.path ?? '(not found)'}`);
        console.log('  Every way to update that copy was tried. Remove it and the updated one runs.');
      } else {
        console.log(chalk.red('  ✗ Could not update automatically. Tried:'));
        for (const a of attempts) console.log(`    ${a.command}  (exit ${a.exit ?? 'not found'})`);
        console.log(`  The one that works on almost every machine:\n    ${NPM_ROUTE.command.join(' ')}`);
      }
    }

    // ── 2. everything else — by the NEW binary when there is one ─────────────
    let finish: { finished_by: string; mcp: McpFreshnessReport; machine: PartReport[] } | null = null;
    // `--finish` exists from FINISH_SINCE on. An older latest (a rolled-back
    // dist-tag) would reject the flag, so this process finishes instead.
    const canFinish = latest !== null && !isNewer(latest, FINISH_SINCE);
    const fresh = cliAction === 'updated' && canFinish ? onPath(me).path : null;
    const handed = fresh ? handOff(fresh, json) : null;
    if (handed) {
      if (handed.status !== 0) process.exitCode = 1;
      if (json) {
        try {
          finish = JSON.parse(handed.stdout);
        } catch {
          finish = null;
        }
      }
    }
    if (!handed || (json && !finish)) {
      const mcp = await refreshMcp({ apply: !check });
      const machine = await refreshMachine(root, !check);
      finish = { finished_by: CLI_VERSION, mcp, machine };
      if (!json) {
        printMcp(mcp, check);
        printParts(machine);
      }
    }

    const failed =
      cliFailed ||
      (finish !== null &&
        (finish.mcp.clients.some((c) => c.status === 'write_failed') ||
          finish.mcp.global.action === 'upgrade_failed' ||
          finish.machine.some((p) => p.state === 'failed')));
    if (failed && !check) process.exitCode = 1;

    if (json) {
      process.stdout.write(
        JSON.stringify(
          {
            current: CLI_VERSION,
            latest,
            up_to_date: latest ? !behind : null,
            installer,
            command: first.command.join(' '),
            preflight: first.preflight ? first.preflight.join(' ') : null,
            attempts,
            other_copies: others,
            ran: !check,
            cli: { action: cliAction },
            finished_by: finish?.finished_by ?? null,
            mcp: finish?.mcp ?? null,
            machine: finish?.machine ?? [],
          },
          null,
          2,
        ) + '\n',
      );
    }
  });
