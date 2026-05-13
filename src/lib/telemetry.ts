/**
 * CLI telemetry emitter — fire-and-forget event stream to the backend.
 *
 * One call per interesting moment. Never blocks, never errors visibly, never
 * throws. If network is down the event is dropped (we don't queue — reliability
 * at this layer isn't worth the complexity).
 *
 * Events are a closed whitelist — matches ALLOWED_EVENTS in the backend.
 *
 * See: SPRINT-CLI-MONETIZATION.md §"Layer 2 — Behavior-triggered outreach"
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const CONFIG_DIR = path.join(os.homedir(), '.solid');
const IDENTITY_FILE = path.join(CONFIG_DIR, 'identity.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'cli_history.json');

export type TelemetryEventName =
  | 'installed'
  | 'first_command'
  | 'first_run_welcome_shown'
  | 'first_run_email_captured'
  | 'first_run_email_skipped'
  | 'auth_started'
  | 'auth_success'
  | 'auth_failed'
  | 'demo_created'
  | 'demo_email_captured'
  | 'demo_failed'
  | 'clone_created'
  | 'clone_failed'
  | 'company_created'
  | 'company_create_for_client'
  | 'page_published'
  | 'deploy_preview'
  | 'context_claude'
  | 'context_cursor'
  | 'template_publish'
  | 'agent_onboard'
  | 'api_key_created'
  | 'billing_invoice_sent'
  | 'billing_checkout_link_created'
  | 'subscription_started'
  | 'command_error'
  | 'help_shown'
  | 'bare_invocation'
  | 'feedback_sent'
  | 'unknown_command';

function getApiBase(): string {
  return process.env.SOLID_API_URL || 'https://api.solidnumber.com';
}

function getMachineId(): string | null {
  try {
    if (!fs.existsSync(IDENTITY_FILE)) return null;
    const raw = JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
    return typeof raw?.machine_id === 'string' ? raw.machine_id : null;
  } catch {
    return null;
  }
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

/**
 * Append an entry to the local command-history file (used by `solid feedback`
 * to include context). Safe to call from every command. Best-effort.
 */
export function recordCommand(command: string): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
    let history: Array<{ command: string; ts: string }> = [];
    if (fs.existsSync(HISTORY_FILE)) {
      try {
        history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
        if (!Array.isArray(history)) history = [];
      } catch {
        history = [];
      }
    }
    history.push({ command: command.slice(0, 256), ts: new Date().toISOString() });
    // Keep only last 50 for size control
    if (history.length > 50) history = history.slice(-50);
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf-8');
  } catch {
    /* noop */
  }
}

/**
 * Emit a telemetry event. Fire-and-forget. Never awaits the network call.
 * Caller does not need to await this function.
 */
export function emit(
  event: TelemetryEventName,
  opts: { command?: string; extra?: Record<string, unknown> } = {},
): void {
  if (shouldSkip()) return;
  const machine_id = getMachineId();
  if (!machine_id) return; // no identity = nothing to correlate; skip

  const body = {
    machine_id,
    event,
    cli_version: getCliVersion(),
    command: opts.command,
    extra: opts.extra ?? {},
  };

  // Fire-and-forget — we don't await
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 2000);
  fetch(`${getApiBase()}/api/v1/cli/telemetry/event`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: controller.signal,
  })
    .catch(() => {
      /* swallow */
    })
    .finally(() => clearTimeout(timeoutId));
}
