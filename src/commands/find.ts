/**
 * solid find "<what you want to do>"
 *
 * Sprint VNP 2.1. The front door for an agent, which arrives with a sentence
 * rather than a location. One call, intent → callable name, ~120 tokens.
 *
 * Before this the only route from "I want to refund a payment" to a verb name
 * was `verbs list`, which is 315,898 tokens after 1.1 and was 486,986 before —
 * more than most context windows, to answer a question about one verb.
 *
 * The ranking lives in lib/verb-search.ts and is pure, so the interesting part
 * is testable without a network. This file is fetch, rank, print.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fail } from '../lib/command-kit';
import { rankVerbs, clip, type SearchableVerb } from '../lib/verb-search';
import { appendExamples } from '../lib/command-kit';

export const findCommand = new Command('find')
  .description('Find the verb for a task, in plain language — intent to callable name in one call')
  .argument('<query...>', 'What you are trying to do, e.g. "refund a payment"')
  .option('-n, --limit <n>', 'How many matches to return', '5')
  .option('--json', 'Machine-readable output')
  .action(async (queryParts: string[], options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const query = queryParts.join(' ');
    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora(`Searching for "${query}"…`).start();

    let verbs: SearchableVerb[];
    try {
      const res = await apiClient.get('/api/v1/agent/verbs');
      const body = res.data as { verbs?: SearchableVerb[]; items?: SearchableVerb[] };
      verbs = body.verbs || body.items || [];
    } catch (e) {
      fail(spinner, 'Could not reach the verb manifest', e);
      return;
    }

    const limit = Math.max(1, parseInt(options.limit, 10) || 5);
    const matches = rankVerbs(query, verbs, limit);
    spinner?.stop();

    if (wantsJson) {
      // Array-of-arrays, not array-of-objects. Repeating the four keys on
      // every row is most of a small payload, and the shape is documented
      // right here: [name, score, description, side_effects].
      printJson({
        query,
        matches: matches.map((m) => [m.name, m.score, clip(m.description, 72), m.side_effects]),
        // The literal next command. An answer that does not say what to do
        // with it sends the agent back to discovery, which is the thing this
        // command exists to avoid.
        next: matches.length
          ? `solid verbs describe ${matches[0].name}`
          : 'solid verbs list --names-only',
      });
      return;
    }

    if (!matches.length) {
      console.log('');
      console.log(chalk.yellow(`  Nothing matched "${query}".`));
      console.log(chalk.dim('  Try fewer or plainer words, or: solid verbs list --names-only'));
      console.log('');
      return;
    }

    const width = Math.max(...matches.map((m) => m.name.length));
    console.log('');
    for (const m of matches) {
      const tag = m.side_effects === 'read' ? chalk.green('read ') : chalk.yellow('write');
      console.log(
        `  ${chalk.bold(m.name.padEnd(width))}  ${tag}  ${chalk.dim(clip(m.description, 70))}`,
      );
    }
    console.log('');
    console.log(chalk.dim(`  Next:  solid verbs describe ${matches[0].name}`));
    console.log('');
  });

appendExamples(findCommand, [
  { cmd: 'solid find "refund a payment"', why: 'Intent to a callable verb name' },
  { cmd: 'solid find "book an appointment"', why: 'Plain language, no taxonomy needed' },
  { cmd: 'solid find "send an invoice" --json', why: 'Ranked matches for an agent' },
  { cmd: 'solid find "cancel order" -n 3', why: 'Fewer matches, smaller answer' },
]);
