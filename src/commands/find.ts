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
 * ⛔ THE RANKING MOVED TO THE BACKEND (2026-09-15), AND WHY THAT IS THE POINT.
 * lib/verb-search.ts is lexical, and it measured 95% top-1 on the 20 prompts it
 * was tuned against and 39% on 18 held-out ones. That gap is the method, not
 * the tuning: every synonym added to close a miss fits the tuned set and does
 * not generalise. `agent.verbs.search` ranks the same catalog with embeddings
 * and scores 56% top-1 / 78% top-5 on the held-out set.
 *
 * Since 2026-10-04 a second stage reads the closest candidates against the
 * request (the backend's services/verb_judge.py): 82% top-1 on a set written
 * before it existed, and it can answer that NO verb does the request. find
 * carries that answer through whole — see lib/find-answer.ts.
 *
 * The bigger reason is that this ranker was CLI-private, so an agent on Claude
 * Desktop, in a browser, or arriving over UCP had no verb discovery at all —
 * it had to download all 936 verbs. Discovery is not a CLI feature; it is the
 * front door, and the front door belongs where the registry is. It also sends
 * one sentence instead of pulling 1.3 MB of manifest.
 *
 * ⛔ THE LOCAL RANKER STAYS, AS THE FALLBACK, AND MUST. A published CLI runs
 * against whatever backend the user points at — including one deployed before
 * that verb existed, and including no network at all. `find` degrading to 39%
 * is a worse answer; `find` failing is no answer.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fail } from '../lib/command-kit';
