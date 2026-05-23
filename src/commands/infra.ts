/**
 * solid infra — managed-droplet infrastructure verbs
 *
 * Wraps the four ada infrastructure verbs (diagnose, preview-resize,
 * resize, scale-workers) as first-class CLI commands. All four route
 * through POST /api/v1/ada/cli-dispatch with the same role gates,
 * typed-phrase enforcement, and audit log as a direct
 * `solid agent dispatch infrastructure_<x>` call.
 *
 *   solid infra diagnose
 *     → infrastructure_diagnose (read)
 *
 *   solid infra preview-resize <SIZE>
 *     → infrastructure_preview_resize (read)
 *
 *   solid infra resize <SIZE> --confirm --phrase "RESIZE droplet to <SIZE>"
 *     → infrastructure_resize (IRREVERSIBLE, owner + typed phrase)
 *
 *   solid infra scale-workers <DELTA> --confirm --phrase "SCALE celery workers by <signed-delta>"
 *     → infrastructure_scale_workers (IRREVERSIBLE, owner + typed phrase)
 *
 * SIZE = SMALL | MEDIUM | LARGE | GPU
 *
 * NOTE: these target the TENANT'S managed droplet (Type 2 Managed
 * Instance), NOT Solid#'s own platform droplet. Platform infra is
 * operator-only — touched via ./deploy.sh, never via these verbs.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';

import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

const VALID_SIZES = ['SMALL', 'MEDIUM', 'LARGE', 'GPU'] as const;

async function _infraDispatch(
  verb: string,
  args: Record<string, unknown>,
  options: { json?: boolean; confirm?: boolean; phrase?: string },
  spinnerLabel: string,
) {
  requireAuth();
  const spinner = ora(spinnerLabel).start();
  try {
    const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
      verb,
      args,
      confirm: Boolean(options.confirm),
      typed_phrase: options.phrase || null,
    });
    const data = (res.data as any) || {};
    if (isJsonOutput(options)) {
      spinner.stop();
      console.log(JSON.stringify(data, null, 2));
      return;
    }
    if (data.ok === false || data.error) {
      const reason = data?.error?.reason || data?.detail?.error || 'unknown';
      const msg = data?.error?.message || data?.detail?.message || 'Verb denied or failed.';
      spinner.fail(chalk.red(`${verb}: ${reason}`));
      console.error(chalk.red(`  ${msg}`));
      process.exit(1);
    }
    spinner.succeed(chalk.green(`${verb}: ${data?.result?.status || 'ok'}`));
    const summary = data?.result || data;
    const compact: Record<string, unknown> = {};
    for (const key of Object.keys(summary || {}).slice(0, 10)) {
      const v = (summary as any)[key];
      compact[key] = typeof v === 'string' && v.length > 80 ? v.slice(0, 77) + '...' : v;
    }
    if (Object.keys(compact).length > 0) {
      console.log(chalk.dim('  ' + JSON.stringify(compact, null, 2).replace(/\n/g, '\n  ')));
    }
  } catch (error) {
    spinner.fail(chalk.red(`Dispatch failed: ${handleApiError(error).message}`));
    process.exit(1);
  }
}

function _normalizeSize(raw: string): string {
  const s = (raw || '').toUpperCase();
  if (!VALID_SIZES.includes(s as (typeof VALID_SIZES)[number])) {
    console.error(
      chalk.red(`Invalid size "${raw}". Expected one of: ${VALID_SIZES.join(', ')}`),
    );
    process.exit(2);
  }
  return s;
}

export const infraCommand = new Command('infra').description(
  'Managed droplet infrastructure — diagnose, preview, resize, scale workers',
);

// solid infra diagnose
infraCommand
  .command('diagnose')
  .description('Diagnose the tenant\'s managed droplet (health + resources + queue depth)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    await _infraDispatch('infrastructure_diagnose', {}, options, 'Diagnosing droplet...');
  });

// solid infra preview-resize <size>
infraCommand
  .command('preview-resize <size>')
  .description('Preview the cost delta and reversibility of resizing to <size>')
  .option('--json', 'Output as JSON')
  .action(async (size: string, options) => {
    const target = _normalizeSize(size);
    await _infraDispatch(
      'infrastructure_preview_resize',
      { target_size_slug: target },
      options,
      `Previewing resize to ${target}...`,
    );
  });

// solid infra resize <size>
infraCommand
  .command('resize <size>')
  .description('Resize the droplet (IRREVERSIBLE; owner role + typed phrase required)')
  .option('--confirm', 'Required: actually issue the resize')
  .option(
    '--phrase <phrase>',
    'Typed phrase. Must equal "RESIZE droplet to <SIZE>" (case-insensitive).',
  )
  .option('--json', 'Output as JSON')
  .action(async (size: string, options) => {
    const target = _normalizeSize(size);
    if (!options.confirm) {
      console.error(chalk.red('Refusing to resize without --confirm.'));
      process.exit(2);
    }
    if (!options.phrase) {
      console.error(
        chalk.red(`Missing --phrase. Pass: --phrase "RESIZE droplet to ${target}"`),
      );
      process.exit(2);
    }
    await _infraDispatch(
      'infrastructure_resize',
      { target_size_slug: target },
      options,
      `Resizing droplet to ${target}...`,
    );
  });

// solid infra scale-workers <delta>
infraCommand
  .command('scale-workers <delta>')
  .description(
    'Adjust Celery worker count by <delta> (positive or negative). IRREVERSIBLE.',
  )
  .option('--confirm', 'Required: actually scale workers')
  .option(
    '--phrase <phrase>',
    'Typed phrase. Must equal "SCALE celery workers by <+N | -N>" (case-insensitive).',
  )
  .option('--json', 'Output as JSON')
  .action(async (delta: string, options) => {
    const n = Number(delta);
    if (!Number.isInteger(n) || n === 0) {
      console.error(chalk.red(`Invalid delta ${delta}. Must be a non-zero integer.`));
      process.exit(2);
    }
    if (!options.confirm) {
      console.error(chalk.red('Refusing to scale workers without --confirm.'));
      process.exit(2);
    }
    const sign = n > 0 ? '+' : '';
    if (!options.phrase) {
      console.error(
        chalk.red(`Missing --phrase. Pass: --phrase "SCALE celery workers by ${sign}${n}"`),
      );
      process.exit(2);
    }
    await _infraDispatch(
      'infrastructure_scale_workers',
      { delta_workers: n },
      options,
      `Scaling celery workers by ${sign}${n}...`,
    );
  });
