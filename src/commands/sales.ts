/**
 * Sales Agent CLI — Phase 1 read-only verbs.
 *
 * Wraps existing CRM endpoints into a sales-focused surface for AI agents.
 * Same verbs, different context per industry — the KB provides differentiation.
 *
 * Endpoints composed:
 *   GET /api/v1/crm/pipeline/summary
 *   GET /api/v1/crm/leads/stats
 *   GET /api/v1/crm/leads/pipeline-sources
 *   GET /api/v1/crm/dashboard/revenue/summary
 *   GET /api/v1/crm/dashboard/summary
 *   GET /api/v1/crm/sales-funnel
 *   GET /api/v1/crm/tasks
 *   GET /api/v1/crm/lead-scoring/high-value-contacts
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { ui } from '../lib/ui';
import { requireAuth } from '../lib/command-kit';

type Rec = Record<string, unknown>;

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown): void {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
  process.exit(1);
}

function dollars(cents: unknown): string {
  const n = Number(cents);
  if (!Number.isFinite(n)) return '$0';
  return `$${(n / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function dollarsDirect(val: unknown): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return '$0';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

function pct(val: unknown): string {
  const n = Number(val);
  if (!Number.isFinite(n)) return '0%';
  return `${n.toFixed(1)}%`;
}

function unwrapDispatch(data: Rec): Rec {
  if (data.ok === false) {
    const err = (data.error || {}) as Rec;
    throw new Error(String(err.message || err.reason || 'Dispatch failed'));
  }
  return (data.result || data) as Rec;
}

export const salesCommand = new Command('sales')
  .description('Sales pipeline, forecasting, and growth intelligence');

// ── pipeline ────────────────────────────────────────────────────────

salesCommand
  .command('pipeline')
  .description('Full pipeline view: stages, values, velocity')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading pipeline...', stream: process.stderr }).start();
    try {
      const res = await apiClient.get('/api/v1/crm/pipeline/summary');
      spinner.stop();
      const data = res.data as Rec;
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.header('Sales Pipeline'));
      const stages = (data.stages || []) as Rec[];
      if (stages.length) {
        console.log(ui.table(
          ['Stage', 'Deals', 'Value'],
          stages.map((s) => [
            String(s.stage || s.name || '—'),
            String(s.count ?? 0),
            dollarsDirect(s.value ?? 0),
          ]),
        ));
      }
      console.log('');
      console.log(ui.label('Total deals', String(data.total_deals ?? '—')));
      console.log(ui.label('Pipeline value', dollarsDirect(data.total_pipeline_value ?? 0)));
      console.log(ui.label('Won value', dollarsDirect(data.won_value ?? 0)));
      console.log(ui.label('Conversion rate', pct(data.conversion_rate)));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load pipeline', e); }
  });

// ── prospects ───────────────────────────────────────────────────────

salesCommand
  .command('prospects')
  .description('Unqualified leads ready for outreach, ranked by score')
  .option('-l, --limit <n>', 'Max results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading prospects...', stream: process.stderr }).start();
    try {
      const [statsRes, highValueRes] = await Promise.all([
        apiClient.get('/api/v1/crm/leads/stats'),
        apiClient.get('/api/v1/crm/lead-scoring/high-value-contacts', {
          params: { limit: parseInt(opts.limit, 10) },
        }),
      ]);
      spinner.stop();

      const stats = statsRes.data as Rec;
      const contacts = ((highValueRes.data as Rec).high_value_contacts || []) as Rec[];

      if (isJsonOutput(opts)) {
        console.log(JSON.stringify({ stats, prospects: contacts }, null, 2));
        return;
      }

      console.log(ui.header('Prospects'));
      console.log(ui.label('Total leads', String(stats.total_leads ?? '—')));
      console.log(ui.label('Conversion rate', pct(stats.conversion_rate)));
      console.log(ui.label('Avg score', String(stats.average_score ?? '—')));
      console.log('');

      if (contacts.length) {
        console.log(ui.table(
          ['ID', 'Name', 'Score', 'Grade', 'Source', 'Spent'],
          contacts.map((c) => [
            String(c.id),
            [c.first_name, c.last_name].filter(Boolean).join(' ') || chalk.dim('—'),
            String(c.lead_score ?? '—'),
            String(c.lead_grade ?? '—'),
            String(c.source || chalk.dim('—')),
            dollarsDirect(c.total_spent ?? 0),
          ]),
        ));
      } else {
        console.log(chalk.yellow('  No high-value prospects found.'));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load prospects', e); }
  });

// ── sources ─────────────────────────────────────────────────────────

salesCommand
  .command('sources')
  .description('Lead funnel performance — which sources convert best')
  .option('--days <n>', 'Lookback period in days', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading lead sources...', stream: process.stderr }).start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/pipeline-sources', {
        params: { days: parseInt(opts.days, 10) },
      });
      spinner.stop();
      const data = res.data as Rec;
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.header(`Lead Sources (last ${opts.days} days)`));
      const sources = (data.sources || []) as Rec[];
      if (sources.length) {
        console.log(ui.table(
          ['Source', 'Leads', 'Deals', 'Won', 'Conv %', 'Avg Score'],
          sources.map((s) => [
            String(s.source || '—'),
            String(s.leads ?? 0),
            String(s.deals ?? 0),
            String(s.won ?? 0),
            pct(s.conversion_rate),
            String(s.avg_score ?? '—'),
          ]),
        ));
      } else {
        console.log(chalk.yellow('  No source data available for this period.'));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load lead sources', e); }
  });

// ── forecast ────────────────────────────────────────────────────────

salesCommand
  .command('forecast')
  .description('Revenue forecast by stage and probability')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading forecast...', stream: process.stderr }).start();
    try {
      const [revenueRes, pipelineRes] = await Promise.all([
        apiClient.get('/api/v1/crm/dashboard/revenue/summary'),
        apiClient.get('/api/v1/crm/pipeline/summary'),
      ]);
      spinner.stop();

      const revenue = revenueRes.data as Rec;
      const pipeline = pipelineRes.data as Rec;

      if (isJsonOutput(opts)) {
        console.log(JSON.stringify({ revenue, pipeline }, null, 2));
        return;
      }

      console.log(ui.header('Revenue Forecast'));
      console.log(ui.label('Total revenue', dollarsDirect(revenue.total_revenue ?? 0)));
      console.log(ui.label('Monthly revenue', dollarsDirect(revenue.monthly_revenue ?? 0)));
      console.log(ui.label('YTD revenue', dollarsDirect(revenue.ytd_revenue ?? 0)));
      console.log(ui.label('Avg deal value', dollarsDirect(revenue.average_deal_value ?? 0)));
      console.log('');

      const stages = (pipeline.stages || []) as Rec[];
      if (stages.length) {
        console.log(ui.divider('Pipeline by Stage'));
        console.log(ui.table(
          ['Stage', 'Deals', 'Value', 'Weighted'],
          stages.map((s) => {
            const value = Number(s.value ?? s.total_value ?? 0);
            const prob = Number(s.probability ?? s.conversion_rate ?? 0) / 100;
            return [
              String(s.name || s.stage || '—'),
              String(s.count ?? s.deals ?? 0),
              dollarsDirect(value),
              dollarsDirect(value * (Number.isFinite(prob) ? prob : 0)),
            ];
          }),
        ));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load forecast', e); }
  });

// ── report ──────────────────────────────────────────────────────────

salesCommand
  .command('report [period]')
  .description('Sales performance report (default: this month)')
  .option('--json', 'Output as JSON')
  .action(async (period: string | undefined, opts) => {
    requireAuth();
    const p = period || 'mtd';
    const spinner = ora({ text: `Loading ${p} report...`, stream: process.stderr }).start();
    try {
      const [summaryRes, leadsRes, customersRes] = await Promise.all([
        apiClient.get('/api/v1/crm/dashboard/summary'),
        apiClient.get('/api/v1/crm/dashboard/leads/overview', { params: { period: p } }),
        apiClient.get('/api/v1/crm/dashboard/customers/summary'),
      ]);
      spinner.stop();

      const summary = summaryRes.data as Rec;
      const leads = leadsRes.data as Rec;
      const customers = customersRes.data as Rec;

      if (isJsonOutput(opts)) {
        console.log(JSON.stringify({ period: p, summary, leads, customers }, null, 2));
        return;
      }

      console.log(ui.header(`Sales Report — ${p.toUpperCase()}`));

      console.log(ui.divider('Revenue'));
      console.log(ui.label('Total revenue', dollarsDirect(summary.revenue ?? summary.total_revenue ?? 0)));
      console.log(ui.label('Total deals', String(summary.deals ?? summary.total_deals ?? 0)));
      console.log('');

      console.log(ui.divider('Leads'));
      console.log(ui.label('New leads (period)', String(leads.mtd_leads ?? leads.new_leads ?? 0)));
      console.log(ui.label('Conversion rate', pct(leads.conversion_rate)));
      console.log(ui.label('Avg deal value', dollarsDirect(leads.avg_deal_value ?? 0)));
      console.log('');

      console.log(ui.divider('Customers'));
      console.log(ui.label('Total customers', String(customers.total_customers ?? 0)));
      console.log(ui.label('New this month', String(customers.new_customers_mtd ?? 0)));
      console.log(ui.label('Repeat rate', pct(customers.repeat_rate)));
      console.log(ui.label('Churn rate', pct(customers.churn_rate)));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load sales report', e); }
  });

// ── velocity ────────────────────────────────────────────────────────

salesCommand
  .command('velocity')
  .description('Deal velocity metrics — how fast deals move through stages')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading velocity...', stream: process.stderr }).start();
    try {
      const res = await apiClient.get('/api/v1/crm/sales-funnel');
      spinner.stop();
      const data = res.data as Rec;
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.header('Deal Velocity'));
      const stages = (data.stages || []) as Rec[];
      if (stages.length) {
        console.log(ui.table(
          ['Stage', 'Count', 'Conv from Prev'],
          stages.map((s) => [
            String(s.stage || '—'),
            String(s.count ?? 0),
            s.conversion_from_previous != null ? pct(s.conversion_from_previous) : chalk.dim('—'),
          ]),
        ));
      }
      console.log('');
      if (data.lost_count != null) {
        console.log(ui.label('Lost deals', String(data.lost_count)));
      }
      if (data.total_deals != null) {
        console.log(ui.label('Total deals (excl. lost)', String(data.total_deals)));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load velocity', e); }
  });

// ── followup ────────────────────────────────────────────────────────

salesCommand
  .command('followup')
  .alias('follow-up')
  .description('Overdue follow-ups ranked by priority')
  .option('-l, --limit <n>', 'Max results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading follow-ups...', stream: process.stderr }).start();
    try {
      const res = await apiClient.get('/api/v1/crm/tasks', {
        params: {
          status: 'pending',
          limit: parseInt(opts.limit, 10),
          offset: 0,
        },
      });
      spinner.stop();

      const data = res.data as Rec;
      const tasks = (data.tasks || data.items || []) as Rec[];

      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.header('Overdue Follow-ups'));
      if (tasks.length) {
        const now = Date.now();
        const overdue = tasks.filter((t) => {
          const due = t.due_date ? new Date(String(t.due_date)).getTime() : Infinity;
          return due <= now;
        });
        const upcoming = tasks.filter((t) => {
          const due = t.due_date ? new Date(String(t.due_date)).getTime() : Infinity;
          return due > now;
        });

        if (overdue.length) {
          console.log(chalk.red(`  ${overdue.length} overdue`));
          console.log(ui.table(
            ['ID', 'Title', 'Due', 'Priority', 'Contact'],
            overdue.map((t) => [
              String(t.id),
              String(t.title || '—'),
              t.due_date ? String(t.due_date).split('T')[0] : chalk.dim('—'),
              String(t.priority || chalk.dim('normal')),
              String(t.contact_name || t.contact_id || chalk.dim('—')),
            ]),
          ));
          console.log('');
        }

        if (upcoming.length) {
          console.log(chalk.green(`  ${upcoming.length} upcoming`));
          console.log(ui.table(
            ['ID', 'Title', 'Due', 'Priority', 'Contact'],
            upcoming.map((t) => [
              String(t.id),
              String(t.title || '—'),
              t.due_date ? String(t.due_date).split('T')[0] : chalk.dim('—'),
              String(t.priority || chalk.dim('normal')),
              String(t.contact_name || t.contact_id || chalk.dim('—')),
            ]),
          ));
        }
      } else {
        console.log(chalk.green('  No pending follow-ups. Pipeline is clean.'));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load follow-ups', e); }
  });

// ── win-rate ────────────────────────────────────────────────────────

salesCommand
  .command('win-rate')
  .description('Win/loss analysis by source and stage')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Loading win rate...', stream: process.stderr }).start();
    try {
      const [funnelRes, tierRes] = await Promise.all([
        apiClient.get('/api/v1/crm/sales-funnel'),
        apiClient.get('/api/v1/crm/lead-scoring/tier-breakdown'),
      ]);
      spinner.stop();

      const funnel = funnelRes.data as Rec;
      const tiers = tierRes.data as Rec;

      if (isJsonOutput(opts)) {
        console.log(JSON.stringify({ funnel, tiers }, null, 2));
        return;
      }

      console.log(ui.header('Win Rate Analysis'));

      const stages = (funnel.stages || []) as Rec[];
      if (stages.length) {
        console.log(ui.divider('Funnel'));
        console.log(ui.table(
          ['Stage', 'Count', 'Conv from Prev'],
          stages.map((s) => [
            String(s.stage || '—'),
            String(s.count ?? 0),
            s.conversion_from_previous != null ? pct(s.conversion_from_previous) : chalk.dim('—'),
          ]),
        ));
        console.log('');
      }

      console.log(ui.divider('Lead Score Distribution'));
      console.log(ui.label('A-grade', String(tiers.A ?? tiers.a ?? 0)));
      console.log(ui.label('B-grade', String(tiers.B ?? tiers.b ?? 0)));
      console.log(ui.label('C-grade', String(tiers.C ?? tiers.c ?? 0)));
      console.log(ui.label('D-grade', String(tiers.D ?? tiers.d ?? 0)));
      console.log(ui.label('F-grade', String(tiers.F ?? tiers.f ?? 0)));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to load win rate', e); }
  });

// ═══════════════════════════════════════════════════════════════════
// Phase 2 — AI-powered suggest verbs
// ═══════════════════════════════════════════════════════════════════

// ── score ───────────────────────────────────────────────────────────

salesCommand
  .command('score <lead_id>')
  .description('AI-score a lead with industry-specific reasoning')
  .option('--json', 'Output as JSON')
  .action(async (leadId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: 'Scoring lead...', stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.score',
        args: { lead_id: parseInt(leadId, 10) },
      });
      spinner.stop();
      const data = unwrapDispatch(res.data as Rec);
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const suggestions = (data.suggestions || []) as Rec[];
      const s = suggestions[0] || {};
      const lead = (s.lead || {}) as Rec;

      console.log(ui.header(`Lead Score — ${lead.name || `#${leadId}`}`));
      console.log(ui.label('Score', `${s.ai_score ?? '—'}/100`));
      console.log(ui.label('Grade', String(s.ai_grade ?? '—')));
      console.log(ui.label('Confidence', `${data.confidence_band || '—'} (${((Number(data.confidence) || 0) * 100).toFixed(0)}%)`));
      console.log('');
      if (s.reasoning) console.log(`  ${chalk.dim(String(s.reasoning))}`);
      console.log('');

      const signals = (s.signals || []) as string[];
      if (signals.length) {
        console.log(ui.divider('Signals'));
        for (const sig of signals) console.log(`  ${chalk.green('+')} ${sig}`);
        console.log('');
      }
      const risks = (s.risks || []) as string[];
      if (risks.length) {
        console.log(ui.divider('Risks'));
        for (const r of risks) console.log(`  ${chalk.red('−')} ${r}`);
        console.log('');
      }
      if (s.recommended_action) {
        console.log(ui.divider('Next Action'));
        console.log(`  ${chalk.cyan('→')} ${s.recommended_action}`);
        console.log('');
      }
    } catch (e) { fail(spinner, 'Failed to score lead', e); }
  });

// ── suggest ─────────────────────────────────────────────────────────

salesCommand
  .command('suggest <deal_id>')
  .description('AI next-best-action for a deal')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: 'Analyzing deal...', stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.suggest',
        args: { deal_id: parseInt(dealId, 10) },
      });
      spinner.stop();
      const data = unwrapDispatch(res.data as Rec);
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const evidence = (data.evidence || {}) as Rec;
      const deal = (evidence.deal || {}) as Rec;

      console.log(ui.header(`Deal Suggestions — ${deal.title || `#${dealId}`}`));
      if (evidence.deal_health) console.log(ui.label('Health', String(evidence.deal_health)));
      if (evidence.insight) console.log(ui.label('Insight', String(evidence.insight)));
      console.log(ui.label('Confidence', `${data.confidence_band || '—'} (${((Number(data.confidence) || 0) * 100).toFixed(0)}%)`));
      console.log('');

      const suggestions = (data.suggestions || []) as Rec[];
      if (suggestions.length) {
        for (let i = 0; i < suggestions.length; i++) {
          const s = suggestions[i];
          const pri = String(s.priority || 'medium');
          const badge = pri === 'high' ? chalk.red('[HIGH]') : pri === 'low' ? chalk.dim('[LOW]') : chalk.yellow('[MED]');
          console.log(`  ${i + 1}. ${badge} ${s.action}`);
          if (s.reasoning) console.log(`     ${chalk.dim(String(s.reasoning))}`);
        }
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to get suggestions', e); }
  });

// ── outreach ────────────────────────────────────────────────────────

salesCommand
  .command('outreach <lead_id>')
  .description('Generate personalized outreach copy')
  .option('--channel <channel>', 'Channel: email, sms, call_script', 'email')
  .option('--json', 'Output as JSON')
  .action(async (leadId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: `Generating ${opts.channel} outreach...`, stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.outreach',
        args: { lead_id: parseInt(leadId, 10), channel: opts.channel },
      });
      spinner.stop();
      const data = unwrapDispatch(res.data as Rec);
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const suggestions = (data.suggestions || []) as Rec[];
      const s = suggestions[0] || {};
      const contact = (s.contact || {}) as Rec;

      console.log(ui.header(`Outreach — ${contact.name || `Lead #${leadId}`} (${s.channel || opts.channel})`));
      if (s.error) {
        console.log(chalk.yellow(`  ${s.error}`));
        console.log('');
        return;
      }
      if (s.subject) {
        console.log(ui.label('Subject', String(s.subject)));
        console.log('');
      }
      if (s.body) {
        console.log(String(s.body));
        console.log('');
      }
      if (s.cta) {
        console.log(ui.divider('CTA'));
        console.log(`  ${chalk.cyan(String(s.cta))}`);
        console.log('');
      }
      if (s.personalization_notes) {
        console.log(chalk.dim(`  Personalization: ${s.personalization_notes}`));
        console.log('');
      }
    } catch (e) { fail(spinner, 'Failed to generate outreach', e); }
  });

// ── opportunities ───────────────────────────────────────────────────

salesCommand
  .command('opportunities')
  .description('AI-identified growth opportunities')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Analyzing growth opportunities...', stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.opportunities',
        args: {},
      });
      spinner.stop();
      const data = unwrapDispatch(res.data as Rec);
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const evidence = (data.evidence || {}) as Rec;
      console.log(ui.header('Growth Opportunities'));
      if (evidence.health_score != null) console.log(ui.label('Health score', `${evidence.health_score}/100`));
      if (evidence.health_summary) console.log(ui.label('Summary', String(evidence.health_summary)));
      console.log(ui.label('Confidence', `${data.confidence_band || '—'} (${((Number(data.confidence) || 0) * 100).toFixed(0)}%)`));
      console.log('');

      const opps = (data.suggestions || []) as Rec[];
      for (let i = 0; i < opps.length; i++) {
        const o = opps[i];
        const impact = String(o.impact || 'medium');
        const effort = String(o.effort || 'medium');
        const badge = impact === 'high' ? chalk.green('HIGH IMPACT') : impact === 'low' ? chalk.dim('low impact') : chalk.yellow('med impact');
        console.log(`  ${i + 1}. ${chalk.bold(String(o.title))} ${chalk.dim(`[${badge}, ${effort} effort]`)}`);
        if (o.description) console.log(`     ${chalk.dim(String(o.description))}`);
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to analyze opportunities', e); }
  });

// ── compare ─────────────────────────────────────────────────────────

salesCommand
  .command('compare [period]')
  .description('Period-over-period comparison with AI analysis')
  .option('--json', 'Output as JSON')
  .action(async (period: string | undefined, opts) => {
    requireAuth();
    const p = period || 'mtd';
    const spinner = ora({ text: `Comparing ${p.toUpperCase()} periods...`, stream: process.stderr }).start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.compare',
        args: { period: p },
      });
      spinner.stop();
      const data = unwrapDispatch(res.data as Rec);
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const suggestions = (data.suggestions || []) as Rec[];
      const s = suggestions[0] || {};
      const current = (s.current || {}) as Rec;
      const previous = (s.previous || {}) as Rec;
      const deltas = (s.deltas || {}) as Rec;
      const analysis = (s.analysis || {}) as Rec;

      console.log(ui.header(`Sales Comparison — ${p.toUpperCase()}`));

      console.log(ui.table(
        ['Metric', 'Current', 'Previous', 'Change'],
        [
          ['Revenue', dollarsDirect(current.revenue ?? 0), dollarsDirect(previous.revenue ?? 0), deltas.revenue != null ? `${Number(deltas.revenue) > 0 ? '+' : ''}${deltas.revenue}%` : '—'],
          ['Deals created', String(current.deals_created ?? 0), String(previous.deals_created ?? 0), deltas.deals_created != null ? `${Number(deltas.deals_created) > 0 ? '+' : ''}${deltas.deals_created}%` : '—'],
          ['Deals won', String(current.deals_won ?? 0), String(previous.deals_won ?? 0), deltas.deals_won != null ? `${Number(deltas.deals_won) > 0 ? '+' : ''}${deltas.deals_won}%` : '—'],
          ['Win rate', pct(current.win_rate), pct(previous.win_rate), deltas.win_rate != null ? `${Number(deltas.win_rate) > 0 ? '+' : ''}${deltas.win_rate}%` : '—'],
          ['New leads', String(current.new_leads ?? 0), String(previous.new_leads ?? 0), deltas.new_leads != null ? `${Number(deltas.new_leads) > 0 ? '+' : ''}${deltas.new_leads}%` : '—'],
          ['Avg deal', dollarsDirect(current.avg_deal_value ?? 0), dollarsDirect(previous.avg_deal_value ?? 0), deltas.avg_deal_value != null ? `${Number(deltas.avg_deal_value) > 0 ? '+' : ''}${deltas.avg_deal_value}%` : '—'],
        ],
      ));
      console.log('');

      if (analysis.trend) console.log(ui.label('Trend', String(analysis.trend)));
      if (analysis.key_change) console.log(ui.label('Key change', String(analysis.key_change)));
      if (analysis.summary) {
        console.log('');
        console.log(`  ${chalk.dim(String(analysis.summary))}`);
      }
      if (analysis.recommendation) {
        console.log('');
        console.log(`  ${chalk.cyan('→')} ${analysis.recommendation}`);
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to compare periods', e); }
  });

// ═══════════════════════════════════════════════════════════════════
// Phase 3 — Write verbs (consent-gated)
// ═══════════════════════════════════════════════════════════════════

// ── qualify ─────────────────────────────────────────────────────────

salesCommand
  .command('qualify <lead_id>')
  .description('Promote a lead to a qualified deal')
  .option('--title <title>', 'Deal title (auto-generated if omitted)')
  .option('--value <amount>', 'Deal value in dollars')
  .option('--stage <stage>', 'Initial stage', 'Qualified')
  .option('--notes <notes>', 'Notes for the deal')
  .option('--yes', 'Confirm (required in agent mode)')
  .option('--json', 'Output as JSON')
  .action(async (leadId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: 'Qualifying lead...', stream: process.stderr }).start();
    try {
      const args: Rec = { lead_id: parseInt(leadId, 10), stage: opts.stage };
      if (opts.title) args.title = opts.title;
      if (opts.value) args.value = parseFloat(opts.value);
      if (opts.notes) args.notes = opts.notes;

      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.qualify', args, confirm: true,
      });
      const data = unwrapDispatch(res.data as Rec);
      spinner.succeed(chalk.green('Lead qualified'));
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.successBox('Deal Created', [
        `Deal ID: ${data.deal_id}`,
        `Title: ${data.title}`,
        `Stage: ${data.stage}`,
        `Contact: ${data.contact_name || `#${leadId}`}`,
        data.value ? `Value: $${data.value}` : '',
      ].filter(Boolean) as string[]));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to qualify lead', e); }
  });

// ── advance ─────────────────────────────────────────────────────────

salesCommand
  .command('advance <deal_id>')
  .description('Move a deal to the next pipeline stage')
  .option('--stage <stage>', 'Target stage (auto-advances if omitted)')
  .option('--notes <notes>', 'Notes')
  .option('--yes', 'Confirm (required in agent mode)')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: 'Advancing deal...', stream: process.stderr }).start();
    try {
      const args: Rec = { deal_id: parseInt(dealId, 10) };
      if (opts.stage) args.stage = opts.stage;
      if (opts.notes) args.notes = opts.notes;

      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.advance', args, confirm: true,
      });
      const data = unwrapDispatch(res.data as Rec);
      spinner.succeed(chalk.green('Deal advanced'));
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.successBox('Deal Advanced', [
        `Deal: ${data.title || `#${dealId}`}`,
        `${data.old_stage} → ${chalk.green(String(data.new_stage))}`,
      ]));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to advance deal', e); }
  });

// ── close ───────────────────────────────────────────────────────────

salesCommand
  .command('close <deal_id>')
  .description('Close a deal as won or lost')
  .option('--outcome <outcome>', 'won or lost', 'won')
  .option('--reason <reason>', 'Close reason')
  .option('--yes', 'Confirm (required in agent mode)')
  .option('--json', 'Output as JSON')
  .action(async (dealId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: 'Closing deal...', stream: process.stderr }).start();
    try {
      const args: Rec = { deal_id: parseInt(dealId, 10), outcome: opts.outcome };
      if (opts.reason) args.close_reason = opts.reason;

      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.close', args, confirm: true,
      });
      const data = unwrapDispatch(res.data as Rec);
      spinner.succeed(chalk.green(`Deal closed — ${data.outcome}`));
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      const color = String(data.outcome).toLowerCase() === 'won' ? chalk.green : chalk.red;
      console.log(ui.successBox('Deal Closed', [
        `Deal: ${data.title || `#${dealId}`}`,
        `Outcome: ${color(String(data.outcome))}`,
        data.amount ? `Value: $${data.amount}` : '',
      ].filter(Boolean) as string[]));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to close deal', e); }
  });

// ── nurture ─────────────────────────────────────────────────────────

salesCommand
  .command('nurture <lead_id>')
  .description('Send a nurture step to a contact')
  .option('--channel <channel>', 'email, sms, call_script, or voice', 'email')
  .option('--message <message>', 'Custom message')
  .option('--yes', 'Confirm (required in agent mode)')
  .option('--json', 'Output as JSON')
  .action(async (leadId: string, opts) => {
    requireAuth();
    const spinner = ora({ text: `Sending ${opts.channel} nurture...`, stream: process.stderr }).start();
    try {
      const args: Rec = { lead_id: parseInt(leadId, 10), channel: opts.channel };
      if (opts.message) args.message = opts.message;

      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.nurture', args, confirm: true,
      });
      const data = unwrapDispatch(res.data as Rec);
      spinner.succeed(chalk.green(`Nurture sent via ${data.channel}`));
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.successBox('Nurture Sent', [
        `Contact: ${data.contact_name || `#${leadId}`}`,
        `Channel: ${data.channel}`,
        `Follow-up task: #${data.followup_task_id} (due ${data.followup_due ? String(data.followup_due).split('T')[0] : '3 days'})`,
      ]));
      console.log('');
    } catch (e) { fail(spinner, 'Failed to nurture contact', e); }
  });

// ── sequence ────────────────────────────────────────────────────────

const sequenceCommand = new Command('sequence')
  .description('Multi-step outreach sequences');

sequenceCommand
  .command('create')
  .description('Create a multi-step outreach sequence')
  .requiredOption('--name <name>', 'Sequence name')
  .option('--leads <ids>', 'Comma-separated lead IDs')
  .option('--yes', 'Confirm (required in agent mode)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora({ text: 'Creating sequence...', stream: process.stderr }).start();
    try {
      const args: Rec = { name: opts.name };
      if (opts.leads) args.lead_ids = opts.leads.split(',').map((s: string) => parseInt(s.trim(), 10));

      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'sales.sequence_create', args, confirm: true,
      });
      const data = unwrapDispatch(res.data as Rec);
      spinner.succeed(chalk.green('Sequence created'));
      if (isJsonOutput(opts)) { console.log(JSON.stringify(data, null, 2)); return; }

      console.log(ui.successBox('Sequence Created', [
        `Name: ${data.sequence_name}`,
        `Contacts enrolled: ${data.contacts_enrolled}`,
        `Steps: ${data.steps}`,
        `Tasks scheduled: ${data.tasks_created}`,
      ]));
      if ((data.invalid_lead_ids as unknown[])?.length) {
        console.log(chalk.yellow(`  Skipped invalid IDs: ${(data.invalid_lead_ids as number[]).join(', ')}`));
      }
      console.log('');
    } catch (e) { fail(spinner, 'Failed to create sequence', e); }
  });

salesCommand.addCommand(sequenceCommand);

// ── Help ────────────────────────────────────────────────────────────

salesCommand.addHelpText('after', `
Examples:
  $ solid sales pipeline              Full pipeline by stage
  $ solid sales prospects             High-value leads ranked by score
  $ solid sales sources --days 60     Lead source performance (60-day window)
  $ solid sales forecast              Revenue forecast with weighted pipeline
  $ solid sales report mtd            Month-to-date performance report
  $ solid sales velocity              Deal velocity and cycle time
  $ solid sales followup              Overdue follow-ups
  $ solid sales win-rate              Win/loss funnel analysis
  $ solid sales score 42              AI-score a lead with industry reasoning
  $ solid sales suggest 17            Next-best-action for a deal
  $ solid sales outreach 42 --sms     Generate personalized SMS outreach
  $ solid sales opportunities         AI growth opportunities
  $ solid sales compare qtd           Quarter-over-quarter comparison
  $ solid sales qualify 42            Promote lead → deal
  $ solid sales advance 17            Move deal to next stage
  $ solid sales close 17 --outcome won  Close a deal
  $ solid sales nurture 42 --sms      Send SMS nurture step
  $ solid sales sequence create --name "New Leads" --leads 42,43,44
`);
