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
