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
 * `solid verbs list 530`, computed by the agent from what it already has,
 * with no lookup call in between.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fail, appendExamples } from '../lib/command-kit';

interface MapVerb {
  name: string;
  side_effects?: string;
  coordinate?: string | null;
  noun?: string | null;
  same_as?: string | null;
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
export function buildMap(verbs: readonly MapVerb[], opts: { aliases?: boolean } = {}): NounRow[] {
  const rows = new Map<string, NounRow>();

  for (const v of verbs) {
    // One name per operation. An alias (same_as) is an older spelling of a verb that is
    // already counted; counting both made a noun look twice its size and, filed by its
    // own spelling, made a second noun (deals beside deal).
    if (v.same_as && !opts.aliases) continue;
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

/** The server's map: `solid:verb-library-map/v1` from GET /api/v1/agent/verbs/map. */
interface LibraryMap {
  schema?: string;
  total?: number;
  classes?: Array<{
    domains?: Array<{ nouns?: Array<[string | null, string, number, number]> }>;
    nouns?: Array<[string | null, string, number, number]>;
  }>;
}

/**
 * Rows from the server's map — the same four fields this command has always printed,
 * already folded. Pure. Returns null when the body is not a library map, so the
 * caller falls back to folding the manifest itself.
 */
export function rowsFromLibraryMap(body: LibraryMap | null | undefined): NounRow[] | null {
  if (!body || body.schema !== 'solid:verb-library-map/v1' || !Array.isArray(body.classes)) return null;
  const rows: NounRow[] = [];
  for (const cls of body.classes) {
    const nouns = [...(cls.domains || []).flatMap((d) => d.nouns || []), ...(cls.nouns || [])];
    for (const [coordinate, noun, verbs, writes] of nouns) {
      rows.push({ coordinate: coordinate || '', noun: noun || '(unplaced)', verbs, writes });
    }
  }
  return rows.sort((a, b) => a.coordinate.localeCompare(b.coordinate) || a.noun.localeCompare(b.noun));
}

export const mapCommand = new Command('map')
  .description('Every noun on the platform, its verb count, and its Atlas address')
  .option('--json', 'Machine-readable output')
  .option('--aliases', 'Count older spellings of a verb too (hidden by default)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Building the map…').start();

    // ⛔ The map used to be folded here from the whole manifest — 2.47 MB downloaded
    // to print about 11,000 characters. The server folds it now (the same data as the
    // `library.map` verb). `--aliases` still needs the manifest: the server's map
    // counts one name per action. A backend that does not serve the map yet (404, or
    // any failure) falls back to the old path, so a published CLI works against
    // whatever it is pointed at.
    let rows: NounRow[] | null = null;
    let total = 0;
    let aliases = 0;
    if (!options.aliases) {
      try {
        const res = await apiClient.get('/api/v1/agent/verbs/map');
        const body = res.data as LibraryMap;
        rows = rowsFromLibraryMap(body);
        if (rows) total = typeof body.total === 'number' ? body.total : rows.reduce((n, r) => n + r.verbs, 0);
      } catch {
        rows = null;
      }
    }
    if (!rows) {
      let verbs: MapVerb[];
      try {
        const res = await apiClient.get('/api/v1/agent/verbs');
        const body = res.data as { verbs?: MapVerb[]; items?: MapVerb[] };
        verbs = body.verbs || body.items || [];
      } catch (e) {
        fail(spinner, 'Could not reach the verb manifest', e);
        return;
      }
      rows = buildMap(verbs, { aliases: Boolean(options.aliases) });
      aliases = options.aliases ? 0 : verbs.filter((v) => v.same_as).length;
      total = verbs.length - aliases;
    }
    spinner?.stop();

    const unplaced = rows.filter((r) => !r.coordinate);

    if (wantsJson) {
      printJson({
        schema: 'solid:agent-map/v1',
        row: ['coordinate', 'noun', 'verbs', 'writes'],
        nouns: rows.length,
        total_verbs: total,
        ...(aliases ? { hidden: { aliases } } : {}),
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
    console.log(chalk.dim(`  ${rows.length} nouns · ${total} verbs`));
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
  { cmd: 'solid verbs list 530', why: 'Payments only — the address is the query' },
]);
