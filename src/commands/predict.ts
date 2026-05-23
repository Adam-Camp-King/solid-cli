/**
 * Predict commands for Solid CLI.
 *
 * Surfaces the predict-and-act platform to the terminal so AI agents
 * (and humans) can drive predictions from a one-liner:
 *
 *   solid predict deal-close <deal_id> [--json]
 *   solid predict no-show <appointment_id> [--json]
 *   solid predict payment-late <invoice_id> [--json]
 *   solid predict targets [--status proposed] [--json]
 *   solid predict approve <target_id>
 *   solid predict reject <target_id> [--reason "..."]
 *   solid predict discover                  # trigger Devon's sweep on demand
 *
 * Mirrors mcp/tools/predictions_tools.py — same surface, two interfaces.
 *
 * See: Owners-Manual/74-Predict-And-Act/
 */
import { Command } from 'commander';

import chalk from 'chalk';
import ora from 'ora';

import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

const TIER_COLOR: Record<string, (s: string) => string> = {
  hot: chalk.green.bold,
  warm: chalk.yellow.bold,
  cold: chalk.gray,
  high: chalk.red.bold,
  medium: chalk.yellow.bold,
  low: chalk.green,
  unknown: chalk.cyan,
};

function renderPrediction(label: string, recordId: string, p: Record<string, any>, options: any) {
  if (isJsonOutput(options)) {
    console.log(JSON.stringify(p, null, 2));
    return;
  }
  const tier = String(p.tier ?? 'unknown');
  const c = TIER_COLOR[tier] || chalk.white;
  const pct = p.probability != null ? `${Math.round(Number(p.probability) * 100)}%` : '—';
  const conf = p.confidence != null ? `${Math.round(Number(p.confidence) * 100)}%` : '—';
  console.log('');
  console.log(`  ${chalk.bold(label)}: #${recordId}`);
  console.log(`  ${chalk.bold('Tier:')}        ${c(tier.toUpperCase())}`);
  console.log(`  ${chalk.bold('Probability:')} ${pct}`);
  console.log(`  ${chalk.bold('Confidence:')}  ${conf}`);
  console.log(`  ${chalk.bold('Trained on:')}  ${p.n_train_rows ?? 0} labelled rows`);
  if (p.top_features && p.top_features.length) {
    console.log(`  ${chalk.bold('Top features:')}`);
    for (const f of p.top_features.slice(0, 3)) {
      const w = typeof f.weight === 'number' ? f.weight.toFixed(3) : '?';
      console.log(`    • ${f.name} (weight ${w})`);
    }
  }
  if (p.recommendation) {
    console.log(`  ${chalk.bold('Recommendation:')}`);
    console.log(`    ${chalk.cyan(p.recommendation)}`);
  }
  if (p.notes) {
    console.log(`  ${chalk.dim('Note: ' + p.notes)}`);
  }
  console.log('');
}

export const predictCommand = new Command('predict')
  .description('AI predictions — deal close, no-show, payment-late, Devon-discovered targets');

// ── deal-close ────────────────────────────────────────────────────────────
predictCommand
  .command('deal-close <deal_id>')
  .description('Predict the probability a deal closes (won)')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, options) => {
    requireAuth();
    const spinner = ora(`Predicting deal-close for #${dealId}...`).start();
    try {
      const r = await apiClient.get(`/api/v1/predictions/deal-close/${dealId}`);
      spinner.stop();
      renderPrediction('Deal', dealId, r.data as Record<string, any>, options);
    } catch (e) {
      spinner.fail('Prediction failed');
      failApi(e);
    }
  });

// ── no-show ───────────────────────────────────────────────────────────────
predictCommand
  .command('no-show <appointment_id>')
  .description('Predict the probability an appointment is a no-show')
  .option('--json', 'Output as JSON')
  .action(async (apptId: string, options) => {
    requireAuth();
    const spinner = ora(`Predicting no-show for appointment #${apptId}...`).start();
    try {
      const r = await apiClient.get(`/api/v1/predictions/no-show/${apptId}`);
      spinner.stop();
      renderPrediction('Appointment', apptId, r.data as Record<string, any>, options);
    } catch (e) {
      spinner.fail('Prediction failed');
      failApi(e);
    }
  });

