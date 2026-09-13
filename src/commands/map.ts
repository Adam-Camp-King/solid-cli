/**
 * solid map — L0. What this business is made of, in one screen.
 *
 * Sprint VNP 3.2. The question an agent opens with is "what can I do here?",
 * and until now the only thing that answered it was `verbs list`, which cost
 * 486,986 tokens before 1.1 and 315,898 after. This answers the same question
 * with one line per noun: what it is, how many verbs it has, how many write.
 *
 * No descriptions, no schemas. An agent reads it once at session start and
 * keeps it — it is smaller than a single verb's full record used to be, and it
 * is the whole mental model: ten classes, then the nouns inside them.
 *
 * The coordinate is what makes it useful rather than merely short. Every row
 * carries its Atlas address, so the next question — "show me those" — is
 * `solid verbs list 52`, computed by the agent from what it already has,
 * with no lookup call in between.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fail, appendExamples } from '../lib/command-kit';

interface MapVerb {
  name: string;
  side_effects?: string;
  coordinate?: string | null;
  noun?: string | null;
}

interface NounRow {
  coordinate: string;
  noun: string;
  verbs: number;
  writes: number;
}

/**
 * Fold the manifest into one row per noun. Pure, so the shaping is testable
 * without a network.
 */
export function buildMap(verbs: readonly MapVerb[]): NounRow[] {
  const rows = new Map<string, NounRow>();

  for (const v of verbs) {
    const coordinate = v.coordinate || '';
    const noun = v.noun || '(unplaced)';
    // Key on both: a noun without a coordinate is a real state (an unplaced
    // verb) and must not be silently merged into a placed one.
    const key = `${coordinate}:${noun}`;
    const row = rows.get(key) || { coordinate, noun, verbs: 0, writes: 0 };
    row.verbs += 1;
    if (v.side_effects && v.side_effects !== 'read') row.writes += 1;
    rows.set(key, row);
  }

  return [...rows.values()].sort(
    (a, b) => a.coordinate.localeCompare(b.coordinate) || a.noun.localeCompare(b.noun),
  );
}

export const mapCommand = new Command('map')
  .description('Every noun on the platform, its verb count, and its Atlas address')
  .option('--json', 'Machine-readable output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Building the map…').start();

    let verbs: MapVerb[];
    try {
      const res = await apiClient.get('/api/v1/agent/verbs');
      const body = res.data as { verbs?: MapVerb[]; items?: MapVerb[] };
      verbs = body.verbs || body.items || [];
    } catch (e) {
      fail(spinner, 'Could not reach the verb manifest', e);
      return;
    }
    spinner?.stop();

    const rows = buildMap(verbs);
    const unplaced = rows.filter((r) => !r.coordinate);

    if (wantsJson) {
      printJson({
        schema: 'solid:agent-map/v1',
        row: ['coordinate', 'noun', 'verbs', 'writes'],
        nouns: rows.length,
        total_verbs: verbs.length,
        // Rows are arrays for the same reason the verb index uses them:
        // repeating four keys 170+ times is most of a small payload.
        map: rows.map((r) => [r.coordinate, r.noun, r.verbs, r.writes]),
        // An unplaced noun is a countable defect, not a silence. Named so it
        // can be fixed rather than discovered later by an agent that cannot
        // address it.
        ...(unplaced.length ? { unplaced: unplaced.map((r) => r.noun) } : {}),
        next: 'solid verbs list <coordinate>  ·  solid find "<what you want>"',
      });
      return;
    }

    const width = Math.max(...rows.map((r) => r.noun.length), 4);
    let lastClass = '';
    console.log('');
    for (const r of rows) {
      const cls = r.coordinate.slice(0, 1);
      if (cls !== lastClass) {
        console.log(chalk.dim(`  ${cls || '?'}__`));
        lastClass = cls;
      }
      const w = r.writes ? chalk.yellow(`${r.writes} write`) : chalk.dim('read only');
      console.log(
        `    ${chalk.bold(r.coordinate.padEnd(3))} ${r.noun.padEnd(width)}  ` +
        `${String(r.verbs).padStart(3)} verbs  ${w}`,
      );
    }
    console.log('');
    console.log(chalk.dim(`  ${rows.length} nouns · ${verbs.length} verbs`));
    if (unplaced.length) {
      console.log(chalk.yellow(`  ⚠ ${unplaced.length} noun(s) with no coordinate: ${unplaced.map((r) => r.noun).join(', ')}`));
    }
    console.log(chalk.dim('  Next:  solid verbs list <coordinate>'));
    console.log('');
  });

appendExamples(mapCommand, [
  { cmd: 'solid map', why: 'The whole surface, one line per noun' },
  { cmd: 'solid map --json', why: 'Cache it once at session start' },
  { cmd: 'solid verbs list 5', why: 'Everything about money' },
  { cmd: 'solid verbs list 52', why: 'Payments only — the prefix is the query' },
]);
