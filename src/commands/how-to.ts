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
    // ⛔ 'do' WAS HERE AND IT MATCHED ALMOST EVERY QUESTION. People ask "how DO
    // I …", so this topic won any question that did not match something else —
    // "how do I change which company I'm on" came back as "What the CLI can
    // do". Word-boundary matching does not save a keyword this common; the
    // keyword itself has to go. "what can" already carries the intent.
    keywords: ['what can', 'capabilities', 'commands', 'features', 'able to', 'list commands'],
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
      'solid apply site.yaml      # reconcile pages/products/site/agents/lines from one manifest',
      'solid publish --all        # flip drafts live',
      'solid embed chat           # wire live chat into any page',
      'solid domains              # attach a custom domain (SSL handled)',
    ].join('\n'),
  },
];

const DEFAULT_ID = 'start';

/**
 * Does this keyword appear as a WORD in the question?
 *
 * ⛔ SUBSTRING MATCHING MADE SHORT KEYWORDS MATCH EVERYTHING. `q.includes(kw)`
 * meant the `connect` topic's keyword `ai` fired on "expl-AI-n",
 * "em-AI-l", "av-AI-lable" and "f-AI-l", and the `capabilities` topic's
 * keyword `do` fired on any question containing the word "do" — which is most
 * of them, since people ask "how DO I…". Measured 2026-09-14:
 *
 *   "explain the pipeline"                     -> connect       (via expl-ai-n)
 *   "how do I change which company I'm on"     -> capabilities  (via do)
 *
 * Both answered confidently and neither question was about the topic
 * returned. A keyword is a word, so it is matched as one. Multi-word
 * keywords ("what can") still match as a phrase.
 */
function mentions(q: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(q);
}

function score(question: string, t: HowToTopic): number {
  const q = question.toLowerCase();
  if (!q) return 0;
  let s = t.keywords.reduce((acc, kw) => acc + (mentions(q, kw) ? 1 : 0), 0);
  s += t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && mentions(q, w)).length;
  return s;
}

/**
 * Pure: topics that actually match the question. MAY BE EMPTY.
 *
 * ⛔ AN UNMATCHED QUESTION USED TO RETURN THE "start" TOPIC, AND THE CALLER
 * COULD NOT TELL. That is the expensive failure for an agent: "how do I switch
 * company?" came back with a confident list of unrelated commands and no
 * signal that nothing had matched, so the agent reads it as answered and stops
 * looking. A tool that cannot answer has to say so — an empty result is a fact
 * the caller can act on, and a wrong one is not.
 */
export function findHowTo(question: string, limit = 2): HowToTopic[] {
  return HOWTO_TOPICS
    .map((t) => ({ t, s: score(question, t) }))
    .sort((a, b) => b.s - a.s)
    .filter((r) => r.s > 0)
    .slice(0, Math.max(1, limit))
    .map((r) => r.t);
}

/** The topic shown when someone runs `how-to` with no question at all. */
export function defaultHowTo(): HowToTopic {
  return HOWTO_TOPICS.find((t) => t.id === DEFAULT_ID) as HowToTopic;
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

    const hits = findHowTo(question);

    if (hits.length === 0) {
      // ⛔ SAY SO. The previous behaviour printed the "start" topic here, which
      // reads exactly like an answer. Point at the two surfaces that DO cover
      // the whole CLI, so a miss still ends with the caller knowing where to go.
      console.log('');
      console.log(chalk.yellow(`No how-to topic matches ${JSON.stringify(question)}.`));
      console.log(chalk.dim('  how-to covers a few common topics only:'));
      for (const t of HOWTO_TOPICS) {
        console.log(`    ${chalk.cyan(t.id.padEnd(14))} ${t.title}`);
      }
      console.log('');
      console.log(chalk.dim('  For anything else, these cover the whole surface:'));
      console.log(chalk.dim('    solid schema verbs --json     every command, flag and description'));
      console.log(chalk.dim('    solid find "<what you want>"  rank backend verbs by intent'));
      console.log(chalk.dim('    solid --help                  the full command list'));
      console.log('');
      process.exitCode = 1;
      return;
    }

    for (const t of hits) renderTopic(t);
    console.log('');
  });