import { rankVerbs, clip, type SearchableVerb, type VerbMatch } from '../lib/verb-search';
import { appendExamples } from '../lib/command-kit';
import { readSearchAnswer, type SearchAnswer } from '../lib/find-answer';

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

    const limit = Math.max(1, parseInt(options.limit, 10) || 5);

    // ── 1. The server-side ranker, which is the real one.
    let matches: VerbMatch[] | null = null;
    let rankedBy = 'lexical (local)';
    let searchedCount = 0;
    let answer: SearchAnswer | null = null;
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'agent.verbs.search',
        args: { query, limit },
        confirm: false,
        typed_phrase: null,
      });
      answer = readSearchAnswer(res.data);
      if (answer.state !== 'unusable') {
        matches = answer.matches;
        rankedBy = answer.judged ? `${answer.rankedBy}, then judged` : answer.rankedBy;
      }
    } catch {
      // Any failure at all — old backend, no route, offline, rate limit —
      // falls through. This is never fatal: see the header.
    }
    // ⛔ The server read the catalog and answered that no verb does this. That is
    // the answer — the local ranker is not asked for five guesses to replace it.
    const noVerb = answer?.state === 'no_verb';
    // ⛔ And "not one verb" is not "no": something to BUILD comes back with its
    // path, a vague request with the questions to settle. Both are the answer.
    const toBuild = answer?.state === 'build' ? answer.answer : null;
    const toAsk = answer?.state === 'ask' ? answer.answer : null;

    // ── 2. Fallback: pull the manifest and rank it here.
    if (!matches) {
      let verbs: SearchableVerb[];
      try {
        const res = await apiClient.get('/api/v1/agent/verbs');
        const body = res.data as { verbs?: SearchableVerb[]; items?: SearchableVerb[] };
        verbs = body.verbs || body.items || [];
      } catch (e) {
        fail(spinner, 'Could not reach the verb manifest', e);
        return;
      }
      searchedCount = verbs.length;
      matches = rankVerbs(query, verbs, limit);
    }
    spinner?.stop();

    if (wantsJson) {
      // Array-of-arrays, not array-of-objects. Repeating the four keys on
      // every row is most of a small payload, and the shape is documented
      // right here: [name, score, description, side_effects].
      printJson({
        query,
        matches: matches.map((m) => [m.name, m.score, clip(m.description, 72), m.side_effects]),
        // ⛔ SAY WHICH SPACE WAS SEARCHED, BECAUSE THE ANSWER MAY NOT BE IN IT.
        // find ranks the BACKEND verb manifest. A large class of things an
        // agent wants are CLI-local commands that change session state and are
        // not verbs at all — switching company, logging in, pull/push.
        // Measured 2026-09-14: "switch to another company" returned
        // switchboard.get_usage, and "create a new company" returned
        // company.create_field_schema at 0.95. Both are the best answers
        // available in this space and neither is the answer. A ranker that
        // cannot say "not in here" turns a miss into a confident wrong turn,
        // so the envelope now names the space and the place to look next.
        searched: searchedCount
          ? `${searchedCount} backend verbs (GET /api/v1/agent/verbs)`
          : 'the backend verb catalog (agent.verbs.search)',
        // ⛔ SAY WHICH RANKER ANSWERED. 'hybrid' and 'lexical (local)' are
        // different qualities of answer, and an agent deciding whether to
        // trust a low score needs to know which one it got.
        ranked_by: rankedBy,
        // How sure the server is, and what to do about it — measured on held-out
        // prompts and published by the search itself. Absent when the local
        // ranker answered: it has no calibration to offer.
        ...(answer?.confidence
          ? { confidence: { level: answer.confidence.level, next_step: answer.confidence.next_step } }
          : {}),
        ...(noVerb
          ? {
              no_verb: true,
              closest: answer!.closest.map((c) => [c.name, clip(c.description, 72)]),
              ...(answer!.gap ? { gap: answer!.gap } : {}),
            }
          : {}),
        // Written to the AI that asked: what kind of request this is, the path to
        // follow (who builds, each step and the verb it calls) or the questions
        // to settle. Never clipped — it is instructions, not a listing.
        ...(toBuild || toAsk ? { answer: toBuild || toAsk } : {}),
        ...(noVerb && answer!.answer ? { answer: answer!.answer } : {}),
        not_searched:
          'CLI-local commands (switch, company, auth, pull, push) are not verbs — ' +
          'list them with: solid schema verbs --json',
        // The literal next command. An answer that does not say what to do
        // with it sends the agent back to discovery, which is the thing this
        // command exists to avoid.
        next: toBuild
          ? `Follow answer.path.steps in order. First: solid verbs describe ${toBuild.path!.steps.find((st) => st.verb)?.verb ?? 'design.intake'}`
          : toAsk
            ? 'Settle answer.ask (ask the user only what you cannot answer), then: solid find "<one action, one sentence>"'
            : matches.length
          ? `solid verbs describe ${matches[0].name}`
          : noVerb
            ? 'No verb does this. Tell the user plainly; it is recorded as a request for one.'
            : 'solid schema verbs --json',
      });
      return;
    }

    if (toBuild) {
      const path = toBuild.path!;
      console.log('');
      console.log(chalk.green(`  ${toBuild.say}`));
      console.log('');
      console.log(`  ${chalk.bold(path.what)}`);
      console.log(chalk.dim(`  ${path.who_builds}`));
      console.log('');
      for (const st of path.steps) {
        const who = st.verb ? chalk.cyan(st.verb) : chalk.yellow('yours');
        console.log(`  ${st.step}. ${who}`);
        console.log(chalk.dim(`     ${st.do}`));
      }
      console.log('');
      console.log(chalk.dim(`  ${path.how_it_connects}`));
      console.log(chalk.dim('  Each verb above:  solid verbs describe <name>'));
      console.log('');
      return;
    }

    if (toAsk) {
      console.log('');
      console.log(chalk.green(`  ${toAsk.say}`));
      console.log('');
      for (const q of toAsk.ask!) console.log(`    • ${q}`);
      console.log('');
      console.log(chalk.dim('  Then search again, one sentence per action:  solid find "create an invoice for a customer"'));
      console.log('');
      return;
    }

    if (noVerb) {
      console.log('');
      console.log(chalk.yellow(`  No verb does "${query}".`));
      if (answer!.answer?.say) console.log(`  ${answer!.answer.say}`);
      if (answer!.confidence?.next_step) console.log(chalk.dim(`  ${answer!.confidence.next_step}`));
      if (answer!.closest.length) {
        console.log('');
        console.log(chalk.dim('  The closest that were read (none of them does it):'));
        for (const c of answer!.closest) {
          console.log(chalk.dim(`    ${c.name}  ${clip(c.description, 70)}`));
        }
      }
      console.log('');
      return;
    }

    if (!matches.length) {
      console.log('');
      console.log(chalk.yellow(`  Nothing matched "${query}" in the backend verb catalog.`));
      console.log(chalk.dim('  Try fewer or plainer words, or: solid verbs list --names-only'));
      console.log(chalk.dim('  CLI-local commands (switch, company, auth) are not verbs:'));
      console.log(chalk.dim('    solid schema verbs --json     every command, flag and description'));
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
    if (answer?.confidence?.next_step) {
      console.log(chalk.dim(`  ${answer.confidence.level}: ${answer.confidence.next_step}`));
    }
    console.log(chalk.dim(`  Next:  solid verbs describe ${matches[0].name}`));
    console.log(
      chalk.dim(
        `  Ranked by ${rankedBy}. CLI commands are not verbs: solid schema verbs --json`,
      ),
    );
    console.log('');
  });

appendExamples(findCommand, [
  { cmd: 'solid find "refund a payment"', why: 'Intent to a callable verb name' },
  { cmd: 'solid find "book an appointment"', why: 'Plain language, no taxonomy needed' },
  { cmd: 'solid find "send an invoice" --json', why: 'Ranked matches for an agent' },
  { cmd: 'solid find "cancel order" -n 3', why: 'Fewer matches, smaller answer' },
]);
