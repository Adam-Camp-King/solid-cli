/**
 * The Solid# kit inside a project — `.claude/skills/solid-*` and the
 * `.solid/plugin/` package that `solid agent setup` writes — kept current by
 * `solid update`.
 *
 * ⛔ THE KIT IS COMPILED INTO THE CLI. The skills name commands and the plugin
 * manifest carries the CLI version, so the day a customer upgrades the CLI
 * every kit they set up earlier starts describing a CLI they no longer run.
 * Before this, nothing but re-running `solid agent setup` in each directory
 * brought one back — and nobody remembers which directories those were.
 *
 * So `agent setup` remembers the directory (`~/.solid/projects.json`), and
 * `solid update` refreshes every remembered one, plus the current directory.
 *
 * It only refreshes what is already there: a directory with skills but no
 * plugin keeps having no plugin. An update is not consent to new files.
 *
 * ⛔ TENANT GUARD. A directory is touched only while it still carries a
 * `.solid/manifest.json`, and never a protected root ($HOME, the platform
 * monorepo). The plugin's company comes from THAT manifest — never from
 * whoever is logged in right now, which may be a different company.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { SKILLS } from './skills/index';
import { planPlugin, solidPluginInput, PLUGIN_DIR } from './skills/plugin';
import { isProtectedRoot } from './tenant-guard';

export function projectsFile(): string {
  return process.env.SOLID_PROJECTS_PATH || path.join(os.homedir(), '.solid', 'projects.json');
}

export function knownProjects(): string[] {
  try {
    const body = JSON.parse(fs.readFileSync(projectsFile(), 'utf8')) as { dirs?: unknown };
    return Array.isArray(body.dirs) ? body.dirs.filter((d): d is string => typeof d === 'string') : [];
  } catch {
    return [];
  }
}

function saveProjects(dirs: string[]): void {
  fs.mkdirSync(path.dirname(projectsFile()), { recursive: true });
  fs.writeFileSync(projectsFile(), JSON.stringify({ dirs }, null, 2) + '\n');
}

/** Remember a directory whose kit `solid update` should keep current. Never throws. */
export function rememberProject(dir: string): void {
  try {
    const abs = path.resolve(dir);
    const dirs = knownProjects();
    if (!dirs.includes(abs)) saveProjects([...dirs, abs]);
  } catch {
    /* a registry we cannot write costs a refresh later, not this command */
  }
}

function manifestCompany(dir: string): number | null {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(dir, '.solid', 'manifest.json'), 'utf8')) as { company_id?: unknown };
    return typeof m.company_id === 'number' ? m.company_id : null;
  } catch {
    return null;
  }
}

export interface KitReport {
  dir: string;
  state: 'current' | 'updated' | 'installed' | 'would_update' | 'would_install' | 'failed';
  files: number;
  error?: string;
}

function differs(file: string, content: string): boolean {
  try {
    return fs.readFileSync(file, 'utf8') !== content;
  } catch {
    return true;
  }
}

/** Refresh one directory's kit. Null when it has no kit, or may not be touched. */
export function refreshKit(dir: string, version: string, apply: boolean,
                           installIfMissing = false): KitReport | null {
  const companyId = manifestCompany(dir);
  if (companyId === null || isProtectedRoot(dir)) return null;

  const skillFiles = SKILLS.map((s) => ({
    path: path.join(dir, '.claude', 'skills', s.dirname, 'SKILL.md'),
    content: s.content,
  }));
  const hasSkills = skillFiles.some((f) => fs.existsSync(f.path));
  const hasPlugin = fs.existsSync(path.join(dir, PLUGIN_DIR, 'plugin.json'));
  if (!hasSkills && !hasPlugin) {
    // ⛔ The ONE place update adds files: the client project you ran it in
    // (installIfMissing — refreshAllKits passes it for cwd only). A customer's
    // AI that works there without the skills guesses commands instead of
    // reading the verb catalog; the fix should not depend on anyone knowing
    // `solid agent setup` exists. Still tenant-bound and never a protected root.
    if (!installIfMissing) return null;
    const files = [...skillFiles, ...planPlugin(dir, SKILLS, solidPluginInput(companyId, version))];
    if (!apply) return { dir, state: 'would_install', files: files.length };
    try {
      for (const f of files) {
        fs.mkdirSync(path.dirname(f.path), { recursive: true });
        fs.writeFileSync(f.path, f.content);
      }
    } catch (err) {
      return { dir, state: 'failed', files: files.length, error: (err as Error).message };
    }
    return { dir, state: 'installed', files: files.length };
  }

  const wanted = [
    ...(hasSkills ? skillFiles : []),
    ...(hasPlugin ? planPlugin(dir, SKILLS, solidPluginInput(companyId, version)) : []),
  ];
  const stale = wanted.filter((f) => differs(f.path, f.content));
  if (stale.length === 0) return { dir, state: 'current', files: 0 };
  if (!apply) return { dir, state: 'would_update', files: stale.length };
  try {
    for (const f of stale) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.content);
    }
  } catch (err) {
    return { dir, state: 'failed', files: stale.length, error: (err as Error).message };
  }
  return { dir, state: 'updated', files: stale.length };
}

/**
 * Every remembered directory plus `cwd`. Directories that no longer exist are
 * dropped from the registry; a kit found in `cwd` is remembered from now on,
 * which is how kits set up before the registry existed get picked up.
 */
export function refreshAllKits(version: string, apply: boolean, cwd = process.cwd()): KitReport[] {
  const known = knownProjects();
  const alive = known.filter((d) => fs.existsSync(d));
  const dirs = [...alive];
  const here = path.resolve(cwd);
  if (!dirs.includes(here)) dirs.push(here);

  const reports: KitReport[] = [];
  for (const dir of dirs) {
    const r = refreshKit(dir, version, apply, dir === here);
    if (r) reports.push(r);
  }

  if (apply) {
    const next = [...alive];
    if (reports.some((r) => r.dir === here) && !next.includes(here)) next.push(here);
    if (next.length !== known.length || next.some((d, i) => d !== known[i])) {
      try {
        saveProjects(next);
      } catch {
        /* see rememberProject */
      }
    }
  }
  return reports;
}


/**
 * A directory just bound to a company (`solid init`, `solid pull`) gets the
 * Solid# skills + plugin right away, and is remembered so `solid update` keeps
 * them current. Never throws: a project that could not take the kit still works,
 * and `solid update` run there installs it later.
 */
export function installKitForNewProject(dir: string, version: string): KitReport | null {
  try {
    const r = refreshKit(dir, version, true, true);
    if (r && r.state !== 'failed') rememberProject(path.resolve(dir));
    return r;
  } catch {
    return null;
  }
}
