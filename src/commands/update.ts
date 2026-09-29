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
 *   solid update                  upgrade the CLI and the MCP server
 *   solid update --check          say what would happen, change nothing
 *   solid update --json           do it, and report it as JSON (for an agent)
 *   solid update --check --json   report only, as JSON
 */
import { spawnSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { delimiter, join } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { CLI_VERSION } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { MCP_LATEST_SPEC, McpFreshnessReport, refreshMcp } from '../lib/mcp-freshness';

export const PACKAGE_NAME = '@solidnumber/cli';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

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

/** The version of the `solid` a new shell will run — the only proof an update worked. */
function versionOnPath(me: string | null, env = process.env): string | null {
  const names = process.platform === 'win32' ? ['solid.cmd', 'solid.exe', 'solid'] : ['solid'];
  for (const dir of (env.PATH || '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return versionOf(candidate);
    }
  }
  return me ? versionOf(me) : null;
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
    const after = exit === 0 ? versionOnPath(me) : null;
    attempts.push({ installer: route.installer, command: route.command.join(' '), exit, version_after: after });
    if (exit !== 0) continue;
    anyExitedClean = true;
    if (after && !isNewer(after, latest)) return { action: 'updated', attempts };
    // Homebrew's formula follows npm on a 4-hour poll. It upgraded to the newest
    // formula there is; installing an npm copy on top would only make two.
    if (route.installer === 'brew') return { action: 'formula_behind', attempts };
    if (!json) console.log(chalk.dim(`That finished, but \`solid --version\` still says ${after ?? 'nothing readable'} — trying the next way.\n`));
  }
  return { action: anyExitedClean ? 'updated_unverified' : 'update_failed', attempts };
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

export const updateCommand = new Command('update')
  .description('Update everything Solid# on this machine: the CLI and the MCP server your AI tools launch')
  .option('--check', 'Say what would happen; change nothing')
  .option('--json', 'Emit JSON (runs the update unless --check)')
  .action(async (opts) => {
    const check = Boolean(opts.check);
    const json = isJsonOutput(opts);
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

    // ── 2. the MCP server (always — a current CLI can still launch a stale server) ──
    const mcp = await refreshMcp({ apply: !check });

    const failed =
      cliAction === 'update_failed' ||
      mcp.clients.some((c) => c.status === 'write_failed') ||
      mcp.global.action === 'upgrade_failed';
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
            mcp,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    // The other copies matter even when this one is current, so say it first.
    if (others.length && latest) {
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
      console.log(chalk.yellow(`  Installed ${latest}, but the solid your shell runs still reports an older version.`));
      console.log('  Open a new terminal window and run solid --version.');
    } else {
      console.log(chalk.red('  ✗ Could not update automatically. Tried:'));
      for (const a of attempts) console.log(`    ${a.command}  (exit ${a.exit ?? 'not found'})`);
      console.log(`  The one that works on almost every machine:\n    ${NPM_ROUTE.command.join(' ')}`);
    }

    printMcp(mcp, check);
  });
