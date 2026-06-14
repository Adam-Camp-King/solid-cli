/**
 * `solid how-to [question]` — plain-language discoverability.
 *
 * GPT's critique: nothing explains "how do I connect this to Claude/ChatGPT"
 * or "what can I actually do", and `solid help` is a command dump. This answers
 * those in plain language, offline (static product knowledge — no network).
 *
 * The matching logic is the pure `findHowTo()` so it's unit-testable.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ui } from '../lib/ui';

export interface HowToTopic {
  id: string;
  title: string;
  keywords: string[];
  body: string;
}

export const HOWTO_TOPICS: HowToTopic[] = [
  {
    id: 'connect',
    title: 'Connect Solid# to Claude, ChatGPT, or your terminal',
    keywords: ['connect', 'claude', 'chatgpt', 'openai', 'cursor', 'ai', 'mcp', 'connector', 'hook', 'integrate', 'setup', 'login'],
    body: [
      'Claude / ChatGPT (MCP connector):',
      '  Settings → Connectors → Add custom connector',
      '  URL: https://api.solidnumber.com/mcp/connector',
      '  Authorize (OAuth), pick your company — it only ever acts on that one.',
      '',
      'Your terminal / local AI tools:',
      '  solid auth login          # authenticate',
      '  solid context --claude    # give Claude Code this company’s context',
      '  solid ai                  # launch Claude / Gemini / Grok with context',
    ].join('\n'),
  },
  {
    id: 'start',
    title: 'Where to start as an operator',
    keywords: ['start', 'begin', 'today', 'first', 'brief', 'overview', 'what now', 'morning'],
    body: [
      'solid today        # daily brief: revenue, pipeline, urgent work, next actions',
      'solid doctor       # check auth, permissions, and connection health',
      'solid status       # your business setup at a glance',
      'solid crm          # contacts, deals, tasks, pipeline',
      'solid sales        # pipeline, forecasting, growth intelligence',
    ].join('\n'),
  },
  {
    id: 'capabilities',
    title: 'What the CLI can do',
    keywords: ['what can', 'capabilities', 'commands', 'features', 'able', 'do', 'list'],
    body: [
      'Run the business from the terminal:',
      '  solid today / crm / sales / leads / inbox    # see and work the pipeline',
      '  solid voice call|text|translate              # outbound voice + SMS',
      '  solid apply + solid publish                  # declare your site/products, take it live',
      '  solid embed <chat|form|paylink>              # paste-ready website snippets',
      '  solid agent dispatch <verb>                  # invoke any platform verb',
      '  solid pages / brand / seo / blog             # site, brand, content',
      '',
      'Full, persona-grouped list: solid --help',
    ].join('\n'),
  },
  {
    id: 'publish',
    title: 'Get a site live',
    keywords: ['publish', 'website', 'site', 'live', 'deploy', 'launch', 'domain', 'page'],
    body: [
      'solid apply site.yaml      # reconcile pages/products/site from one manifest',
      'solid publish --all        # flip drafts live',
      'solid embed chat           # wire live chat into any page',
      'solid domains              # attach a custom domain (SSL handled)',
    ].join('\n'),
  },
];

const DEFAULT_ID = 'start';

function score(question: string, t: HowToTopic): number {
  const q = question.toLowerCase();
  if (!q) return 0;
  let s = t.keywords.reduce((acc, kw) => acc + (q.includes(kw) ? 1 : 0), 0);
  s += t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && q.includes(w)).length;
  return s;
}

/** Pure: best-matching topics for a question; never empty (falls back to "start"). */
export function findHowTo(question: string, limit = 2): HowToTopic[] {
  const ranked = HOWTO_TOPICS
    .map((t) => ({ t, s: score(question, t) }))
    .sort((a, b) => b.s - a.s);
  const hits = ranked.filter((r) => r.s > 0).slice(0, Math.max(1, limit)).map((r) => r.t);
  if (hits.length) return hits;
  return [HOWTO_TOPICS.find((t) => t.id === DEFAULT_ID) as HowToTopic];
}

function renderTopic(t: HowToTopic): void {
  console.log('');
  console.log(chalk.bold.cyan(t.title));
  console.log(t.body);
}

export const howToCommand = new Command('how-to')
  .description('Plain-language answers: how to connect to Claude/ChatGPT, where to start, what the CLI can do')
  .argument('[question...]', 'What you want to do, e.g. "connect to claude"')
  .action((questionParts: string[] = []) => {
    const question = (questionParts || []).join(' ').trim();

    if (!question) {
      console.log('');
      console.log(ui.header('Solid# — how-to'));
      console.log(chalk.dim('Ask in plain language, e.g. `solid how-to connect to claude`. Topics:'));
      for (const t of HOWTO_TOPICS) {
        console.log(`  ${chalk.cyan(t.id.padEnd(14))} ${t.title}`);
      }
      console.log('');
      return;
    }

    for (const t of findHowTo(question)) renderTopic(t);
    console.log('');
  });
