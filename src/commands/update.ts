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
 *   solid update            check, then upgrade this copy
 *   solid update --check    say what would happen, change nothing
 *   solid update --json     the same, for an agent
 */
import { spawnSync } from 'child_process';
import { existsSync, realpathSync } from 'fs';
import { delimiter, join } from 'path';

import chalk from 'chalk';
import { Command } from 'commander';

import { CLI_VERSION } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const PACKAGE_NAME = '@solidnumber/cli';
const REGISTRY = `https://registry.npmjs.org/${PACKAGE_NAME}/latest`;

export type Installer = 'npm' | 'brew' | 'scoop' | 'unknown';

export interface InstallInfo {
  installer: Installer;
  /** argv to run, or null when we cannot tell — then we say so rather than guess. */
  command: string[] | null;
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
  // directory, so the npm check would swallow it and print the wrong command.
  if (p.includes('/cellar/') || p.includes('/homebrew/') || p.includes('/linuxbrew/')) {
    return { installer: 'brew', command: ['brew', 'upgrade', 'solidnumber/tap/cli'] };
  }
  if (p.includes('/scoop/') || p.includes('scoop/apps/')) {
    return { installer: 'scoop', command: ['scoop', 'update', 'solid'] };
  }
  if (p.includes('node_modules/@solidnumber/cli')) {
    return { installer: 'npm', command: ['npm', 'install', '-g', `${PACKAGE_NAME}@latest`] };
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

export const updateCommand = new Command('update')
  .description('Update the CLI to the latest release (knows npm, Homebrew and scoop)')
  .option('--check', 'Say what would happen; change nothing')
  .option('--json', 'Emit JSON')
  .action(async (opts) => {
    const me = selfPath();
    const { installer, command } = detectInstaller(me);
    const latest = await latestVersion();
    const others = otherCopiesOnPath(me);
    const behind = latest ? isNewer(CLI_VERSION, latest) : false;

    if (isJsonOutput(opts)) {
      process.stdout.write(
        JSON.stringify(
          {
            current: CLI_VERSION,
            latest,
            up_to_date: latest ? !behind : null,
            installer,
            command: command ? command.join(' ') : null,
            other_copies: others,
            ran: false,
          },
          null,
          2,
        ) + '\n',
      );
      return;
    }

    if (!latest) {
      console.log(chalk.yellow('Could not reach the npm registry — try again, or run:'));
      console.log(`  ${command ? command.join(' ') : `npm install -g ${PACKAGE_NAME}@latest`}`);
      return;
    }

    // The other copies matter even when this one is current, so say it first.
    if (others.length) {
      console.log(chalk.yellow(`\n⚠ Another 'solid' is on your PATH:`));
      for (const other of others) {
        const stale = other.version && isNewer(other.version, latest);
        console.log(
          `  ${other.path}  ${other.version ?? '(version unknown)'}` +
            (stale ? chalk.red('  ← behind') : ''),
        );
      }
      console.log(chalk.dim('  Whichever comes first in PATH is the one that runs.'));
      console.log(chalk.dim(`  Update it too, or remove it so there is only one.\n`));
    }

    if (!behind) {
      console.log(chalk.green(`Already on the latest — ${CLI_VERSION}.`));
      return;
    }

    console.log(`${chalk.bold('Update available')}  ${CLI_VERSION} → ${chalk.green(latest)}`);

    if (!command) {
      console.log(chalk.yellow(`Cannot tell how this copy was installed (${me ?? 'unknown path'}).`));
      console.log(`Run whichever fits:\n  npm install -g ${PACKAGE_NAME}@latest\n  brew upgrade solidnumber/tap/cli\n  scoop update solid`);
      return;
    }

    if (opts.check) {
      console.log(`Would run: ${chalk.cyan(command.join(' '))}`);
      return;
    }

    console.log(`Running ${chalk.cyan(command.join(' '))} …\n`);
    const result = spawnSync(command[0], command.slice(1), { stdio: 'inherit' });
    if (result.status === 0) {
      console.log(chalk.green(`\nUpdated to ${latest}.`));
      return;
    }
    console.log(chalk.red(`\nThat did not finish (exit ${result.status ?? 'unknown'}).`));
    console.log(`Run it yourself: ${command.join(' ')}`);
    process.exitCode = 1;
  });
