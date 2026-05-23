/**
 * Lead management commands for Solid CLI.
 *
 * Wraps:
 *   /api/v1/crm/leads/*           (controllers/leads.py — 17 endpoints)
 *   /api/v1/leads/*               (api/routers/leads_dashboard.py — pipeline, connections, performance, activity)
 *
 * All operations are scoped to the authenticated company.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown) {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
}

export const leadsCommand = new Command('leads')
  .description('Lead pipeline, scoring, prospecting, forms, and analytics');

// ── Submissions ──────────────────────────────────────────────────────

leadsCommand
  .command('submissions')
  .description('List form submissions')
  .option('--status <status>', 'Filter by status (new, contacted, qualified, etc.)')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('--offset <n>', 'Offset', '0')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading submissions...').start();
    try {
      const params: Record<string, unknown> = {
        limit: parseInt(opts.limit, 10),
        offset: parseInt(opts.offset, 10),
      };
      if (opts.status) params.status = opts.status;
      const res = await apiClient.get('/api/v1/crm/leads/submissions', { params });
      const data = res.data as Record<string, any>;
      const items = data.items || data.submissions || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} submission(s)`));
      if (!items.length) return;
      console.log('');
      for (const s of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(s.id)}  ${s.form_name || s.form_id || '—'}  ${chalk.dim(s.status || 'new')}  ${chalk.dim(s.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load submissions', e); }
  });

// ── Forms ────────────────────────────────────────────────────────────

leadsCommand
  .command('forms')
  .description('List lead capture forms')
  .option('--active', 'Active forms only')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading forms...').start();
    try {
      const params: Record<string, unknown> = {};
      if (opts.active) params.is_active = true;
      const res = await apiClient.get('/api/v1/crm/leads/forms', { params });
      const data = res.data as Record<string, any>;
      const items = data.forms || data.items || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} form(s)`));
      console.log('');
      for (const f of items as Record<string, any>[]) {
        const dot = f.is_active === false ? chalk.red('●') : chalk.green('●');
        console.log(`  ${dot} ${chalk.bold(f.id)}  ${f.name || '—'}  ${chalk.dim(f.slug || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load forms', e); }
  });

// ── Stats / Recent / Analytics ───────────────────────────────────────

leadsCommand
  .command('stats')
  .description('Lead dashboard stats (totals, conversion, by source)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading stats...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/stats');
      const s = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green('Lead stats'));
      console.log('');
      console.log(`  ${chalk.bold('Total leads:')}      ${s.total_leads ?? s.total ?? 'N/A'}`);
      console.log(`  ${chalk.bold('New (7d):')}         ${s.new_leads_7d ?? s.new_7d ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Qualified:')}        ${s.qualified ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Conversion rate:')}  ${s.conversion_rate ? `${s.conversion_rate}%` : 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load stats', e); }
  });

leadsCommand
  .command('recent')
  .description('Recent leads (CRM dashboard feed)')
  .option('-l, --limit <n>', 'Max results', '15')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading recent leads...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/dashboard/leads/recent', {
        params: { limit: parseInt(opts.limit, 10) },
      });
      const data = res.data as Record<string, any>;
      const items = data.leads || data.items || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} recent lead(s)`));
      console.log('');
      for (const l of items as Record<string, any>[]) {
        console.log(`  ${chalk.bold(l.name || l.email || l.id)}  ${chalk.dim(l.source || '')}  score:${chalk.cyan(l.score ?? 0)}  ${chalk.dim(l.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load recent leads', e); }
  });

leadsCommand
  .command('analytics')
  .description('Lead analytics overview (sources, channels, trends)')
  .option('--days <n>', 'Lookback window', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading analytics...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/analytics/overview', {
        params: { days: parseInt(opts.days, 10) },
      });
      const a = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(a, null, 2)); return; }
      spinner.succeed(chalk.green(`Lead analytics (${opts.days}d)`));
      console.log('');
      console.log(`  ${chalk.bold('Total:')}      ${a.total_leads ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Avg score:')}  ${a.avg_score ?? 'N/A'}`);
      if (a.by_source) {
        console.log('');
        console.log(chalk.bold('  By source:'));
        for (const [src, n] of Object.entries(a.by_source as Record<string, unknown>)) {
          console.log(`    ${src}: ${n}`);
        }
      }
    } catch (e) { fail(spinner, 'Failed to load analytics', e); }
  });

// ── Per-contact: score, attribution, activities ──────────────────────

leadsCommand
  .command('score <contact_id>')
  .description('Get lead score for a contact')
  .option('--json', 'Output as JSON')
  .action(async (contactId, opts) => {
    requireAuth();
    const spinner = ora(`Loading score for #${contactId}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/crm/leads/${contactId}/score`);
      const s = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(s, null, 2)); return; }
      spinner.succeed(chalk.green(`Score for contact #${contactId}`));
      console.log('');
      console.log(`  ${chalk.bold('Score:')}      ${s.score ?? s.lead_score ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Stage:')}      ${s.stage || s.lifecycle_stage || 'N/A'}`);
      console.log(`  ${chalk.bold('Updated:')}    ${s.updated_at || 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load score', e); }
  });

leadsCommand
  .command('score-update <contact_id>')
  .description('Add an activity to update lead score')
  .requiredOption('--activity <type>', 'Activity type (page_view, form_submit, email_open, etc.)')
  .option('--points <n>', 'Override default points')
  .action(async (contactId, opts) => {
    requireAuth();
    const spinner = ora(`Updating score for #${contactId}...`).start();
    try {
      const body: Record<string, unknown> = { activity_type: opts.activity };
      if (opts.points) body.points = parseInt(opts.points, 10);
      const res = await apiClient.post(`/api/v1/crm/leads/${contactId}/score`, body);
      spinner.succeed(chalk.green(`Score updated to ${(res.data as Record<string, any>).score ?? '?'}`));
    } catch (e) { fail(spinner, 'Failed to update score', e); }
  });

leadsCommand
  .command('attribution <contact_id>')
  .description('Show attribution data for a contact (source, campaign, touchpoints)')
  .option('--json', 'Output as JSON')
  .action(async (contactId, opts) => {
    requireAuth();
    const spinner = ora('Loading attribution...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/leads/${contactId}/attribution`);
      const a = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(a, null, 2)); return; }
      spinner.succeed(chalk.green(`Attribution for contact #${contactId}`));
      console.log('');
      console.log(`  ${chalk.bold('First source:')}   ${a.first_source || 'N/A'}`);
      console.log(`  ${chalk.bold('Last source:')}    ${a.last_source || 'N/A'}`);
      console.log(`  ${chalk.bold('Campaign:')}       ${a.campaign || 'N/A'}`);
      console.log(`  ${chalk.bold('Touchpoints:')}    ${a.touchpoint_count ?? (a.touchpoints?.length || 'N/A')}`);
    } catch (e) { fail(spinner, 'Failed to load attribution', e); }
  });

leadsCommand
  .command('activities <contact_id>')
  .description('Activity timeline for a contact')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('--json', 'Output as JSON')
  .action(async (contactId, opts) => {
    requireAuth();
    const spinner = ora('Loading activities...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/leads/${contactId}/activities`, {
        params: { limit: parseInt(opts.limit, 10) },
      });
      const data = res.data as Record<string, any>;
      const items = data.activities || data.items || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} activity(s) for contact #${contactId}`));
      console.log('');
      for (const a of items as Record<string, any>[]) {
        console.log(`  ${chalk.dim(a.created_at?.split('T')[0] || '')}  ${chalk.bold(a.activity_type || a.type || '—')}  ${a.summary || ''}`);
      }
    } catch (e) { fail(spinner, 'Failed to load activities', e); }
  });

// ── Prospecting Console (Marcus) ─────────────────────────────────────

leadsCommand
  .command('prospect <message...>')
  .description('Chat with Marcus via the Prospecting Console')
  .option('--conversation <id>', 'Continue an existing conversation')
  .option('--json', 'Output as JSON')
  .action(async (messageParts, opts) => {
    requireAuth();
    const message = messageParts.join(' ').trim();
    if (!message) {
      console.error(chalk.red('Provide a message.'));
      process.exit(1);
    }
    const spinner = ora('Marcus is thinking...').start();
    try {
      const body: Record<string, unknown> = { message };
      if (opts.conversation) body.conversation_id = opts.conversation;
      const res = await apiClient.post('/api/v1/crm/leads/prospecting/chat', body);
      const r = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      spinner.succeed(chalk.green('Marcus'));
      console.log('');
      console.log(`  ${r.response || r.message || JSON.stringify(r)}`);
      if (r.conversation_id) console.log(chalk.dim(`\n  conversation_id: ${r.conversation_id}`));
      if (r.budget_remaining !== undefined) console.log(chalk.dim(`  budget remaining: ${r.budget_remaining}`));
    } catch (e) { fail(spinner, 'Marcus failed to respond', e); }
  });

leadsCommand
  .command('enrich-status <job_id>')
  .description('Check status of an enrichment job')
  .option('--json', 'Output as JSON')
  .action(async (jobId, opts) => {
    requireAuth();
    const spinner = ora(`Loading job ${jobId}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/crm/leads/prospecting/enrich/job/${jobId}`);
      const j = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(j, null, 2)); return; }
      spinner.succeed(chalk.green(`Job ${jobId}`));
      console.log('');
      console.log(`  ${chalk.bold('Status:')}     ${j.status || 'N/A'}`);
      console.log(`  ${chalk.bold('Requested:')}  ${j.requested ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Succeeded:')}  ${j.succeeded ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Failed:')}     ${j.failed ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Saved:')}      ${j.saved_contact_ids?.length ?? 0}`);
    } catch (e) { fail(spinner, 'Failed to load job', e); }
  });

leadsCommand
  .command('budget')
  .description('Marketing budget remaining for the Prospecting Console')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading budget...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/prospecting/budget');
      const b = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(b, null, 2)); return; }
      spinner.succeed(chalk.green('Marketing budget'));
      console.log('');
      console.log(`  ${chalk.bold('Plan:')}        ${b.plan || 'N/A'}`);
      console.log(`  ${chalk.bold('Allowance:')}   ${b.allowance ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Used:')}        ${b.used ?? 'N/A'}`);
      console.log(`  ${chalk.bold('Remaining:')}   ${b.remaining ?? 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load budget', e); }
  });

leadsCommand
  .command('plan-subscribe <slug>')
  .description('Subscribe to a marketing plan (starter, growth, pro, unlimited)')
  .action(async (slug) => {
    requireAuth();
    const spinner = ora(`Subscribing to ${slug}...`).start();
    try {
      const res = await apiClient.post('/api/v1/crm/leads/marketing-plan/subscribe', { plan_slug: slug });
      spinner.succeed(chalk.green(`Subscribed: ${slug}`));
      const r = res.data as Record<string, any>;
      if (r.checkout_url) console.log(chalk.cyan(`  Checkout: ${r.checkout_url}`));
    } catch (e) { fail(spinner, 'Failed to subscribe', e); }
  });

// ── Lead preferences (target services, geo, customer type) ───────────

leadsCommand
  .command('preferences')
  .description('Show lead preferences (target services, geo, customer type)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading preferences...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/leads/preferences');
      const p = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green('Lead preferences'));
      console.log('');
      console.log(`  ${chalk.bold('Target services:')}  ${(p.target_services || []).join(', ') || '—'}`);
      console.log(`  ${chalk.bold('Service radius:')}   ${p.service_radius_miles ?? '—'} mi`);
      console.log(`  ${chalk.bold('Customer type:')}    ${p.customer_type || '—'}`);
      console.log(`  ${chalk.bold('Budget range:')}     ${p.budget_range || '—'}`);
    } catch (e) { fail(spinner, 'Failed to load preferences', e); }
  });

leadsCommand
  .command('preferences-set')
  .description('Update lead preferences')
  .option('--services <list>', 'Comma-separated services')
  .option('--radius <miles>', 'Service radius miles')
  .option('--customer <type>', 'residential | commercial | both')
  .option('--budget <range>', 'Budget range (e.g. "$500-$5000")')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.services) body.target_services = String(opts.services).split(',').map((s: string) => s.trim());
    if (opts.radius) body.service_radius_miles = parseInt(opts.radius, 10);
    if (opts.customer) body.customer_type = opts.customer;
    if (opts.budget) body.budget_range = opts.budget;
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field (--services, --radius, --customer, --budget).'));
      process.exit(1);
    }
    const spinner = ora('Updating preferences...').start();
    try {
      await apiClient.put('/api/v1/crm/leads/preferences', body);
      spinner.succeed(chalk.green('Preferences updated'));
    } catch (e) { fail(spinner, 'Failed to update preferences', e); }
  });

// ── Leads Dashboard (separate router /api/v1/leads/*) ────────────────

leadsCommand
  .command('pipeline')
  .description('Lead pipeline view (counts by stage)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading pipeline...').start();
    try {
      const res = await apiClient.get('/api/v1/leads/pipeline');
      const p = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green('Pipeline'));
      console.log('');
      // Backend can return stages as either:
      //   - Array<{name|stage, count, value}>
      //   - {<stage_name>: {count, value}}   (dict-shaped)
      //   - {<stage_name>: <count>}          (number-valued shortcut)
      const raw = p.stages ?? p.pipeline ?? p;
      let rows: Array<{ name: string; count: unknown; value?: unknown }> = [];
      if (Array.isArray(raw)) {
        rows = raw.map((s: Record<string, any>) => ({ name: s.name || s.stage, count: s.count ?? 0, value: s.value }));
      } else if (raw && typeof raw === 'object') {
        rows = Object.entries(raw).map(([name, v]: [string, any]) => {
          if (v && typeof v === 'object') return { name, count: v.count ?? 0, value: v.value };
          return { name, count: v };
        });
      }
      if (rows.length === 0) {
        console.log(chalk.dim('  No pipeline data yet.'));
        return;
      }
      for (const s of rows) {
        const val = s.value !== undefined ? chalk.dim(`  $${s.value}`) : '';
        console.log(`  ${chalk.bold(s.name)}: ${chalk.cyan(String(s.count))}${val}`);
      }
    } catch (e) { fail(spinner, 'Failed to load pipeline', e); }
  });

leadsCommand
  .command('connections')
  .description('Lead source connections (forms, integrations, marketplaces)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading connections...').start();
    try {
      const res = await apiClient.get('/api/v1/leads/connections');
      const c = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(c, null, 2)); return; }
      spinner.succeed(chalk.green('Lead source connections'));
      const items = c.connections || c.sources || [];
      console.log('');
      for (const x of items as Record<string, any>[]) {
        const dot = x.connected ? chalk.green('●') : chalk.dim('○');
        console.log(`  ${dot} ${chalk.bold(x.name || x.id)}  ${chalk.dim(x.type || '')}`);
      }
    } catch (e) { fail(spinner, 'Failed to load connections', e); }
  });

leadsCommand
  .command('performance')
  .description('Lead performance summary (rates, response time)')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading performance...').start();
    try {
      const res = await apiClient.get('/api/v1/leads/performance');
      const p = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(p, null, 2)); return; }
      spinner.succeed(chalk.green('Performance'));
      console.log('');
      console.log(`  ${chalk.bold('Response time (avg):')}  ${p.avg_response_time_minutes ?? 'N/A'} min`);
      console.log(`  ${chalk.bold('Contact rate:')}         ${p.contact_rate ? `${p.contact_rate}%` : 'N/A'}`);
      console.log(`  ${chalk.bold('Qualification rate:')}   ${p.qualification_rate ? `${p.qualification_rate}%` : 'N/A'}`);
      console.log(`  ${chalk.bold('Win rate:')}             ${p.win_rate ? `${p.win_rate}%` : 'N/A'}`);
    } catch (e) { fail(spinner, 'Failed to load performance', e); }
  });

leadsCommand
  .command('activity')
  .description('Recent lead activity feed')
  .option('-l, --limit <n>', 'Max results', '50')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading activity...').start();
    try {
      const res = await apiClient.get('/api/v1/leads/activity', {
        params: { limit: parseInt(opts.limit, 10) },
      });
      const data = res.data as Record<string, any>;
      const items = data.activities || data.items || [];
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${items.length} activity(s)`));
      console.log('');
      for (const a of items as Record<string, any>[]) {
        console.log(`  ${chalk.dim(a.created_at?.split('T')[0] || '')}  ${chalk.bold(a.event || a.type || '—')}  ${a.summary || ''}`);
      }
    } catch (e) { fail(spinner, 'Failed to load activity', e); }
  });

import { appendExamples as __appendExamplesLeads } from '../lib/command-kit';
__appendExamplesLeads(leadsCommand, [
  { cmd: 'solid leads submissions', why: 'List lead submissions (paginates)' },
  { cmd: 'solid leads recent', why: 'Latest leads across all forms' },
  { cmd: 'solid leads score <contact_id>', why: 'Full enrichment + score breakdown' },
  { cmd: 'solid leads prospect "interested in HVAC service"', why: 'AI-qualify a prospect' },
]);
