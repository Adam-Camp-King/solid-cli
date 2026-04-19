/**
 * First-run — silent identity creation + anonymous install ping.
 *
 * No prompt, no banner, no pitch. Matches the `gh` / `vercel` / `stripe` pattern:
 * the tool just works. Email is captured later at value-exchange moments
 * (demo create where we need it to deliver the phone number, feedback where
 * we need it to reply, auth login where the user signs up) — not as a greeting.
 *
 * Skipped in CI, non-TTY, Docker, SOLID_DISABLE_TELEMETRY=1. Those environments
 * get no identity created and no backend ping.
 *
 * See: SPRINT-CLI-MONETIZATION.md §"Layer 1 — Capture identity at first value"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { randomUUID } from 'crypto';

import { emit } from './telemetry';

const CONFIG_DIR = path.join(os.homedir(), '.solid');
const IDENTITY_FILE = path.join(CONFIG_DIR, 'identity.json');

interface Identity {
  machine_id: string;
  created_at: string;
  /** Captured later at a value-exchange moment (demo/feedback/auth), not at install. */
  email?: string;
  consented_at?: string;
  consented_by?: string;
}

function shouldSkip(): boolean {
  if (process.env.SOLID_DISABLE_TELEMETRY === '1') return true;
  if (process.env.CI) return true;
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    /* noop */
  }
  return false;
}

function readIdentity(): Identity | null {
  try {
    if (!fs.existsSync(IDENTITY_FILE)) return null;
    return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8')) as Identity;
  } catch {
    return null;
  }
}

function writeIdentity(id: Identity): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(id, null, 2), 'utf-8');
  } catch {
    /* noop */
  }
}

function normalizedOs(): string {
  const p = process.platform;
  if (p === 'darwin' || p === 'linux' || p === 'win32') return p;
  return 'other';
}

function getApiBase(): string {
  return process.env.SOLID_API_URL || 'https://api.solidnumber.com';
}

function getCliVersion(): string {
  try {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf-8'),
    );
    return String(pkg.version || 'unknown');
  } catch {
    return 'unknown';
  }
}

async function pingBackend(id: Identity, consentedBy: string = 'silent-install'): Promise<void> {
  try {
    const body = {
      machine_id: id.machine_id,
      email: id.email,
      cli_version: getCliVersion(),
      os: normalizedOs(),
      consented: !!id.email,
      consented_by: consentedBy,
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch(`${getApiBase()}/api/v1/cli/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {
      /* swallow */
    });
    clearTimeout(timeoutId);
  } catch {
    /* noop */
  }
}

/**
 * Called at the top of the CLI entrypoint. On first run, silently generates
 * an anonymous machine UUID and fire-and-forgets an install ping. Never
 * prompts. Never blocks. Never throws.
 *
 * Synchronous return — the network call is fire-and-forget.
 */
export function runFirstRunIfNeeded(): void {
  try {
    if (shouldSkip()) return;
    if (readIdentity()) return; // already initialized

    const identity: Identity = {
      machine_id: randomUUID(),
      created_at: new Date().toISOString(),
    };
    writeIdentity(identity);

    // Fire-and-forget — don't await, don't block the command the user typed
    void pingBackend(identity, 'silent-install');
    emit('installed');
  } catch {
    /* NEVER let first-run break the actual command */
  }
}

/** Read the current identity. Null if not yet created. */
export function getIdentity(): Identity | null {
  return readIdentity();
}

/**
 * Capture or update email at a value-exchange moment. Called by commands
 * like `solid demo create` (where the email is needed to deliver the phone
 * number) and `solid feedback` (where the email is needed for a reply).
 *
 * Never throws. Safe to call before first-run (creates the identity).
 */
export async function captureEmail(email: string, source: string): Promise<void> {
  try {
    const trimmed = email.trim();
    if (!trimmed) return;

    let identity = readIdentity();
    if (!identity) {
      // Edge case — user somehow hit a value-exchange command before first-run
      // completed (e.g. SOLID_DISABLE_TELEMETRY removed mid-session). Create now.
      identity = {
        machine_id: randomUUID(),
        created_at: new Date().toISOString(),
      };
    }

    if (identity.email === trimmed) return; // already captured

    const now = new Date().toISOString();
    const updated: Identity = {
      ...identity,
      email: trimmed,
      consented_at: now,
      consented_by: source,
    };
    writeIdentity(updated);

    // Push to backend (respects SOLID_DISABLE_TELEMETRY via shouldSkip)
    if (!shouldSkip()) {
      await pingBackend(updated, source);
    }
  } catch {
    /* noop */
  }
}
