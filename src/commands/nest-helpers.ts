/**
 * Pure helpers for the `solid nest` command.
 *
 * Kept separate from nest.ts so Jest can unit-test them without pulling in
 * ESM-only deps (ora/chalk) through the commander action module.
 */

import * as fs from 'fs';
import * as path from 'path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NestPageType =
  | 'home'
  | 'website'
  | 'landing'
  | 'email_landing'
  | 'blog'
  | 'product'
  | 'booking'
  | 'component';

export type NestMode = 'sandbox' | 'place_now';

export type NestConversionGoal =
  | 'form_submit'
  | 'checkout'
  | 'booking'
  | 'chat_start'
  | 'click';

export interface NestDestination {
  page_type?: NestPageType;
  mode?: NestMode;
  site_id?: number;
  subdomain?: string;
  custom_domain?: string;
  campaign_id?: string;
  conversion_goal?: NestConversionGoal;
}

export interface NestFlags {
  type?: string;
  site?: string;
  subdomain?: string;
  customDomain?: string;
  sandbox?: boolean;
  live?: boolean;
  campaign?: string;
  goal?: string;
  json?: boolean;
  /** Folder: which HTML file is the home page (asked for when ambiguous). */
  entry?: string;
  /** Folder: import only the entry page instead of the whole site. */
  single?: boolean;
}

export type SourceKind = 'url' | 'file' | 'folder' | 'code' | 'stdin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify the raw positional argument.
 *
 * Rules (in order):
 *   '-' or undefined   → stdin (pipe into CLI)
 *   an existing DIRECTORY → folder (checked BEFORE the url heuristic: a designer's
 *     folder is often named after the site, e.g. "showerpros.com")
 *   starts with http(s):// or has a valid .tld pattern → url
 *   exists as a file on disk → file
 *   otherwise → treated as raw code paste
 */
