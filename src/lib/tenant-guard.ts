/**
 * Tenant-directory guard.
 *
 * Commands that write tenant-scoped artifacts to disk (`push`, `pull`,
 * `context --claude/--cursor/--codex/--save`) must run inside a directory
 * bound to the active tenant via `.solid/manifest.json`. This guard
 * enforces that contract so we never write one tenant's data into another
 * tenant's working tree — or into the platform monorepo, or into $HOME.
 *
 * See: Owners-Manual/03-AI-Systems/CLAUDE-CONTEXT-CANONICAL-TRUTH.md
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';

export interface PullManifest {
  company_id: number;
  company_name: string;
  pulled_at: string;
  api_url: string;
  pages: Record<string, { id: number; slug: string; updated_at: string }>;
  kb: Record<string, { id: number; title: string }>;
  services: Record<string, { id: number; slug: string }>;
  products: Record<string, { id: number; name: string }>;
}

/**
 * Why a directory is refused as a tenant-write target.
 *
 * - `home`           — $HOME itself. ~/.claude/ is loaded by every
 *                      Claude Code session across every project.
 * - `home_claude`    — $HOME/.claude/. Same reason, one level deeper.
 * - `platform_repo`  — anywhere under the Solid# platform monorepo
 *                      (detected by walking up for docker-compose.base.yml).
 *                      Role-1 territory; tenant files here contaminate
 *                      every platform-team Claude Code session.
 */
export type ProtectedRootReason = 'home' | 'home_claude' | 'platform_repo';

export type GuardFailure =
  | { kind: 'protected_root'; reason: ProtectedRootReason; resolved: string; platformRoot?: string }
  | { kind: 'missing'; manifestPath: string }
  | { kind: 'mismatch'; manifestCompanyId: number; manifestCompanyName: string; activeCompanyId: number };

export type GuardResult =
  | { ok: true; manifest: PullManifest }
  | { ok: false; failure: GuardFailure };

/**
 * Walk up from ``baseDir`` looking for the platform-monorepo marker file
 * (``docker-compose.base.yml``). Returns the absolute root path if found,
 * else null. Matches the discovery logic in
 * ``solid-backend/scripts/drift_scan/__main__.py::_default_repo_root``
 * so the guard and the drift scanner agree on which tree counts as the
 * platform monorepo.
 */