// ── payment-late ──────────────────────────────────────────────────────────
predictCommand
  .command('payment-late <invoice_id>')
  .description('Predict the probability an invoice is paid late')
  .option('--json', 'Output as JSON')
  .action(async (invoiceId: string, options) => {
    requireAuth();
    const spinner = ora(`Predicting payment-late for invoice #${invoiceId}...`).start();
    try {
      const r = await apiClient.get(`/api/v1/predictions/payment-late/${invoiceId}`);
      spinner.stop();
      renderPrediction('Invoice', invoiceId, r.data as Record<string, any>, options);
    } catch (e) {
      spinner.fail('Prediction failed');
      failApi(e);
    }
  });

// ── targets list ──────────────────────────────────────────────────────────
predictCommand
  .command('targets')
  .description("List Devon-discovered predict targets (proposed + approved)")
  .option('--status <status>', 'Filter by status (proposed, approved, rejected)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading predict targets...').start();
    try {
      const url = options.status
        ? `/api/v1/predictions/targets?status_filter=${encodeURIComponent(options.status)}`
        : '/api/v1/predictions/targets';
      const r = await apiClient.get(url);
      spinner.stop();
      const rows = Array.isArray(r.data) ? r.data : ((r.data as Record<string, any>)?.targets || []);
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(rows, null, 2));
        return;
      }
      if (!rows.length) {
        console.log(chalk.dim('  No predict targets yet. Devon proposes new ones on its nightly sweep.'));
        return;
      }
      console.log('');
      for (const t of rows) {
        const status = String(t.status || 'proposed');
        const c =
          status === 'approved'
            ? chalk.green.bold
            : status === 'proposed'
              ? chalk.cyan
              : status === 'rejected'
                ? chalk.gray
                : chalk.white;
        const acc = t.proposed_accuracy != null
          ? `${Math.round(Number(t.proposed_accuracy) * 100)}%`
          : '—';
        console.log(`  ${chalk.bold('#' + t.id)} ${c(status.padEnd(9))} acc:${acc.padEnd(5)} ${chalk.bold(t.target_name)}`);
        if (t.description) console.log(`     ${chalk.dim(t.description)}`);
      }
      console.log('');
    } catch (e) {
      spinner.fail('Failed to load targets');
      failApi(e);
    }
  });

// ── targets approve ───────────────────────────────────────────────────────
predictCommand
  .command('approve <target_id>')
  .description('Approve a Devon-proposed predict target')
  .option('--json', 'Output as JSON')
  .action(async (targetId: string, options) => {
    requireAuth();
    const spinner = ora(`Approving target #${targetId}...`).start();
    try {
      const r = await apiClient.post(`/api/v1/predictions/targets/${targetId}/decide`, {
        approve: true,
      });
      spinner.succeed(chalk.green(`Target #${targetId} approved.`));
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(r.data, null, 2));
      }
    } catch (e) {
      spinner.fail('Approval failed');
      failApi(e);
    }
  });

// ── targets reject ────────────────────────────────────────────────────────
predictCommand
  .command('reject <target_id>')
  .description("Reject a Devon-proposed predict target")
  .option('--reason <reason>', 'Reason for rejection (audit trail)')
  .option('--json', 'Output as JSON')
  .action(async (targetId: string, options) => {
    requireAuth();
    const spinner = ora(`Rejecting target #${targetId}...`).start();
    try {
      const r = await apiClient.post(`/api/v1/predictions/targets/${targetId}/decide`, {
        approve: false,
        rejection_reason: options.reason || null,
      });
      spinner.succeed(chalk.gray(`Target #${targetId} rejected.`));
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(r.data, null, 2));
      }
    } catch (e) {
      spinner.fail('Rejection failed');
      failApi(e);
    }
  });

// ── discover (trigger Devon's sweep on demand) ──────────────────────────
predictCommand
  .command('discover')
  .description("Trigger Devon's nightly prediction-target discovery sweep on demand")
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora("Running Devon's target discovery sweep...").start();
    try {
      const r = await apiClient.post('/api/v1/predictions/discovery/run');
      spinner.succeed(chalk.green('Discovery sweep complete'));
      const data = r.data as Record<string, unknown>;
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      const proposed = (data.proposed_count ?? data.new_targets ?? 0) as number;
      const scanned = (data.tables_scanned ?? 0) as number;
      console.log(`  Tables scanned: ${scanned}`);
      console.log(`  New targets proposed: ${chalk.cyan(String(proposed))}`);
      if (proposed > 0) {
        console.log(chalk.dim('  Review with: solid predict targets --status proposed'));
      }
    } catch (e) {
      spinner.fail('Discovery sweep failed');
      failApi(e);
    }
  });