export function detectSource(arg: string | undefined): SourceKind {
  if (!arg || arg === '-') return 'stdin';
  // ⛔ A folder used to fall through every check and land in 'code' — the CLI
  // sent the PATH STRING to the server as if it were the site's HTML.
  try {
    if (fs.existsSync(arg) && fs.statSync(arg).isDirectory()) return 'folder';
  } catch {
    // fall through
  }
  if (/^https?:\/\//i.test(arg)) return 'url';
  // Bare domain heuristic: word.tld with optional path/query
  if (/^[\w-]+(\.[\w-]+)+(\/.*)?$/.test(arg) && !arg.includes('\n') && arg.length < 256) {
    return 'url';
  }
  try {
    if (fs.existsSync(arg) && fs.statSync(arg).isFile()) return 'file';
  } catch {
    // fs.statSync can throw on odd paths — fall through to 'code'
  }
  return 'code';
}

/**
 * Normalize a bare domain to a full URL so the backend URL fetcher can handle it.
 */
export function normalizeUrl(raw: string): string {
  if (/^https?:\/\//i.test(raw)) return raw;
  return `https://${raw}`;
}

/**
 * Shape flags + positional into the AntService destination contract.
 * Mirrors the backend/UI contract (toExecutePayload in destination-picker.tsx).
 * Drops unset fields so the backend treats them as "not specified".
 */
export function flagsToDestination(flags: NestFlags): NestDestination {
  const dest: NestDestination = {};

  if (flags.type) dest.page_type = flags.type as NestPageType;

  // Mode: --live wins over --sandbox; default is sandbox.
  dest.mode = flags.live ? 'place_now' : 'sandbox';

  if (flags.site && /^\d+$/.test(flags.site)) {
    dest.site_id = Number(flags.site);
  }

  const sub = flags.subdomain?.trim();
  if (sub) dest.subdomain = sub;

  const dom = flags.customDomain?.trim();
  if (dom) dest.custom_domain = dom;

  const camp = flags.campaign?.trim();
  if (camp) dest.campaign_id = camp;

  if (flags.goal) dest.conversion_goal = flags.goal as NestConversionGoal;

  return dest;
}

/**
 * Guess page_type from a bare drop's shape. Only fires when --type isn't given.
 * Conservative: return undefined unless we have strong signal.
 */
export function guessPageType(
  source: SourceKind,
  raw: string | undefined,
): NestPageType | undefined {
  if (!raw) return undefined;
  const lower = raw.toLowerCase();
  if (source === 'url') {
    if (/\/(lp|landing|promo|offer|special)\b/.test(lower)) return 'landing';
    if (/\/blog\//.test(lower) || /\/posts?\//.test(lower)) return 'blog';
    if (/\/products?\//.test(lower) || /\/shop\//.test(lower)) return 'product';
  }
  return undefined;
}

/**
 * Serialize parsed commander flags back into argv for subcommand delegation.
 */
export function flagsAsArgv(flags: NestFlags): string[] {
  const out: string[] = [];
  if (flags.type) out.push('--type', flags.type);
  if (flags.site) out.push('--site', flags.site);
  if (flags.subdomain) out.push('--subdomain', flags.subdomain);
  if (flags.customDomain) out.push('--custom-domain', flags.customDomain);
  if (flags.live) out.push('--live');
  if (flags.sandbox) out.push('--sandbox');
  if (flags.campaign) out.push('--campaign', flags.campaign);
  if (flags.goal) out.push('--goal', flags.goal);
  if (flags.json) out.push('--json');
  return out;
}


// ---------------------------------------------------------------------------
// Folder intake — the same limits the backend enforces (services/nest_bundle.py)
// ---------------------------------------------------------------------------

export const FOLDER_MAX_FILES = 300;
export const FOLDER_MAX_FILE_BYTES = 8 * 1024 * 1024;
export const FOLDER_MAX_TOTAL_BYTES = 40 * 1024 * 1024;

const TEXT_EXT = new Set(['.html', '.htm', '.css', '.js', '.mjs', '.json', '.svg', '.txt', '.xml', '.md', '.webmanifest']);
const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.next', '.cache', '__MACOSX']);

export interface FolderFile { path: string; content: string; encoding?: 'base64' }
export interface FolderRead { files: FolderFile[]; skipped: Array<{ path: string; why: string }>; htmlFiles: string[] }

/**
 * Read a site folder as the bundle nest.import takes: relative POSIX paths kept,
 * text as UTF-8, everything else base64. Hidden files, VCS and dependency
 * folders are skipped and REPORTED — never silently dropped — as is anything
 * over the backend's limits, so the refusal is local and named, not a 413.
 */
export function readFolder(root: string): FolderRead {
  const files: FolderFile[] = [];
  const skipped: Array<{ path: string; why: string }> = [];
  let total = 0;

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const abs = path.join(dir, entry.name);
      const rel = path.relative(root, abs).split(path.sep).join('/');
      if (entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) {
        skipped.push({ path: rel, why: entry.isDirectory() ? 'folder not part of the site' : 'hidden file' });
        continue;
      }
      if (entry.isDirectory()) { walk(abs); continue; }
      if (!entry.isFile()) continue;
      const size = fs.statSync(abs).size;
      if (size > FOLDER_MAX_FILE_BYTES) { skipped.push({ path: rel, why: 'larger than 8MB' }); continue; }
      if (files.length >= FOLDER_MAX_FILES) { skipped.push({ path: rel, why: 'more than 300 files' }); continue; }
      if (total + size > FOLDER_MAX_TOTAL_BYTES) { skipped.push({ path: rel, why: 'folder over 40MB in total' }); continue; }
      total += size;
      const data = fs.readFileSync(abs);
      files.push(TEXT_EXT.has(path.extname(entry.name).toLowerCase())
        ? { path: rel, content: data.toString('utf8') }
        : { path: rel, content: data.toString('base64'), encoding: 'base64' });
    }
  };
  walk(root);
  const htmlFiles = files.map((f) => f.path).filter((p) => /\.html?$/i.test(p));
  return { files, skipped, htmlFiles };
}

// ---------------------------------------------------------------------------
// What a nest answered — the part an agent needs, never dropped
// ---------------------------------------------------------------------------

/**
 * ⛔ WHY THIS EXISTS (clean-room dry run, 2026-10-06). The backend answers a
 * build with whether the design was KEPT or CONVERTED, why, the fidelity score
 * against the original, a one-line summary and the next step. `solid nest`
 * printed import id, status, mode, type and page — in the human output AND in
 * --json — and threw the rest away. `solid bring` promises "the reply says
 * import_mode", and then it did not. An agent could not tell whether the
 * client's design survived, which is the first thing the client asks.
 *
 * One shaping function, used by the single-source path and the folder path and
 * by both output modes, so the two can never disagree about what was said.
 */
export interface NestOutcome {
  import_id: string | null;
  status: string | null;
  /** Where it went: the private sandbox, or placed on a site as a draft. */
  mode: string;
  page_type?: string;
  page_id: number | string | null;
  url: string | null;
  /** keep = the client's own markup and CSS, as written. convert = rebuilt from blocks. */
  import_mode: 'keep' | 'convert' | null;
  import_mode_why: string | null;
  /** Score out of 100 against the original, and the score a publish needs. */
  fidelity: { overall: number; threshold: number | null; passes: boolean | null;
    weakest: Array<{ dimension: string; score: number }> } | null;
  /** Both scores when both were tried: {keep: n, convert: n}. */
  fidelity_modes: Record<string, number> | null;
  fell_back_from_keep: string | null;
  summary: string | null;
  /** The command that shows the owner the page before anything is live. */
  preview: { cli: string; why: string } | null;
  /** The next step, as the backend names it, with the CLI command that does it. */
  next: { verb: string | null; why: string | null; cli: string | null } | null;
  errors?: string[];
}

/**
 * The body of the build call. `confirm: true` is the person's yes: `/api/v1/agent/nest/execute`
 * is a write verb and refuses without it (400 confirmation_required), and running `solid nest`
 * IS that yes — there is no `--confirm` flag to ask for. 2.30.0 left it out and every import failed.
 */
export function nestExecuteBody(importId: string, destination: object): Record<string, unknown> {
  return { import_id: importId, modifications: { destination }, confirm: true };
}

/** The CLI command for a backend verb's next step. null when there is no direct one. */
export function cliForNext(verb: string | null | undefined, ids: { importId?: string | null;
  pageId?: number | string | null }): string | null {
  const imp = ids.importId || '<import_id>';
  const page = ids.pageId ?? '<page_id>';
  switch (verb) {
    case 'nest.promote': return `solid nest promote ${imp}`;
    case 'page.publish': return `solid publish ${page}`;
    case 'page.preview_url': return `solid drafts preview ${page}`;
    case 'nest.rollback': return `solid ant rollback ${imp}`;
    case 'nest.outcomes': return 'solid nest outcomes';
    case 'nest.execute': return `solid ant execute ${imp}`;
    case 'domain.verify': return 'solid domains';
    case 'nest.import': case 'nest.import_url': return 'solid nest <file|folder|url>';
    default: return verb ? `solid verbs describe ${verb}` : null;
  }
}

/** PURE. The backend's build answer → everything the caller needs, in one shape. */
export function nestOutcome(result: Record<string, any> | null | undefined, ctx: {
  importId?: string | null; mode?: string | null; pageType?: string | null } = {}): NestOutcome {
  const r = result || {};
  const page = (r.created?.page ?? null) as Record<string, any> | null;
  const importId = (r.import_id as string) || ctx.importId || null;
  const pageId = page?.id ?? r.page_id ?? null;
  const mode = String(ctx.mode || r.mode || 'sandbox');
  const importMode = r.import_mode === 'keep' || r.import_mode === 'convert' ? r.import_mode : null;

  const report = r.fidelity && typeof r.fidelity === 'object' ? r.fidelity as Record<string, any> : null;
  let fidelity: NestOutcome['fidelity'] = null;
  if (report && typeof report.overall === 'number') {
    const threshold = typeof report.threshold === 'number' ? report.threshold : null;
    const weakest = Object.entries((report.dimensions || {}) as Record<string, number>)
      .filter(([, v]) => typeof v === 'number')
      .sort((a, b) => a[1] - b[1]).slice(0, 2)
      .map(([dimension, score]) => ({ dimension, score }));
    fidelity = { overall: report.overall, threshold,
      passes: typeof report.passes === 'boolean' ? report.passes
        : threshold === null ? null : report.overall >= threshold,
      weakest };
  }
  const modes: Record<string, number> = {};
  for (const [k, v] of Object.entries((r.fidelity_modes || {}) as Record<string, any>)) {
    const n = v && typeof v === 'object' ? v.overall : v;
    if (typeof n === 'number') modes[k] = n;
  }
  const fell = r.fell_back_from_keep;
  const nextRaw = r.next && typeof r.next === 'object' ? r.next as Record<string, any> : null;
  const nextVerb = nextRaw ? String(nextRaw.verb || nextRaw.next_verb || '') || null : null;

  return {
    import_id: importId,
    status: r.status != null ? String(r.status) : null,
    mode,
    ...(ctx.pageType ? { page_type: ctx.pageType } : {}),
    page_id: pageId,
    url: (page?.url as string) ?? r.page_url ?? null,
    import_mode: importMode,
    import_mode_why: r.import_mode_why ? String(r.import_mode_why) : null,
    fidelity,
    fidelity_modes: Object.keys(modes).length ? modes : null,
    fell_back_from_keep: fell ? String(typeof fell === 'object' ? (fell.summary || JSON.stringify(fell)) : fell) : null,
    summary: r.summary ? String(r.summary) : null,
    preview: pageId != null
      ? { cli: `solid drafts preview ${pageId}`,
        why: 'A private link to show the owner before anything is live.' }
      : null,
    next: nextRaw || mode === 'sandbox'
      ? { verb: nextVerb ?? (mode === 'sandbox' ? 'nest.promote' : null),
        why: nextRaw?.why ? String(nextRaw.why) : (mode === 'sandbox'
          ? 'It is in the sandbox — nothing is on a real site yet. Promote it (it stays a draft), then publish.'
          : null),
        cli: cliForNext(nextVerb ?? (mode === 'sandbox' ? 'nest.promote' : null), { importId, pageId }) }
      : null,
    ...(Array.isArray(r.errors) && r.errors.length ? { errors: r.errors.map(String) } : {}),
  };
}

/** The lines a person reads: was my design kept, how close is it, what do I run next. */
export function nestOutcomeLines(o: NestOutcome): string[] {
  const lines: string[] = [];
  if (o.import_mode === 'keep') lines.push('Design:   KEPT as written — the original markup and CSS, not our template');
  else if (o.import_mode === 'convert') lines.push('Design:   CONVERTED to editable blocks — it follows the brand, section by section');
  if (o.import_mode_why) lines.push(`Why:      ${o.import_mode_why}`);
  if (o.fell_back_from_keep) lines.push(`Not kept: ${o.fell_back_from_keep}`);
  if (o.fidelity) {
    const need = o.fidelity.threshold !== null ? ` (a publish needs ${o.fidelity.threshold})` : '';
    const weak = o.fidelity.weakest.length && o.fidelity.passes === false
      ? ` — weakest: ${o.fidelity.weakest.map((w) => `${w.dimension} ${w.score}`).join(', ')}` : '';
    lines.push(`Fidelity: ${o.fidelity.overall}/100 against the original${need}${weak}`);
  }
  if (o.fidelity_modes && Object.keys(o.fidelity_modes).length > 1) {
    lines.push(`Scored:   ${Object.entries(o.fidelity_modes).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  }
  if (o.summary) lines.push('', o.summary);
  if (o.preview) lines.push('', `Preview:  ${o.preview.cli}`, `          ${o.preview.why}`);
  if (o.next?.cli) lines.push(`Next:     ${o.next.cli}`);
  if (o.next?.why) lines.push(`          ${o.next.why}`);
  return lines;
}
