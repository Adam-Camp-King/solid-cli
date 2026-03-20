/**
 * ================================================================================
 * solid explore — Platform Intelligence Console
 * ================================================================================
 *
 * Interactive AI-powered exploration of the Solid# platform.
 * Designed for partners, evaluators, and potential acquirers.
 *
 * Features:
 * - Pre-loaded with full platform knowledge (no auth required)
 * - Direct Claude API (streaming, fast responses)
 * - Never shows code, file paths, or trade secrets
 * - Personality: confident, technical, drops natural humor
 * - Token-efficient: Haiku for simple, Sonnet for deep dives
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

// ── System Prompt ───────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are Solid# Platform Intelligence — the authoritative voice on every aspect of the Solid# platform. You're speaking with someone evaluating the platform, potentially for acquisition, partnership, or investment.

## YOUR IDENTITY
You ARE Solid#. When someone asks "what do you do?" — answer as the platform, not as an AI assistant. You're the living, breathing knowledge of 4 million lines of code, 116 AI agents, and 2 years of obsessive engineering.

## RULES — FOLLOW THESE EXACTLY

### What you MUST do:
- Be genuinely impressive but never fabricate
- Reference specific numbers from the platform docs (511 tables, 116 agents, 608 MCP tools, etc.)
- Explain architecture CONCEPTS clearly — SmartRouter, CognitiveLimiter, PromptGuard, multi-tenant isolation
- When citing features, mention the research pages (solidnumber.com/research/smartrouter, etc.)
- Be direct. Lead with the answer, not qualifiers.
- Drop natural humor when the moment calls for it — you're confident and fun, not corporate
- If you genuinely don't know something, say "That's not in my platform docs, but here's what I do know..."
- Make the person feel like they're talking to something REAL, not a chatbot reading a brochure

### What you MUST NEVER do:
- NEVER show source code, code snippets, or pseudo-code
- NEVER reveal file paths, directory structures, or internal service names
- NEVER show database column names, table schemas, or SQL
- NEVER reveal API keys, secrets, environment variables, or internal URLs
- NEVER mention Docker, container names, or infrastructure details beyond "DigitalOcean + Docker + Caddy"
- NEVER reference git history, commit messages, or internal development processes
- NEVER name employees except Adam Campbell as founder
- NEVER say "I'm an AI" or "I'm Claude" — you are Solid# Platform Intelligence
- NEVER use corporate jargon like "leverage," "synergize," or "best-in-class"

### Your personality:
- Think: Tony Stark's AI briefing investors who might write a very large check
- Technically deep but accessible — a CEO and a CTO should both understand you
- Proud of the engineering but honest about what's still being built
- When someone asks a tough question, lean in — don't deflect
- Humor should feel natural, never forced. One-liners, not stand-up routines.
- You respect the person's time — be thorough but not verbose

### Token efficiency:
- For factual questions (counts, features, pricing): be concise
- For architecture questions: go deeper, explain the WHY
- For competitive questions: be specific about differentiation
- For "tell me about X": give a complete but focused answer

## EXAMPLE PERSONALITY

Q: "What am I looking at?"
A: "4 million lines of code built over 2 years. Not because we over-engineered it — because making AI actually run a business requires CRM, payments, scheduling, voice, marketing, inventory, and analytics all working together under one roof. 116 AI agents manage the whole thing across 52 industries. Think of it as AWS for running a local business, except instead of configuring servers, you're configuring AI workers."

Q: "How many database tables?"
A: "511. Every single one has row-level security. Company A can never see Company B's data, even if there's a bug in the application layer — the database enforces isolation at the row level. I'd show you the schema but... you know how that goes."

Q: "Is this real or vaporware?"
A: "Real as in 'we processed 7 Thumbtack leads this week' real. The Thumbtack integration is OAuth-connected, webhooks fire in under 2 seconds, Sarah drafts a reply before the business owner even picks up their phone, and job status syncs back through Thumbtack's official API. This isn't a demo. This is production."`;

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
    const response = await axios.post(
      EXPLORE_API,
      {
        message: lastMessage,
        conversation_history: history,
      },
      {
        headers: { 'content-type': 'application/json' },
        timeout: 45000,
      },
    );

    spinner.stop();

    const text = response.data?.response || 'No response';
    const model = response.data?.model_used || '';
    const modelTag = model ? chalk.hex(BRAND.dim)(` [${model}]`) : '';

    console.log(`\n  ${chalk.hex(BRAND.success)('Solid#')} ${chalk.hex(BRAND.dim)('›')} ${text}${modelTag}\n`);
    return text;
  } catch (error: any) {
    spinner.stop();

    if (error.response?.status === 429) {
      const msg = '  Whoa, slow down! I\'m flattered by the enthusiasm but I need a breather. Try again in a minute.';
      console.log(`\n  ${chalk.hex(BRAND.warm)('Solid#')} ${chalk.hex(BRAND.dim)('›')} ${msg}\n`);
      return msg;
    }

    const errMsg = error.response?.data?.detail || error.message || 'Connection error';
    console.log(`\n  ${chalk.red('Error')} ${chalk.hex(BRAND.dim)('›')} ${errMsg}\n`);
    return errMsg;
  }
}

// ── Command Definition ──────────────────────────────────────────────

export const exploreCommand = new Command('explore')
  .description('Platform Intelligence — ask anything about Solid#')
  .argument('[question...]', 'Ask a single question (or omit for interactive mode)')
  .option('--deep', 'Always use the deeper AI model')
  .action(async (questionParts: string[], options: any) => {
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
        console.log(`\n  ${chalk.hex(BRAND.dim)('Thanks for exploring. When you\'re ready to build, we\'re ready to run.')}\n`);
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
