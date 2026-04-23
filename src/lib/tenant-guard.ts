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

export type GuardFailure =
  | { kind: 'home_dir'; resolved: string }
  | { kind: 'missing'; manifestPath: string }
  | { kind: 'mismatch'; manifestCompanyId: number; manifestCompanyName: string; activeCompanyId: number };

export type GuardResult =
  | { ok: true; manifest: PullManifest }
  | { ok: false; failure: GuardFailure };

/**
 * Hard-coded refusal set: directories that must NEVER receive tenant
 * writes even if a manifest somehow ended up there. The user's home is
 * the critical one — `~/.claude/CLAUDE.md` is loaded into every Claude
 * Code session across every project, so tenant data leaking there would
 * contaminate every unrelated workflow on the machine.
 */
function isProtectedRoot(baseDir: string): boolean {
  const resolved = path.resolve(baseDir);
  const home = path.resolve(os.homedir());
  if (resolved === home) return true;
  const claudeUnderHome = path.join(home, '.claude');
  if (resolved === claudeUnderHome) return true;
  return false;
}

/**
 * Pure check — returns a result, no I/O beyond reading the manifest and
 * no process.exit. Keep this testable in isolation; the CLI wrapper below
 * handles the user-facing error output + exit.
 */
export function checkTenantManifest(baseDir: string, companyId: number): GuardResult {
  if (isProtectedRoot(baseDir)) {
    return { ok: false, failure: { kind: 'home_dir', resolved: path.resolve(baseDir) } };
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

  if (result.failure.kind === 'home_dir') {
    console.error(chalk.red('Refusing to write tenant data to your home directory.'));
    console.error(chalk.dim(`  ${result.failure.resolved} is global (loaded by every Claude Code session).`));
    console.error(chalk.dim('  `cd` into a tenant project directory and try again.'));
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
