/**
 * ================================================================================
 * solid explore — Platform Intelligence Console
 * ================================================================================
 *
 * Interactive AI-powered exploration of the Solid# platform.
 * Designed for partners, evaluators, and potential acquirers.
 *
 * Features:
 * - Calls backend API (all intelligence lives server-side)
 * - Premium models: Sonnet baseline, Opus for deep dives
 * - P.I.T.C.H. personality: playful, adaptive, transparent, no BS
 * - Deep curated knowledge base (not just marketing docs)
 * - Two-tier rate limiting (burst + sustained)
 *
 * Usage:
 *   solid explore                    # Interactive REPL
 *   solid explore "question here"    # Single question
 * ================================================================================
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as readline from 'readline';
import * as path from 'path';
import * as fs from 'fs';

// ── Platform Knowledge (bundled at build time) ──────────────────────

function loadBundledDocs(): string {
  const docsDir = path.join(__dirname, '..', '..', 'platform-docs');
  const files = ['llms.txt', 'ai.txt'];
  const parts: string[] = [];

  for (const file of files) {
    const filePath = path.join(docsDir, file);
    if (fs.existsSync(filePath)) {
      parts.push(fs.readFileSync(filePath, 'utf-8'));
    }
  }

  // Fallback: try to fetch from solidnumber.com if not bundled
  if (parts.length === 0) {
    return ''; // Will fetch at runtime
  }

  return parts.join('\n\n---\n\n');
}

async function fetchDocsIfNeeded(bundled: string): Promise<string> {
  if (bundled.length > 1000) return bundled;

  // Fetch from public URL as fallback
  try {
    const axios = (await import('axios')).default;
    const [llmsRes, aiRes] = await Promise.all([
      axios.get('https://solidnumber.com/llms.txt', { timeout: 5000 }),
      axios.get('https://solidnumber.com/ai.txt', { timeout: 5000 }),
    ]);
    return `${llmsRes.data}\n\n---\n\n${aiRes.data}`;
  } catch {
    return 'Solid# is AI business infrastructure with 116 agents, 608 MCP tools, 511 database tables, and 4M lines of code across 52 industries.';
  }
}

// ── System Prompt (unused — backend handles all intelligence) ────────
// The backend at EXPLORE_API owns the system prompt, knowledge base,
// and model selection. This const is kept only as a fallback reference.
const SYSTEM_PROMPT = '';

// ── Brand Colors & Display ──────────────────────────────────────────

const BRAND = {
  primary: '#818cf8',
  secondary: '#6366f1',
  accent: '#4f46e5',
  dim: '#94a3b8',
  success: '#22c55e',
  warm: '#f59e0b',
};

function brandText(text: string): string {
  return chalk.hex(BRAND.primary)(text);
}

function displayWelcome(): void {
  const logo = [
    '',
    chalk.hex(BRAND.primary)('  ███████╗ ██████╗ ██╗     ██╗██████╗  ██╗ ██╗'),
    chalk.hex(BRAND.secondary)('  ██╔════╝██╔═══██╗██║     ██║██╔══██╗ ████████'),
    chalk.hex(BRAND.accent)('  ███████╗██║   ██║██║     ██║██║  ██║ ██╔══██║'),
    chalk.hex(BRAND.secondary)('  ╚════██║██║   ██║██║     ██║██║  ██║ ████████'),
    chalk.hex(BRAND.primary)('  ███████║╚██████╔╝███████╗██║██████╔╝ ██║ ██║'),
    chalk.hex(BRAND.accent)('  ╚══════╝ ╚═════╝ ╚══════╝╚═╝╚═════╝  ╚═╝ ╚═╝'),
    '',
    chalk.bold('  Platform Intelligence Console'),
    chalk.hex(BRAND.dim)('  Ask anything about the platform. We\'ve got nothing to hide.'),
    chalk.hex(BRAND.dim)('  (Except the source code. That costs extra.)'),
    '',
    chalk.hex(BRAND.dim)('  ╭─────────────────────────────────────────────────────╮'),
    chalk.hex(BRAND.dim)('  │') + chalk.hex(BRAND.warm)(' 116 agents') + chalk.hex(BRAND.dim)(' · ') + chalk.hex(BRAND.warm)('608 MCP tools') + chalk.hex(BRAND.dim)(' · ') + chalk.hex(BRAND.warm)('511 tables') + chalk.hex(BRAND.dim)(' · ') + chalk.hex(BRAND.warm)('4M LOC') + chalk.hex(BRAND.dim)(' │'),
    chalk.hex(BRAND.dim)('  ╰─────────────────────────────────────────────────────╯'),
    '',
    chalk.hex(BRAND.dim)('  Type your question and press Enter. Type "exit" to quit.'),
    '',
  ];

  console.log(logo.join('\n'));
}

// ── Claude API (direct, streaming) ──────────────────────────────────

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

const EXPLORE_API = 'https://api.solidnumber.com/api/v1/explore/chat';

async function askPlatform(
  messages: Message[],
  _systemPrompt: string,
  _platformDocs: string,
): Promise<string> {
  const axios = (await import('axios')).default;
  const ora = (await import('ora')).default;

  const lastMessage = messages[messages.length - 1]?.content || '';
  const history = messages.slice(0, -1);

  const spinner = ora({
    text: chalk.hex(BRAND.dim)('  thinking...'),
    spinner: 'dots',
    indent: 0,
  }).start();

  try {
    // Backend returns SSE (text/event-stream): `data: <chunk>\n\n` lines,
    // terminated by `data: [DONE]\n\n`. Consume the stream and print tokens
    // as they arrive so the CLI gets the same typing effect as the web UI.
    const response = await axios.post(
      EXPLORE_API,
      {
        message: lastMessage,
        conversation_history: history,
      },
      {
        headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
        timeout: 45000,
        responseType: 'stream',
      },
    );

    spinner.stop();

    process.stdout.write(`\n  ${chalk.hex(BRAND.success)('Solid#')} ${chalk.hex(BRAND.dim)('›')} `);

    let full = '';
    let buffer = '';
    let errored = false;

    const stream = response.data as NodeJS.ReadableStream;
    for await (const chunk of stream) {
      buffer += chunk.toString('utf-8');
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!event.startsWith('data: ')) continue;
        const payload = event.slice(6);
        if (payload === '[DONE]') continue;
        if (payload.startsWith('[ERROR]')) {
          errored = true;
          const msg = payload.slice(7).trim();
          process.stdout.write(chalk.red(msg));
          full += msg;
          continue;
        }
        process.stdout.write(payload);
        full += payload;
      }
    }

    process.stdout.write('\n\n');

    if (!full) {
      const msg = errored ? 'Platform Intelligence hit a snag. Try again.' : 'No response';
      console.log(`  ${chalk.red('Error')} ${chalk.hex(BRAND.dim)('›')} ${msg}\n`);
      return msg;
    }

    return full;
  } catch (error) {
    spinner.stop();
    const e = error as { response?: { status?: number; data?: { detail?: string } }; message?: string };

    if (e.response?.status === 429) {
      // Backend returns a friendly rate limit message — use it directly
      const msg = e.response?.data?.detail || 'Taking a breather — try again in a couple minutes. Or hit up sales@solidnumber.com.';
      console.log(`\n  ${chalk.hex(BRAND.warm)('Solid#')} ${chalk.hex(BRAND.dim)('›')} ${msg}\n`);
      return msg;
    }

    const errMsg = e.response?.data?.detail || e.message || 'Connection error';
    console.log(`\n  ${chalk.red('Error')} ${chalk.hex(BRAND.dim)('›')} ${errMsg}\n`);
    return errMsg;
  }
}

// ── Command Definition ──────────────────────────────────────────────

export const exploreCommand = new Command('explore')
  .description('Platform Intelligence — ask anything about Solid#')
  .argument('[question...]', 'Ask a single question (or omit for interactive mode)')
  .option('--deep', 'Always use the deeper AI model')
  .action(async (questionParts: string[], options: Record<string, unknown>) => {
    // Load platform docs
    const bundled = loadBundledDocs();
    const platformDocs = await fetchDocsIfNeeded(bundled);

    const question = questionParts?.join(' ')?.trim();

    if (question) {
      // Single question mode
      const messages: Message[] = [{ role: 'user', content: question }];
      await askPlatform(messages, SYSTEM_PROMPT, platformDocs);
      return;
    }

    // Interactive mode
    displayWelcome();

    const conversationHistory: Message[] = [];

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: `  ${brandText('you')} ${chalk.hex(BRAND.dim)('›')} `,
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      if (['exit', 'quit', 'bye', 'q'].includes(input.toLowerCase())) {
        console.log(`\n  ${chalk.hex(BRAND.dim)('This was fun. sales@solidnumber.com if anything sparked. Or call +1 (801) 448-0807 and let Sarah show off.')}\n`);
        rl.close();
        return;
      }

      // Add to conversation
      conversationHistory.push({ role: 'user', content: input });

      // Keep conversation to last 10 turns to save tokens
      const recentMessages = conversationHistory.slice(-20);

      const response = await askPlatform(recentMessages, SYSTEM_PROMPT, platformDocs);
      conversationHistory.push({ role: 'assistant', content: response });

      rl.prompt();
    });

    rl.on('close', () => {
      process.exit(0);
    });
  });

import { appendExamples as __ae_explore } from '../lib/command-kit';
__ae_explore(exploreCommand, [
  { cmd: 'solid explore "how do I add a new industry?"', why: 'Ask about the Solid# platform' },
  { cmd: 'solid explore --topics',                       why: 'Browseable intelligence topics' },
  { cmd: 'solid explore --refresh',                      why: 'Pull the latest intelligence bundle' },
]);
