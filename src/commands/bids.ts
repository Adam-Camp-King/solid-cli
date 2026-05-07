/**
 * Bids commands for Solid CLI.
 *
 * Wraps the `/api/v1/bids/` REST surface so AI agents (and humans) can
 * drive the photo → AI-drafted bid pipeline from the terminal:
 *
 *   solid bids list [--status ready] [--limit 50] [--json]
 *   solid bids show <id> [--json]
 *   solid bids upload <file...> [--note "..."] [--contact <id>]
 *   solid bids approve <id>
 *   solid bids reject <id> [--reason "..."]
 *   solid bids reanalyze <id>
 *
 * JSON-first per CLI contract — every subcommand exits with structured
 * output when `--json` (or program-wide `--output-file`) is set.
 */

import { Command } from 'commander';
import * as fs from 'fs';
import * as path from 'path';

import FormData from 'form-data';
import chalk from 'chalk';
import ora from 'ora';

import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fmtMoney(n: number | string | null | undefined): string {
  if (n === null || n === undefined) return '—';
  const num = typeof n === 'string' ? parseFloat(n) : n;
  if (Number.isNaN(num)) return '—';
  return `$${num.toFixed(2)}`;
}

const STATUS_COLOR: Record<string, (s: string) => string> = {
  pending: chalk.gray,
  analyzing: chalk.yellow,
  ready: chalk.green,
  finalized: chalk.blue,
  rejected: chalk.gray,
  failed: chalk.red,
};

export const bidsCommand = new Command('bids')
  .description('AI-drafted bids from photos (intake → analyze → approve)');

// ── list ──────────────────────────────────────────────────────────────────
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = bidsCommand
    .command('list')
    .alias('ls')
    .description('List bid intakes (newest first)')
    .option('--status <status...>', 'Filter by status (pending, analyzing, ready, finalized, rejected, failed)');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags & { status?: string[] }) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading bid inbox...',
      errorText: 'Failed to load bid inbox',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit };
        if (opts.status && opts.status.length) params.statuses = opts.status;
        const r = await apiClient.get('/api/v1/bids/intakes', { params });
        // Endpoint returns a bare list — wrap it so command-kit handles it.
        return Array.isArray(r.data) ? { items: r.data } : r.data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.items || []) as Array<Record<string, unknown>>);
      },
      render: (rows) => {
        if (!rows.length) {
          console.log(chalk.dim('  No bid intakes found.'));
          return;
        }
        console.log('');
        for (const r of rows) {
          const status = String(r.status || 'pending');
          const c = STATUS_COLOR[status] || chalk.white;
          const conf = r.confidence_score !== null && r.confidence_score !== undefined
            ? `${Math.round(Number(r.confidence_score) * 100)}%`
            : '—';
          const summary = (r.scene_summary as string | null) || (r.customer_message as string | null) || chalk.dim('(awaiting analysis)');
          const id = chalk.bold(`#${String(r.id)}`);
          console.log(`  ${id}  ${c(status.padEnd(10))}  conf:${conf.padEnd(5)}  src:${String(r.source).padEnd(6)}  ${String(summary).slice(0, 80)}`);
        }
      },
    });
  });
}