function findPlatformMonorepoRoot(baseDir: string): string | null {
  let dir = path.resolve(baseDir);
  while (true) {
    if (fs.existsSync(path.join(dir, 'docker-compose.base.yml'))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Returns the reason ``baseDir`` is forbidden as a tenant-write target,
 * or null if it's fine. Use ``isProtectedRoot`` for a bool convenience.
 */
export function protectedRootReason(
  baseDir: string,
): { reason: ProtectedRootReason; resolved: string; platformRoot?: string } | null {
  const resolved = path.resolve(baseDir);
  const home = path.resolve(os.homedir());
  if (resolved === home) return { reason: 'home', resolved };
  if (resolved === path.join(home, '.claude')) return { reason: 'home_claude', resolved };

  const platformRoot = findPlatformMonorepoRoot(resolved);
  if (platformRoot !== null) {
    // Refuse the monorepo root AND every subdirectory (incl. submodule
    // trees like solid-backend/, solid-cli/). Running a tenant-write
    // inside any of them is the § 700.1 pattern.
    return { reason: 'platform_repo', resolved, platformRoot };
  }
  return null;
}

/**
 * Hard-coded refusal set: directories that must NEVER receive tenant
 * writes even if a manifest somehow ended up there. Three locations:
 *
 *   1. $HOME — ``~/.claude/CLAUDE.md`` is loaded into every Claude Code
 *      session across every project, so tenant data leaking there would
 *      contaminate every unrelated workflow on the machine.
 *   2. $HOME/.claude — same reason, one level deeper.
 *   3. The Solid# platform monorepo (and any submodule/subdir of it) —
 *      Role-1 territory. A ``.claude/CLAUDE.md`` here contaminates
 *      every platform-team session. This is what happened in the
 *      2026-04-23 audit (§ 700.1).
 *
 * Hardened 2026-04-24 after a tenant-drift audit: before this, only
 * (1) and (2) were protected; tenant writes inside the platform repo were
 * only blocked by the "no manifest here" branch, which fails open if
 * anyone places a manifest file in the platform repo.
 */
export function isProtectedRoot(baseDir: string): boolean {
  return protectedRootReason(baseDir) !== null;
}

/**
 * Home-dir-only refusal (for commands like `solid pull` that CREATE the
 * manifest and therefore can't require one yet). Prints a friendly error
 * and exits 1 if `baseDir` resolves to any protected root. Otherwise
 * returns silently.
 */
export function refuseProtectedRoot(baseDir: string): void {
  const refusal = protectedRootReason(baseDir);
  if (!refusal) return;
  printProtectedRootError(refusal);
  process.exit(1);
}

function printProtectedRootError(
  refusal: { reason: ProtectedRootReason; resolved: string; platformRoot?: string },
): void {
  if (refusal.reason === 'platform_repo') {
    console.error(chalk.red('Refusing to write tenant data inside the Solid# platform monorepo.'));
    console.error(chalk.dim(`  ${refusal.resolved} is under ${refusal.platformRoot ?? 'the platform monorepo'} (Role-1 territory).`));
    console.error(chalk.dim('  Tenant files here contaminate every platform-team Claude Code session.'));
    console.error(chalk.dim('  `cd` into a dedicated tenant project directory (outside the monorepo) and try again.'));
  } else {
    console.error(chalk.red('Refusing to write tenant data to your home directory.'));
    console.error(chalk.dim(`  ${refusal.resolved} is global (loaded by every Claude Code session).`));
    console.error(chalk.dim('  `cd` into a dedicated tenant project directory and try again.'));
  }
}

/**
 * Pure check — returns a result, no I/O beyond reading the manifest and
 * no process.exit. Keep this testable in isolation; the CLI wrapper below
 * handles the user-facing error output + exit.
 */
export function checkTenantManifest(baseDir: string, companyId: number): GuardResult {
  const refusal = protectedRootReason(baseDir);
  if (refusal) {
    return { ok: false, failure: { kind: 'protected_root', ...refusal } };
  }
  const manifestPath = path.join(baseDir, '.solid', 'manifest.json');
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, failure: { kind: 'missing', manifestPath } };
  }
  const manifest: PullManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
  if (manifest.company_id !== companyId) {
    return {
      ok: false,
      failure: {
        kind: 'mismatch',
        manifestCompanyId: manifest.company_id,
        manifestCompanyName: manifest.company_name,
        activeCompanyId: companyId,
      },
    };
  }
  return { ok: true, manifest };
}

/**
 * CLI-facing wrapper: refuse with a friendly error and exit 1 on failure,
 * return the parsed manifest on success. Every command that mutates the
 * local tenant working tree should call this before touching the filesystem.
 */
export function requireTenantManifest(baseDir: string, companyId: number): PullManifest {
  const result = checkTenantManifest(baseDir, companyId);
  if (result.ok) return result.manifest;

  if (result.failure.kind === 'protected_root') {
    printProtectedRootError(result.failure);
  } else if (result.failure.kind === 'missing') {
    console.error(chalk.red('Not a Solid# tenant working directory.'));
    console.error(chalk.dim(`  No .solid/manifest.json in ${baseDir}`));
    console.error(chalk.dim('  Run `solid pull` in an empty directory to create one,'));
    console.error(chalk.dim('  or `cd` into an existing tenant project.'));
  } else {
    const f = result.failure;
    console.error(chalk.red(`Directory belongs to company ${f.manifestCompanyId} (${f.manifestCompanyName}).`));
    console.error(chalk.red(`You are logged in as company ${f.activeCompanyId}.`));
    console.error(chalk.dim(`  Run \`solid switch ${f.manifestCompanyId}\` to match, or cd elsewhere.`));
  }
  process.exit(1);
}

/**
 * Lenient guard for hook contexts (e.g. `solid context --if-tenant` fired
 * by Claude Code's SessionStart). Returns the manifest if the directory is
 * properly bound; returns null when the directory is a protected root
 * (platform monorepo, $HOME, $HOME/.claude) or simply has no manifest —
 * both meaning "no tenant write to do here, move on quietly".
 *
 * The `mismatch` failure mode is still loud and still exits 1: a manifest
 * pinning the dir to company A while the user is logged in as company B is
 * a real misconfiguration and silently skipping would let stale or wrong
 * context flow into the next Claude session. We want loud here.
 *
 * Use this — not `requireTenantManifest` — for any code path that runs
 * automatically (hooks, cron, post-install scripts) where "I'm not in a
 * tenant directory" is the expected case, not an error.
 */
export function tenantManifestForHook(
  baseDir: string,
  companyId: number,
): PullManifest | null {
  const result = checkTenantManifest(baseDir, companyId);
  if (result.ok) return result.manifest;
  if (result.failure.kind === 'protected_root') return null;
  if (result.failure.kind === 'missing') return null;
  // mismatch — fall through to the loud handler in requireTenantManifest
  // so the message stays in one place.
  const f = result.failure;
  console.error(chalk.red(`Directory belongs to company ${f.manifestCompanyId} (${f.manifestCompanyName}).`));
  console.error(chalk.red(`You are logged in as company ${f.activeCompanyId}.`));
  console.error(chalk.dim(`  Run \`solid switch ${f.manifestCompanyId}\` to match, or cd elsewhere.`));
  process.exit(1);
}
