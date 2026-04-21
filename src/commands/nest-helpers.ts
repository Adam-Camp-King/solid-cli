/**
 * Pure helpers for the `solid nest` command.
 *
 * Kept separate from nest.ts so Jest can unit-test them without pulling in
 * ESM-only deps (ora/chalk) through the commander action module.
 */

import * as fs from 'fs';

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
}

export type SourceKind = 'url' | 'file' | 'code' | 'stdin';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Classify the raw positional argument.
 *
 * Rules (in order):
 *   '-' or undefined   → stdin (pipe into CLI)
 *   starts with http(s):// or has a valid .tld pattern → url
 *   exists as a file on disk → file
 *   otherwise → treated as raw code paste
 */
export function detectSource(arg: string | undefined): SourceKind {
  if (!arg || arg === '-') return 'stdin';
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
