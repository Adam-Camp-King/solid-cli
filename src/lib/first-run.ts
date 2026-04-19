/**
 * First-run welcome + identity capture.
 *
 * Triggers once per machine, on the first invocation of `solid` that is NOT
 * one of the pure-information commands (--help, -h, --version, -v). Prompts
 * for an email (optional), generates a stable anonymous machine UUID, saves
 * both locally, and best-effort posts to the backend so Adam can reach out.
 *
 * Design:
 *  - NEVER blocks CI, non-TTY stderr/stdout, Docker, or SOLID_SKIP_WELCOME=1.
 *  - NEVER blocks the command the user actually typed. On any error we carry on.
 *  - NEVER network-calls in postinstall — all network happens here, AFTER the
 *    user has chosen to actually run `solid`.
 *  - Identity state at ~/.solid/identity.json. Idempotent if re-run.
 *
 * See: SPRINT-CLI-MONETIZATION.md §"Layer 1 — Capture identity at first value"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { randomUUID } from 'crypto';

import chalk from 'chalk';

const CONFIG_DIR = path.join(os.homedir(), '.solid');
const IDENTITY_FILE = path.join(CONFIG_DIR, 'identity.json');

interface Identity {
  machine_id: string;
  email?: string;
  consented_at?: string;
  consented_by?: string;
  created_at: string;
  skipped?: boolean; // user declined — don't prompt again
}

const INFO_ONLY_COMMANDS = new Set(['--help', '-h', 'help', '--version', '-v', 'version']);

function shouldSkipWelcome(argv: string[]): boolean {
  if (process.env.SOLID_SKIP_WELCOME === '1') return true;
  if (process.env.CI) return true;
  if (process.env.SOLID_DISABLE_TELEMETRY === '1') return true;
  if (!process.stdout.isTTY) return true;
  if (!process.stdin.isTTY) return true;
  // Running inside Docker — skip
  try {
    if (fs.existsSync('/.dockerenv')) return true;
  } catch {
    /* noop */
  }
  // If any argv is purely informational, skip (they're reading help, not engaging)
  const first = argv[2]?.toLowerCase();
  if (first && INFO_ONLY_COMMANDS.has(first)) return true;
  return false;
}

function readIdentity(): Identity | null {
  try {
    if (!fs.existsSync(IDENTITY_FILE)) return null;
    const raw = fs.readFileSync(IDENTITY_FILE, 'utf-8');
    return JSON.parse(raw) as Identity;
  } catch {
    return null;
  }
}

function writeIdentity(id: Identity): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    fs.writeFileSync(IDENTITY_FILE, JSON.stringify(id, null, 2), 'utf-8');
  } catch {
    /* noop — if we can't write, we'll just prompt again next time */
  }
}

function prompt(question: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function isValidEmail(s: string): boolean {
  // Lenient — we validate properly on the backend. Just catches typos.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
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

async function reportIdentity(id: Identity): Promise<void> {
  // Fire-and-forget. Never throw. Short timeout so a down backend doesn't stall CLI startup.
  try {
    const body = {
      machine_id: id.machine_id,
      email: id.email,
      cli_version: getCliVersion(),
      os: normalizedOs(),
      consented: !!id.email || !!id.consented_at,
      consented_by: id.consented_by || 'first-run',
    };
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    await fetch(`${getApiBase()}/api/v1/cli/identity`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    }).catch(() => {
      /* swallow — fire and forget */
    });
    clearTimeout(timeoutId);
  } catch {
    /* noop */
  }
}

/**
 * Call this at the very top of the CLI entrypoint, before command dispatch.
 * Returns quickly (<100ms) if welcome has already run. Never throws.
 */
export async function runFirstRunIfNeeded(argv: string[]): Promise<void> {
  try {
    if (shouldSkipWelcome(argv)) return;
    const existing = readIdentity();
    if (existing) return; // already run

    // Generate anonymous machine id first — we'll report even if they skip email.
    const machine_id = randomUUID();
    const now = new Date().toISOString();

    // Welcome banner — one screen, emerald/cyan brand, no ASCII art bloat.
    console.log('');
    console.log(chalk.bold.hex('#10b981')('  Welcome to Solid#.'));
    console.log(chalk.dim('  AI business infrastructure in your terminal.'));
    console.log('');
    console.log(chalk.cyan('  Your first paying client in 30 seconds:'));
    console.log(chalk.bold('    $ solid demo create plumber "Joe\'s Plumbing"'));
    console.log('');
    console.log(
      chalk.dim(
        "  We'll send you a 3-day earning-potential quickstart — skip with Enter.",
      ),
    );
    const email = await prompt('  Email (optional): ');

    const identity: Identity = {
      machine_id,
      created_at: now,
    };
    if (email && isValidEmail(email)) {
      identity.email = email;
      identity.consented_at = now;
      identity.consented_by = 'first-run';
      console.log('');
      console.log(chalk.hex('#10b981')("  ✓ Thanks. We'll be in touch within 5 minutes."));
      console.log('');
    } else if (email) {
      console.log('');
      console.log(chalk.yellow("  That didn't look like an email — skipping."));
      console.log('');
      identity.skipped = true;
    } else {
      identity.skipped = true;
      console.log('');
    }

    writeIdentity(identity);
    // Fire-and-forget network call. Don't await so we don't stall CLI startup.
    void reportIdentity(identity);
  } catch {
    /* NEVER let first-run break the actual command */
  }
}

/** Exported for tests — resolves the local identity, if any. */
export function getIdentity(): Identity | null {
  return readIdentity();
}
