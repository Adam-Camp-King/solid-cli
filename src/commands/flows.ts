/**
 * Commerce Flows — payment flows and subscriptions for Solid CLI
 *
 * Create, manage, and monitor payment flows for your business.
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

function statusColor(status: string): string {
  switch (status) {
    case 'active': return chalk.green(status);
    case 'paused': return chalk.yellow(status);
    case 'test': return chalk.blue(status);
    case 'archived': case 'draft': return chalk.dim(status);
    default: return status;
  }
}

/** Simple POST action helper for activate/pause/test/archive */
async function flowAction(flowId: string, action: string, verb: string, color: (s: string) => string): Promise<void> {
  requireAuth();
  const spinner = ora(`${verb} flow ${flowId}...`).start();
  try {
    await apiClient.post(`/api/v1/cli/flows/${flowId}/${action}`);
    spinner.succeed(color(`Flow ${flowId} ${verb.toLowerCase()}`));
  } catch (error) {
    spinner.fail(chalk.red(`Failed to ${action} flow`));
    const apiError = handleApiError(error);
    console.error(chalk.red(`  ${apiError.message}`));
  }
}

export const flowsCommand = new Command('flow')
  .description('Commerce flows — payment flows and subscriptions');

// List flows
flowsCommand
  .command('list')
  .alias('ls')
  .description('List payment flows')
  .option('-s, --status <status>', 'Filter by status (active, paused, draft, archived)')
  .option('-t, --type <type>', 'Filter by commerce type')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading flows...').start();
    try {
      const params: Record<string, unknown> = {};
      if (options.status) params.status = options.status;
      if (options.type) params.commerce_type = options.type;

      const response = await apiClient.get('/api/v1/cli/flows', { params });
      const data = response.data as any;
      const flows = data.flows || [];

      if (options.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }

      spinner.succeed(`${flows.length} flows`);
      if (flows.length === 0) {
        console.log(chalk.dim('  No flows found. Create one with `solid flow create <name>`'));
        return;
      }
      console.log('');
      console.log(ui.table(['ID', 'Name', 'Type', 'Price', 'Status'], flows.map((f: any) => [
        String(f.id).substring(0, 10),
        f.name.substring(0, 24),
        f.commerce_type || f.type || '-',
        f.price ? `$${f.price}` : '-',
        statusColor(f.status),
      ])));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load flows'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Get flow details
flowsCommand
  .command('get <flow_id>')
  .description('Get flow details')
  .option('--json', 'Output as JSON')
  .action(async (flowId, options) => {
    requireAuth();
    const spinner = ora('Loading flow...').start();
    try {
      const response = await apiClient.get(`/api/v1/cli/flows/${flowId}`);
      const data = response.data as any;

      if (options.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }

      spinner.succeed('Flow loaded');
      console.log(ui.header(data.name || 'Flow Details'));
      console.log(ui.label('ID', String(data.id)));
      console.log(ui.label('Status', statusColor(data.status)));
      console.log(ui.label('Type', data.commerce_type || data.type || '-'));
      console.log(ui.label('Price', data.price ? `$${data.price} ${data.currency || 'USD'}` : '-'));
      console.log(ui.label('Interval', data.interval || '-'));
      if (data.trial_days) console.log(ui.label('Trial', `${data.trial_days} days`));
      if (data.created_at) console.log(ui.label('Created', new Date(data.created_at).toLocaleDateString()));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load flow'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Create flow
flowsCommand
  .command('create <name>')
  .description('Create a payment flow')
  .option('-t, --type <type>', 'Commerce type (one_time, subscription, usage)')
  .option('-p, --price <price>', 'Price amount')
  .option('--interval <interval>', 'Billing interval (monthly, yearly, weekly)')
  .option('--trial-days <days>', 'Trial period in days')
  .option('--currency <currency>', 'Currency code', 'USD')
  .action(async (name, options) => {
    requireAuth();
    const spinner = ora('Creating flow...').start();
    try {
      const body: Record<string, unknown> = { name };
      if (options.type) body.commerce_type = options.type;
      if (options.price) body.price = parseFloat(options.price);
      if (options.currency) body.currency = options.currency;
      if (options.interval) body.interval = options.interval;
      if (options.trialDays) body.trial_days = parseInt(options.trialDays);

      const response = await apiClient.post('/api/v1/cli/flows', body);
      const data = response.data as any;

      spinner.succeed(chalk.green('Flow created'));
      console.log('');
      console.log(ui.label('ID', String(data.id)));
      console.log(ui.label('Name', data.name || name));
      console.log(ui.label('Status', statusColor(data.status || 'draft')));
      console.log('');
      console.log(chalk.dim(`  Next: Run \`solid flow activate ${data.id}\` to go live`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create flow'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Update flow
flowsCommand
  .command('update <flow_id>')
  .description('Update a flow')
  .option('-n, --name <name>', 'New name')
  .option('-p, --price <price>', 'New price')
  .option('--interval <interval>', 'New billing interval')
  .option('--trial-days <days>', 'New trial period')
  .action(async (flowId, options) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.price) body.price = parseFloat(options.price);
    if (options.interval) body.interval = options.interval;
    if (options.trialDays) body.trial_days = parseInt(options.trialDays);

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('No update fields provided. Use --name, --price, --interval, or --trial-days'));
      process.exit(1);
    }
    const spinner = ora('Updating flow...').start();
    try {
      await apiClient.patch(`/api/v1/cli/flows/${flowId}`, body);
      spinner.succeed(chalk.green(`Flow ${flowId} updated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update flow'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Activate / Pause / Test / Archive
flowsCommand.command('activate <flow_id>').description('Activate a flow')
  .action((flowId) => flowAction(flowId, 'activate', 'Activating', chalk.green));

flowsCommand.command('pause <flow_id>').description('Pause a flow')
  .action((flowId) => flowAction(flowId, 'pause', 'Pausing', chalk.yellow));

flowsCommand.command('test <flow_id>').description('Put flow in test mode')
  .action((flowId) => flowAction(flowId, 'test', 'Testing', chalk.blue));

flowsCommand.command('archive <flow_id>').description('Archive a flow')
  .action((flowId) => flowAction(flowId, 'archive', 'Archiving', chalk.dim));

// Flow metrics
flowsCommand
  .command('metrics <flow_id>')
  .description('View flow metrics')
  .option('--json', 'Output as JSON')
  .action(async (flowId, options) => {
    requireAuth();
    const spinner = ora('Loading metrics...').start();
    try {
      const response = await apiClient.get(`/api/v1/cli/flows/${flowId}/metrics`);
      const data = response.data as any;

      if (options.json) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }

      spinner.succeed('Metrics loaded');
      console.log(ui.header(`Flow ${flowId} Metrics`));
      console.log(ui.label('Revenue', data.total_revenue ? `$${data.total_revenue}` : '$0'));
      console.log(ui.label('Transactions', String(data.total_transactions || 0)));
      console.log(ui.label('Subscribers', String(data.active_subscribers || 0)));
      console.log(ui.label('Conversion', data.conversion_rate ? `${data.conversion_rate}%` : '-'));
      console.log(ui.label('Churn', data.churn_rate ? `${data.churn_rate}%` : '-'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load metrics'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Clone flow
flowsCommand
  .command('clone <flow_id>')
  .description('Clone a flow')
  .option('-n, --name <name>', 'Name for the cloned flow')
  .option('-p, --price <price>', 'New price for the clone')
  .action(async (flowId, options) => {
    requireAuth();
    const spinner = ora(`Cloning flow ${flowId}...`).start();
    try {
      const params: Record<string, unknown> = {};
      if (options.name) params.name = options.name;
      if (options.price) params.price = parseFloat(options.price);

      const response = await apiClient.post(`/api/v1/cli/flows/${flowId}/clone`, params);
      const data = response.data as any;

      spinner.succeed(chalk.green('Flow cloned'));
      console.log('');
      console.log(ui.label('New ID', String(data.id)));
      console.log(ui.label('Name', data.name));
      console.log(ui.label('Status', statusColor(data.status || 'draft')));
    } catch (error) {
      spinner.fail(chalk.red('Failed to clone flow'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// List agents on flow
flowsCommand
  .command('agents <flow_id>')
  .description('List agents assigned to a flow')
  .action(async (flowId) => {
    requireAuth();
    const spinner = ora('Loading flow agents...').start();
    try {
      const response = await apiClient.get(`/api/v1/cli/flows/${flowId}/agents`);
      const data = response.data as any;
      const agents = data.agents || [];

      spinner.succeed(`${agents.length} agents on flow`);
      if (agents.length === 0) {
        console.log(chalk.dim('  No agents assigned to this flow.'));
        return;
      }
      console.log('');
      console.log(ui.table(['ID', 'Name', 'Type', 'Status'], agents.map((a: any) => [
        String(a.id || a.agent_id),
        a.name,
        a.agent_type || '-',
        a.status === 'active' ? chalk.green(a.status) : chalk.dim(a.status),
      ])));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load agents'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
