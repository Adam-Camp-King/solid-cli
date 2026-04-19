/**
 * Agent chains — build, execute, approve, pause multi-step AI workflows.
 * Wraps api/routers/chains.py at /api/v1/chains/*.
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
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const chainsCommand = new Command('chains')
  .description('Agent chains — multi-step AI workflows (build, execute, approve)');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = chainsCommand.command('list').alias('ls').description('List chains');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading chains...',
      errorText: 'Failed to load chains',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/chains', { params: { limit, offset } })).data,
      extract: (page) => {
        if (Array.isArray(page)) return page as Array<Record<string, unknown>>;
        const d = page as Record<string, unknown>;
        return ((d.chains || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No chains.')); return; }
        for (const c of items) {
          const dot = c.status === 'active' ? chalk.green('●') : chalk.dim('○');
          console.log(`  ${dot} ${chalk.bold(String(c.id))}  ${c.name || '—'}  ${chalk.dim(String(c.status || ''))}`);
        }
      },
    });
  });
}

chainsCommand
  .command('get <id>')
  .description('Get chain details')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora(`Loading ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/chains/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Chain ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('create')
  .description('Create a chain from a JSON definition')
  .requiredOption('--file <path>', 'JSON file with chain definition')
  .action(async (opts) => {
    requireAuth();
    const fs = await import('fs');
    const body = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
    const s = ora('Creating chain...').start();
    try {
      const res = await apiClient.post('/api/v1/chains', body);
      s.succeed(chalk.green(`Chain created: ${(res.data as Record<string, any>).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('update <id>')
  .description('Update a chain')
  .requiredOption('--file <path>', 'JSON file with update')
  .action(async (id, opts) => {
    requireAuth();
    const fs = await import('fs');
    const body = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
    const s = ora(`Updating ${id}...`).start();
    try {
      await apiClient.put(`/api/v1/chains/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('delete <id>')
  .description('Delete a chain (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete chain ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: `Deleting ${id}...`, stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/chains/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('activate <id>')
  .description('Activate a chain')
  .action(async (id) => {
    requireAuth();
    const s = ora('Activating...').start();
    try {
      await apiClient.post(`/api/v1/chains/${id}/activate`);
      s.succeed(chalk.green('Activated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('pause <id>')
  .description('Pause a chain')
  .action(async (id) => {
    requireAuth();
    const s = ora('Pausing...').start();
    try {
      await apiClient.post(`/api/v1/chains/${id}/pause`);
      s.succeed(chalk.green('Paused'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('archive <id>')
  .description('Archive a chain')
  .action(async (id) => {
    requireAuth();
    const s = ora('Archiving...').start();
    try {
      await apiClient.post(`/api/v1/chains/${id}/archive`);
      s.succeed(chalk.green('Archived'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('execute <id>')
  .description('Execute a chain — prints execution_id (a.k.a. job id) for follow-up')
  .option('--input <json>', 'Input payload as JSON')
  .option('--json', 'Output as JSON (full execution response)')
  .action(async (id: string, opts: { input?: string; json?: boolean }) => {
    requireAuth();
    let body: unknown = {};
    if (opts.input) {
      try { body = JSON.parse(opts.input); } catch {
        console.error(chalk.red('Invalid JSON passed to --input'));
        process.exit(2);
      }
    }
    const s = ora({ text: `Executing ${id}...`, stream: process.stderr }).start();
    try {
      const res = await apiClient.post(`/api/v1/chains/${id}/execute`, body);
      const data = res.data as { execution_id?: string | number; id?: string | number; status?: string };
      const executionId = data.execution_id ?? data.id;
      if (isJsonOutput(opts)) {
        s.stop();
        console.log(JSON.stringify(res.data, null, 2));
        return;
      }
      s.succeed(chalk.green(`Execution started: ${executionId}`));
      // Explicit handle for follow-up commands (audit #43)
      console.log(String(executionId));
      console.error(chalk.dim(`  Status:  solid chains execution ${executionId}`));
      console.error(chalk.dim(`  Cancel:  solid chains cancel ${executionId}`));
    } catch (e) { fail(s, 'Failed', e); process.exit(1); }
  });

chainsCommand
  .command('executions <chain_id>')
  .description('List chain executions')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading executions...').start();
    try {
      const res = await apiClient.get(`/api/v1/chains/${id}/executions`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Executions'));
      const items = (res.data as Record<string, any>).executions || res.data;
      const list = Array.isArray(items) ? items : (items.items || []);
      for (const e of list as Record<string, any>[]) console.log(`  ${chalk.bold(e.id)}  ${chalk.dim(e.status)}  ${chalk.dim(e.created_at?.split('T')[0] || '')}`);
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('execution <execution_id>')
  .description('Get one execution detail')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/chains/executions/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Execution ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('approve <execution_id>')
  .description('Approve a paused execution')
  .action(async (id) => {
    requireAuth();
    const s = ora('Approving...').start();
    try {
      await apiClient.post(`/api/v1/chains/executions/${id}/approve`);
      s.succeed(chalk.green('Approved'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('cancel <execution_id>')
  .description('Cancel an execution (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Cancel execution ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Cancelling...', stream: process.stderr }).start();
    try {
      await apiClient.post(`/api/v1/chains/executions/${id}/cancel`);
      s.succeed(chalk.green('Cancelled'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('templates')
  .description('List chain templates')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading templates...').start();
    try {
      const res = await apiClient.get('/api/v1/chains/templates');
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Templates'));
      const items = (res.data as Record<string, any>).templates || res.data;
      const list = Array.isArray(items) ? items : (items.items || []);
      for (const t of list as Record<string, any>[]) console.log(`  ${chalk.bold(t.id)}  ${t.name}  ${chalk.dim(t.description || '')}`);
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('template <template_id>')
  .description('Get a chain template detail')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/chains/templates/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Template'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('from-template')
  .description('Create a chain from a template')
  .requiredOption('--template <id>', 'Template ID')
  .option('--name <name>', 'Override name')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { template_id: opts.template };
    if (opts.name) body.name = opts.name;
    const s = ora('Creating from template...').start();
    try {
      const res = await apiClient.post('/api/v1/chains/from-template', body);
      s.succeed(chalk.green(`Chain created: ${(res.data as Record<string, any>).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

chainsCommand
  .command('pending-approvals')
  .description('List chain executions pending human approval')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/chains/pending-approvals');
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Pending approvals'));
      const items = (res.data as Record<string, any>).pending || res.data;
      const list = Array.isArray(items) ? items : (items.items || []);
      for (const p of list as Record<string, any>[]) console.log(`  ${chalk.bold(p.id)}  ${p.chain_name || p.name || '—'}  ${chalk.dim(p.waiting_since || '')}`);
    } catch (e) { fail(s, 'Failed', e); }
  });

import { appendExamples as __ae_chains } from '../lib/command-kit';
__ae_chains(chainsCommand, [
  { cmd: 'solid chains list',                           why: 'Your agent-chain workflows' },
  { cmd: 'solid chains templates',                      why: 'Starter chains from the platform' },
  { cmd: 'solid chains from-template <id>',             why: 'Instantiate a template' },
  { cmd: 'solid chains create --file chain.json',       why: 'Create from a definition file' },
  { cmd: 'solid chains pending-approvals',              why: 'Chains waiting for human approval' },
]);
