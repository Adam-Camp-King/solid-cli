/**
 * CRM commands for Solid CLI
 *
 * solid crm contacts / deals / tasks / dashboard
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

type Rec = Record<string, unknown>;
function asList(data: unknown): Rec[] {
  if (Array.isArray(data)) return data;
  const d = data as Rec;
  return (d.items || d.contacts || d.deals || d.tasks || d.results || []) as Rec[];
}
function contactName(c: Rec): string {
  return [c.first_name, c.last_name].filter(Boolean).join(' ') || chalk.dim('—');
}

export const crmCommand = new Command('crm')
  .description('CRM — contacts, deals, tasks, and pipeline');

// ── Contacts ────────────────────────────────────────────────────────

const contactsCommand = new Command('contacts')
  .description('List contacts')
  .option('-s, --search <query>', 'Search contacts')
  .option('--status <status>', 'Filter by status')
  .option('--source <source>', 'Filter by source')
  .option('--type <type>', 'Filter by contact type')
  .option('-l, --limit <n>', 'Max results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading contacts...').start();
    try {
      const params: Rec = { page_size: parseInt(opts.limit, 10) };
      if (opts.search) params.search = opts.search;
      if (opts.status) params.status = opts.status;
      if (opts.source) params.source = opts.source;
      if (opts.type) params.contact_type = opts.type;
      const res = await apiClient.get('/api/v1/crm/contacts', { params });
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = asList(res.data);
      if (items.length === 0) { console.log(chalk.yellow('  No contacts found.')); return; }
      console.log(ui.header(`Contacts (${items.length})`));
      console.log(ui.table(['ID', 'Name', 'Email', 'Phone', 'Status'], items.map((c) => [
        String(c.id), contactName(c), String(c.email || chalk.dim('—')),
        String(c.phone || chalk.dim('—')), String(c.status || chalk.dim('—')),
      ])));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load contacts')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

contactsCommand.command('get <id>').description('Get contact details').option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    requireAuth();
    const spinner = ora('Loading contact...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/contacts/${id}`);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const c = res.data as Rec;
      console.log(ui.successBox('Contact', [
        `ID:       ${c.id}`, `Name:     ${contactName(c)}`, `Email:    ${c.email || '—'}`,
        `Phone:    ${c.phone || '—'}`, `Company:  ${c.company_name || '—'}`, `Status:   ${c.status || '—'}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load contact')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

contactsCommand.command('create').description('Create a new contact')
  .requiredOption('--name <name>', 'Full name (first last)')
  .option('--email <email>', 'Email address').option('--phone <phone>', 'Phone number')
  .option('--company <company>', 'Company name').option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating contact...').start();
    try {
      const parts = opts.name.split(' ');
      const body: Rec = { first_name: parts[0] };
      if (parts.length > 1) body.last_name = parts.slice(1).join(' ');
      if (opts.email) body.email = opts.email;
      if (opts.phone) body.phone = opts.phone;
      if (opts.company) body.company_name = opts.company;
      const res = await apiClient.post('/api/v1/crm/contacts', body);
      spinner.succeed(chalk.green('Contact created'));
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const c = res.data as Rec;
      console.log(ui.successBox('Contact Created', [`ID: ${c.id}`, `Name: ${contactName(c)}`, `Email: ${c.email || '—'}`]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to create contact')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

contactsCommand.command('update <id>').description('Update a contact')
  .option('--name <name>', 'Full name').option('--email <email>', 'Email').option('--phone <phone>', 'Phone')
  .option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    requireAuth();
    const spinner = ora('Updating contact...').start();
    try {
      const body: Rec = {};
      if (opts.name) { const p = opts.name.split(' '); body.first_name = p[0]; if (p.length > 1) body.last_name = p.slice(1).join(' '); }
      if (opts.email) body.email = opts.email;
      if (opts.phone) body.phone = opts.phone;
      if (!Object.keys(body).length) { spinner.fail(chalk.red('No fields to update. Use --name, --email, or --phone.')); return; }
      const res = await apiClient.patch(`/api/v1/crm/contacts/${id}`, body);
      spinner.succeed(chalk.green('Contact updated'));
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const c = res.data as Rec;
      console.log(ui.successBox('Updated', [`ID: ${c.id || id}`, `Name: ${contactName(c)}`]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to update contact')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

contactsCommand.command('search <query>').description('Typeahead search for contacts').option('--json', 'Output as JSON')
  .action(async (query: string, opts) => {
    requireAuth();
    const spinner = ora('Searching...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/contacts/search/typeahead', { params: { q: query } });
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = asList(res.data);
      if (!items.length) { console.log(chalk.yellow(`  No matches for "${query}".`)); return; }
      console.log(ui.header(`Search: "${query}" (${items.length} results)`));
      console.log(ui.table(['ID', 'Name', 'Email', 'Phone'], items.map((c) => [
        String(c.id), contactName(c), String(c.email || chalk.dim('—')), String(c.phone || chalk.dim('—')),
      ])));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Search failed')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

contactsCommand.command('timeline <id>').description('View contact activity timeline').option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    requireAuth();
    const spinner = ora('Loading timeline...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/contacts/${id}/timeline`);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const activities = asList(res.data);
      if (!activities.length) { console.log(chalk.yellow('  No activity yet.')); return; }
      console.log(ui.header(`Timeline — Contact ${id}`));
      for (const a of activities) {
        const date = a.created_at ? String(a.created_at).split('T')[0] : '—';
        const type = chalk.cyan(String(a.type || a.activity_type || 'event').padEnd(12));
        console.log(`  ${chalk.dim(date)}  ${type}  ${a.description || a.summary || a.title || ''}`);
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load timeline')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

crmCommand.addCommand(contactsCommand);

// ── Deals ───────────────────────────────────────────────────────────

const dealsCommand = new Command('deals')
  .description('List deals')
  .option('--stage <stage>', 'Filter by stage')
  .option('-l, --limit <n>', 'Max results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading deals...').start();
    try {
      const params: Rec = { limit: parseInt(opts.limit, 10) };
      if (opts.stage) params.stage = opts.stage;
      const res = await apiClient.get('/api/v1/crm/deals', { params });
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = asList(res.data);
      if (!items.length) { console.log(chalk.yellow('  No deals found.')); return; }
      console.log(ui.header(`Deals (${items.length})`));
      console.log(ui.table(['ID', 'Title', 'Value', 'Stage', 'Contact'], items.map((d) => [
        String(d.id), String(d.title || chalk.dim('—')),
        d.value ? `$${Number(d.value).toLocaleString()}` : chalk.dim('—'),
        String(d.stage || chalk.dim('—')), String(d.contact_name || d.contact_id || chalk.dim('—')),
      ])));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load deals')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

dealsCommand.command('get <id>').description('Get deal details').option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    requireAuth();
    const spinner = ora('Loading deal...').start();
    try {
      const res = await apiClient.get(`/api/v1/crm/deals/${id}`);
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Rec;
      console.log(ui.successBox('Deal', [
        `ID:      ${d.id}`, `Title:   ${d.title || '—'}`,
        `Value:   ${d.value ? '$' + Number(d.value).toLocaleString() : '—'}`,
        `Stage:   ${d.stage || '—'}`, `Contact: ${d.contact_name || d.contact_id || '—'}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load deal')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

dealsCommand.command('create').description('Create a new deal')
  .requiredOption('--title <title>', 'Deal title')
  .option('--value <value>', 'Deal value').option('--contact-id <id>', 'Contact ID').option('--stage <stage>', 'Stage')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating deal...').start();
    try {
      const body: Rec = { title: opts.title };
      if (opts.value) body.value = parseFloat(opts.value);
      if (opts.contactId) body.contact_id = parseInt(opts.contactId, 10);
      if (opts.stage) body.stage = opts.stage;
      const res = await apiClient.post('/api/v1/crm/deals', body);
      spinner.succeed(chalk.green('Deal created'));
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Rec;
      console.log(ui.successBox('Deal Created', [
        `ID: ${d.id}`, `Title: ${d.title}`, `Value: ${d.value ? '$' + Number(d.value).toLocaleString() : '—'}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to create deal')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

dealsCommand.command('update <id>').description('Update a deal')
  .option('--stage <stage>', 'Pipeline stage').option('--value <value>', 'Deal value').option('--json', 'Output as JSON')
  .action(async (id: string, opts) => {
    requireAuth();
    const spinner = ora('Updating deal...').start();
    try {
      const body: Rec = {};
      if (opts.stage) body.stage = opts.stage;
      if (opts.value) body.value = parseFloat(opts.value);
      if (!Object.keys(body).length) { spinner.fail(chalk.red('No fields to update. Use --stage or --value.')); return; }
      const res = await apiClient.patch(`/api/v1/crm/deals/${id}`, body);
      spinner.succeed(chalk.green('Deal updated'));
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Rec;
      console.log(ui.successBox('Deal Updated', [
        `ID: ${d.id || id}`, `Stage: ${d.stage || '—'}`, `Value: ${d.value ? '$' + Number(d.value).toLocaleString() : '—'}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to update deal')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

dealsCommand.command('close <id>').description('Close a deal as won or lost')
  .option('--won', 'Close as won').option('--lost', 'Close as lost')
  .action(async (id: string, opts) => {
    requireAuth();
    if (!opts.won && !opts.lost) { console.error(chalk.red('Specify --won or --lost.')); process.exit(1); }
    const outcome = opts.won ? 'won' : 'lost';
    const spinner = ora(`Closing deal as ${outcome}...`).start();
    try {
      await apiClient.post(`/api/v1/crm/deals/${id}/close`, { outcome });
      const color = outcome === 'won' ? chalk.green : chalk.red;
      spinner.succeed(color(`Deal ${id} closed as ${outcome.toUpperCase()}`));
    } catch (e) { spinner.fail(chalk.red('Failed to close deal')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

crmCommand.addCommand(dealsCommand);

// ── Tasks ───────────────────────────────────────────────────────────

const tasksCommand = new Command('tasks')
  .description('List CRM tasks')
  .option('--status <status>', 'Filter by status').option('--priority <priority>', 'Filter by priority')
  .option('--overdue', 'Show only overdue tasks').option('-l, --limit <n>', 'Max results', '25')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading tasks...').start();
    try {
      const params: Rec = { limit: parseInt(opts.limit, 10) };
      if (opts.status) params.status = opts.status;
      if (opts.priority) params.priority = opts.priority;
      if (opts.overdue) params.overdue = true;
      const res = await apiClient.get('/api/v1/crm/tasks', { params });
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const items = asList(res.data);
      if (!items.length) { console.log(chalk.yellow('  No tasks found.')); return; }
      console.log(ui.header(`Tasks (${items.length})`));
      console.log(ui.table(['ID', 'Title', 'Priority', 'Due', 'Status'], items.map((t) => {
        const due = t.due_date ? String(t.due_date).split('T')[0] : '—';
        const overdue = t.due_date && new Date(String(t.due_date)) < new Date();
        return [String(t.id), String(t.title || chalk.dim('—')), String(t.priority || chalk.dim('—')),
          overdue ? chalk.red(due) : chalk.dim(due), String(t.status || chalk.dim('—'))];
      })));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load tasks')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

tasksCommand.command('create').description('Create a new task')
  .requiredOption('--title <title>', 'Task title')
  .option('--contact-id <id>', 'Contact ID').option('--priority <priority>', 'Priority (low, medium, high)')
  .option('--due <date>', 'Due date (YYYY-MM-DD)').option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating task...').start();
    try {
      const body: Rec = { title: opts.title };
      if (opts.contactId) body.contact_id = parseInt(opts.contactId, 10);
      if (opts.priority) body.priority = opts.priority;
      if (opts.due) body.due_date = opts.due;
      const res = await apiClient.post('/api/v1/crm/tasks', body);
      spinner.succeed(chalk.green('Task created'));
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const t = res.data as Rec;
      console.log(ui.successBox('Task Created', [
        `ID: ${t.id}`, `Title: ${t.title}`, `Priority: ${t.priority || '—'}`,
        `Due: ${t.due_date ? String(t.due_date).split('T')[0] : '—'}`,
      ]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to create task')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

tasksCommand.command('complete <id>').description('Mark a task as complete')
  .action(async (id: string) => {
    requireAuth();
    const spinner = ora('Completing task...').start();
    try {
      await apiClient.patch(`/api/v1/crm/tasks/${id}/complete`);
      spinner.succeed(chalk.green(`Task ${id} marked complete`));
    } catch (e) { spinner.fail(chalk.red('Failed to complete task')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });

crmCommand.addCommand(tasksCommand);

// ── Dashboard ───────────────────────────────────────────────────────

crmCommand.command('dashboard').description('CRM summary — contacts, deals, revenue, activities')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading CRM dashboard...').start();
    try {
      const res = await apiClient.get('/api/v1/crm/dashboard/summary');
      spinner.stop();
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const d = res.data as Rec;
      console.log(ui.header('CRM Dashboard'));
      console.log(ui.label('Contacts', String(d.total_contacts ?? d.contacts_count ?? '—')));
      console.log(ui.label('Open Deals', String(d.open_deals ?? d.deals_count ?? '—')));
      console.log(ui.label('Pipeline', d.pipeline_value ? `$${Number(d.pipeline_value).toLocaleString()}` : '—'));
      console.log(ui.label('Won Revenue', d.won_revenue ? `$${Number(d.won_revenue).toLocaleString()}` : '—'));
      console.log(ui.label('Tasks Due', String(d.tasks_due ?? d.overdue_tasks ?? '—')));
      console.log(ui.label('Activities', String(d.recent_activities ?? d.activities_count ?? '—')));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed to load dashboard')); console.error(chalk.red(`  ${handleApiError(e).message}`)); }
  });
