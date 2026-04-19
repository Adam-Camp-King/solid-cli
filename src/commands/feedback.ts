/**
 * ================================================================================
 * solid feedback — send a message directly to the founder
 * ================================================================================
 *
 * Founder-sales hot channel. User types feedback, hits enter twice to submit,
 * and the message lands in Slack inside ~5 seconds. Adam replies from his
 * phone inside the 5-minute hot-lead SLA (see SPRINT-CLI-MONETIZATION.md
 * §"Founder-led sales").
 *
 * Design:
 *  - No auth required — frustration is highest when people haven't signed in
 *  - Includes machine_id + email (if captured in first-run) so Adam sees
 *    who's stuck AND has a way to reach back
 *  - Includes last few commands from recent history for context
 *  - Never blocks on backend failure
 *
 * Usage:
 *   solid feedback                             # Interactive — opens a message prompt
 *   solid feedback "Stuck on clone plumber"    # One-liner (quotes required)
 *   echo "quick thought" | solid feedback      # Piped
 * ================================================================================
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';

import chalk from 'chalk';
import { Command } from 'commander';

import { emit } from '../lib/telemetry';

const CONFIG_DIR = path.join(os.homedir(), '.solid');
const IDENTITY_FILE = path.join(CONFIG_DIR, 'identity.json');
const HISTORY_FILE = path.join(CONFIG_DIR, 'cli_history.json');

interface IdentityFile {
  machine_id: string;
  email?: string;
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

function readIdentity(): IdentityFile | null {
  try {
    if (!fs.existsSync(IDENTITY_FILE)) return null;
    return JSON.parse(fs.readFileSync(IDENTITY_FILE, 'utf-8'));
  } catch {
    return null;
  }
}

function readRecentCommands(): Array<{ command: string; ts?: string }> {
  try {
    if (!fs.existsSync(HISTORY_FILE)) return [];
    const raw = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
    if (!Array.isArray(raw)) return [];
    return raw.slice(-10);
  } catch {
    return [];
  }
}

async function promptMultiline(): Promise<string> {
  console.log(chalk.dim('  Enter your message. Blank line to submit. Ctrl+C cancels.'));
  console.log('');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const lines: string[] = [];
  return new Promise((resolve) => {
    const askLine = () => {
      rl.question('  > ', (line) => {
        if (line.trim() === '') {
          rl.close();
          resolve(lines.join('\n').trim());
        } else {
          lines.push(line);
          askLine();
        }
      });
    };
    askLine();
  });
}

async function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf-8');
    process.stdin.on('data', (chunk) => {
      data += chunk;
    });
    process.stdin.on('end', () => resolve(data.trim()));
  });
}

export const feedbackCommand = new Command('feedback')
  .description('Send a message directly to the founder — response within 5 minutes')
  .argument('[message...]', 'Feedback text (use quotes for multi-word)')
  .addHelpText(
    'after',
    `
${chalk.dim('  Every feedback message lands in Slack. Adam replies from his phone.')}

${chalk.bold('Examples:')}
  ${chalk.cyan('solid feedback')}                              Interactive mode
  ${chalk.cyan('solid feedback "Stuck on clone plumber"')}     One-liner
  ${chalk.cyan('echo "thoughts" | solid feedback')}            Piped
`,
  )
  .action(async (messageParts: string[]) => {
    let message = (messageParts || []).join(' ').trim();

    // If no arg and stdin is piped (not TTY), read from stdin
    if (!message && !process.stdin.isTTY) {
      message = await readStdin();
    }

    // Otherwise interactive multiline prompt
    if (!message) {
      console.log('');
      console.log(chalk.bold.hex('#10b981')('  Solid# feedback → Adam (founder)'));
      console.log('');
      message = await promptMultiline();
    }

    if (!message) {
      console.log(chalk.yellow('  Empty — skipped.'));
      return;
    }

    const identity = readIdentity();
    if (!identity) {
      console.log(
        chalk.yellow(
          "  (You haven't run `solid` before — we'll still forward this but won't have a way to reach back unless you include your email in the message.)",
        ),
      );
      console.log('');
    }

    const body = {
      machine_id: identity?.machine_id || 'unknown-' + Math.random().toString(36).slice(2, 10),
      email: identity?.email,
      message,
      cli_version: getCliVersion(),
      recent_commands: readRecentCommands(),
    };

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`${getApiBase()}/api/v1/cli/feedback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      if (res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        emit('feedback_sent', { extra: { length: message.length } });
        console.log('');
        console.log(chalk.hex('#10b981')('  ✓ ' + (data.message || 'Sent. Adam will reply within 5 minutes.')));
        console.log('');
      } else if (res.status === 429) {
        console.log(chalk.yellow('  Easy — you just sent a bunch. Try again in a few minutes.'));
      } else {
        console.log(chalk.yellow(`  Sent but server returned ${res.status}. We still got it.`));
      }
    } catch (err: any) {
      // Save locally as a fallback so nothing's lost
      const fallback = path.join(CONFIG_DIR, 'feedback_outbox.jsonl');
      try {
        if (!fs.existsSync(CONFIG_DIR)) fs.mkdirSync(CONFIG_DIR, { recursive: true });
        fs.appendFileSync(fallback, JSON.stringify({ ts: new Date().toISOString(), body }) + '\n');
      } catch {
        /* noop */
      }
      console.log('');
      console.log(
        chalk.yellow(
          "  Couldn't reach the server — saved locally. We'll retry on your next command.",
        ),
      );
      if (process.env.SOLID_DEBUG) {
        console.log(chalk.dim(`  (${err.message})`));
      }
    }
  });