// ── show ──────────────────────────────────────────────────────────────────
bidsCommand
  .command('show <id>')
  .description('Show a single bid intake with photos + draft proposal')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    requireAuth();
    const spinner = ora(`Loading bid #${id}...`).start();
    try {
      const r = await apiClient.get(`/api/v1/bids/intakes/${id}`);
      const intake = r.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(intake, null, 2));
        return;
      }

      const status = String(intake.status || 'pending');
      const c = STATUS_COLOR[status] || chalk.white;
      spinner.succeed(chalk.green(`Bid #${intake.id} — ${c(status)}`));
      console.log('');
      console.log(`  ${chalk.bold('Source:')}      ${intake.source}`);
      if (intake.confidence_score !== null && intake.confidence_score !== undefined) {
        console.log(`  ${chalk.bold('Confidence:')}  ${Math.round(intake.confidence_score * 100)}%`);
      }
      if (intake.scene_summary) {
        console.log(`  ${chalk.bold('Scene:')}       ${intake.scene_summary}`);
      }
      if (intake.customer_message) {
        console.log(`  ${chalk.bold('Customer:')}    "${intake.customer_message}"`);
      }
      if (intake.warnings && intake.warnings.length > 0) {
        console.log('');
        console.log(`  ${chalk.bold('Warnings:')}`);
        for (const w of intake.warnings) console.log(`    • ${chalk.yellow(w)}`);
      }
      if (intake.media && intake.media.length > 0) {
        console.log('');
        console.log(`  ${chalk.bold('Photos:')}`);
        for (const m of intake.media) {
          console.log(`    • doc#${m.document_id} ${m.filename} (${m.mime_type || 'image'})`);
        }
      }
      if (intake.proposal) {
        const p = intake.proposal;
        console.log('');
        console.log(`  ${chalk.bold('Draft Bid:')}   ${p.document_number || '#' + p.id} — ${chalk.dim(p.status)}`);
        if (p.title) console.log(`    ${p.title}`);
        if (p.items && p.items.length > 0) {
          for (const it of p.items) {
            const total = fmtMoney(it.total_price);
            console.log(`      ${chalk.dim('•')} ${it.name} — ${it.quantity} ${it.unit || ''} × ${fmtMoney(it.unit_price)} = ${chalk.green(total)}`);
          }
        }
        if (p.total_amount !== null && p.total_amount !== undefined) {
          console.log(`    ${chalk.bold('Total:')} ${chalk.green(fmtMoney(p.total_amount))}`);
        }
      }
      if (intake.error_message) {
        console.log('');
        console.log(chalk.red(`  Error: ${intake.error_message}`));
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed to load bid #${id}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

// ── upload ────────────────────────────────────────────────────────────────
bidsCommand
  .command('upload <files...>')
  .description('Upload one or more photos for AI analysis (max 5, 10 MB each)')
  .option('--note <text>', 'Customer note / context for the bid')
  .option('--contact <id>', 'Link to a CRM contact')
  .option('--json', 'Output as JSON')
  .action(async (files: string[], options) => {
    requireAuth();
    if (files.length === 0) {
      console.error(chalk.red('Provide at least one photo path.'));
      process.exit(1);
    }
    if (files.length > 5) {
      console.error(chalk.red('Max 5 photos per intake.'));
      process.exit(1);
    }
    for (const f of files) {
      if (!fs.existsSync(f)) {
        console.error(chalk.red(`File not found: ${f}`));
        process.exit(1);
      }
      const sizeMB = fs.statSync(f).size / 1024 / 1024;
      if (sizeMB > 10) {
        console.error(chalk.red(`${f} is ${sizeMB.toFixed(1)} MB — over the 10 MB cap.`));
        process.exit(1);
      }
    }

    const spinner = ora(`Uploading ${files.length} photo${files.length === 1 ? '' : 's'}...`).start();
    try {
      const fd = new FormData();
      for (const f of files) {
        fd.append('files', fs.createReadStream(f), { filename: path.basename(f) });
      }
      if (options.note) fd.append('customer_message', options.note);
      if (options.contact) fd.append('contact_id', String(options.contact));

      // apiClient.post takes 2 args; FormData headers are auto-set by axios
      // through its multipart adapter. Body is ≤ 50 MB (5 × 10 MB caps),
      // well within axios's default ceiling.
      const r = await apiClient.post('/api/v1/bids/intake/web', fd);
      const intake = r.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(intake, null, 2));
        return;
      }

      spinner.succeed(chalk.green(`Bid intake #${intake.id} created — AI analyzing now`));
      console.log('');
      console.log(chalk.dim(`  Run \`solid bids show ${intake.id}\` in ~10s to see the draft.`));
    } catch (error) {
      spinner.fail(chalk.red('Upload failed'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

// ── approve / reject / reanalyze ─────────────────────────────────────────

function makeStateChange(verb: 'approve' | 'reject' | 'reanalyze') {
  const path =
    verb === 'approve'
      ? '/api/v1/bids/intakes/:id/finalize'
      : verb === 'reject'
      ? '/api/v1/bids/intakes/:id/reject'
      : '/api/v1/bids/intakes/:id/reanalyze';
  const cmd = bidsCommand
    .command(`${verb} <id>`)
    .description(
      verb === 'approve'
        ? 'Approve the AI draft (intake → finalized; send via Proposals UI)'
        : verb === 'reject'
        ? 'Discard a bid intake'
        : 'Re-run the vision LLM on a bid intake',
    )
    .option('--json', 'Output as JSON');
  if (verb === 'reject') cmd.option('--reason <text>', 'Rejection reason');
  cmd.action(async (id: string, options: { reason?: string; json?: boolean }) => {
    requireAuth();
    const spinner = ora(`${verb}ing bid #${id}...`).start();
    try {
      const body: Record<string, unknown> = {};
      if (verb === 'reject' && options.reason) body.reason = options.reason;
      const r = await apiClient.post(path.replace(':id', id), body);
      const intake = r.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(intake, null, 2));
        return;
      }

      const c = STATUS_COLOR[String(intake.status)] || chalk.white;
      spinner.succeed(chalk.green(`Bid #${id} → ${c(intake.status)}`));
      if (verb === 'approve') {
        console.log(chalk.dim('  Open Proposals to send: /dashboard/crm/proposals/' + (intake.proposal_id ?? '?')));
      }
    } catch (error) {
      spinner.fail(chalk.red(`Failed to ${verb} bid #${id}`));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });
}

makeStateChange('approve');
makeStateChange('reject');
makeStateChange('reanalyze');
