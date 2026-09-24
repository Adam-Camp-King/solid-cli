/**
 * solid where — the Gazetteer. Which place answers this, and what it depends on.
 *
 * Sprint VNP 4.5/4.6. The Atlas addresses meaning; the Gazetteer addresses
 * place. A verb carries a `location`, which is an id in here, so "where does
 * this run" and "what breaks if it goes down" become lookups instead of a
 * conversation — and "how many APIs do we have" becomes `--kind service
 * --serves verbs` instead of an argument between people counting different
 * nouns.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';

import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';
import { isJsonOutput, printJson } from '../lib/json-output';
import { fail, appendExamples } from '../lib/command-kit';

interface Place {
  id: string;
  kind: string;
  name: string;
  status: string;
  owner?: string;
  runs?: { cluster?: string; namespace?: string; workload?: string; port?: number };
  reach?: Record<string, string>;
  health?: string;
  serves?: string[];
  depends_on?: string[];
  note?: string;
}

const ENDPOINT = '/api/v1/agent/verbs/gazetteer';

export const whereCommand = new Command('where')
  .description('Where something runs — the Gazetteer of places')
  .argument('[id]', 'A place id, e.g. svc.api — omit to list everything')
  .option('--kind <kind>', 'service | ui | edge | store | queue | cluster | external')
  .option('--serves <what>', 'Only places that answer this, e.g. verbs')
  .option('--json', 'Machine-readable output')
  .action(async (id: string | undefined, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Reading the Gazetteer…').start();

    let places: Place[];
    try {
      const params: Record<string, string> = {};
      if (options.kind) params.kind = options.kind;
      if (options.serves) params.serves = options.serves;
      const res = await apiClient.get(ENDPOINT, { params });
      places = (res.data as { places?: Place[] }).places || [];
    } catch (e) {
      fail(spinner, 'Could not reach the Gazetteer', e);
      return;
    }
    spinner?.stop();

    // An id narrows client-side: it is one fetch either way, and this keeps
    // `where` answerable from a cached listing once 4.2 caching lands.
    const rows = id ? places.filter((p) => p.id === id) : places;

    if (id && rows.length === 0) {
      const near = places
        .filter((p) => p.id.includes(id) || id.includes(p.id.split('.')[0]))
        .map((p) => p.id)
        .slice(0, 5);
      printJson({
        error: {
          code: 'NOT_FOUND',
          message: `No place with id "${id}".`,
          retryable: false,
          ...(near.length ? { did_you_mean: near } : {}),
          fix: 'solid where',
        },
      });
      process.exitCode = 1;
      return;
    }

    if (wantsJson) {
      printJson({
        schema: 'solid:gazetteer/v1',
        count: rows.length,
        places: rows,
        next: 'solid where svc.api  ·  solid where --kind service --serves verbs',
      });
      return;
    }

    console.log('');
    let lastKind = '';
    for (const p of rows) {
      if (p.kind !== lastKind) {
        console.log(chalk.dim(`  ${p.kind}`));
        lastKind = p.kind;
      }
      const status = p.status === 'live' ? chalk.green('live') : chalk.yellow(p.status);
      console.log(`    ${chalk.bold(p.id.padEnd(20))} ${p.name.padEnd(26)} ${status}`);
      if (rows.length === 1) {
        if (p.runs) {
          const r = p.runs;
          console.log(`      runs:       ${[r.cluster, r.namespace, r.workload, r.port].filter(Boolean).join(' · ')}`);
        }
        for (const [env, url] of Object.entries(p.reach || {})) console.log(`      reach:      ${env} → ${url}`);
        if (p.health) console.log(`      health:     ${p.health}`);
        if (p.serves?.length) console.log(`      serves:     ${p.serves.join(', ')}`);
        if (p.depends_on?.length) console.log(`      depends on: ${p.depends_on.join(', ')}`);
        if (p.note) console.log(chalk.dim(`      note:       ${p.note}`));
      }
    }
    console.log('');
    console.log(chalk.dim(`  ${rows.length} place(s)`));
    console.log('');
  });

appendExamples(whereCommand, [
  { cmd: 'solid where', why: 'Every place, grouped by kind' },
  { cmd: 'solid where svc.api', why: 'One place in full, with its dependencies' },
  { cmd: 'solid where --kind service --serves verbs', why: '"How many APIs" — as a query' },
  { cmd: 'solid where --kind external', why: 'Every third party we depend on' },
]);
