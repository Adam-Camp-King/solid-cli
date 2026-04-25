/**
 * Webhooks command for Solid CLI — custom webhook management.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const webhooksCommand = new Command('webhooks')
  .description('Custom webhook management')
  .action(async () => { webhooksCommand.outputHelp(); });

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = webhooksCommand.command('list').alias('ls').description('List configured webhooks');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading webhooks...',
      errorText: 'Failed to load webhooks',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/developer/webhooks', { params: { limit, offset } })).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.webhooks || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (hooks) => {
        console.log('');
        console.log(ui.header(`Webhooks (${hooks.length})`));
        if (hooks.length === 0) {
          console.log(chalk.dim('  No webhooks. Use `solid webhooks create` to add one.'));
        } else {
          for (const h of hooks) {
            const s = h.is_active ? chalk.green('●') : chalk.red('●');
            console.log(`  ${s} ${chalk.bold(String(h.name || h.url))}`);
            console.log(chalk.dim(`    ${h.url}`));
            if (h.events) console.log(chalk.dim(`    Events: ${Array.isArray(h.events) ? (h.events as string[]).join(', ') : h.events}`));
          }
        }
        console.log('');
      },
    });
  });
}

webhooksCommand.command('create <url>').description('Create a webhook')
  .option('-n, --name <name>', 'Name').option('-e, --events <events>', 'Comma-separated events')
  .action(async (url, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Creating...').start();
    try {
      const events = options.events ? options.events.split(',').map((e: string) => e.trim()) : [];
      const res = await apiClient.post('/api/v1/developer/webhooks', { url, name: options.name || url, events });
      spinner.stop();
      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.successBox('Webhook Created', [`${chalk.dim('URL:')}    ${url}`, `${chalk.dim('ID:')}     ${d.id || 'n/a'}`, `${chalk.dim('Secret:')} ${d.secret || 'check dashboard'}`]));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

webhooksCommand.command('delete <id>').description('Delete a webhook')
  .action(async (id) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Deleting...').start();
    try {
      await apiClient.delete(`/api/v1/developer/webhooks/${id}`);
      spinner.succeed(chalk.green(`Webhook ${id} deleted`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

webhooksCommand.command('simulate <event>').description('Send a test event to a webhook')
  .option('-w, --webhook <id>', 'Webhook ID to send to (default: first active webhook)')
  .option('-d, --data <json>', 'Custom payload data (JSON string)')
  .option('--json', 'JSON output')
  .action(async (event, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;

    const VALID_EVENTS = [
      'company.created', 'company.updated', 'company.deleted',
      'key.created', 'key.revoked', 'key.rotated',
      'subscription.created', 'subscription.updated', 'subscription.cancelled',
      'invoice.created', 'invoice.paid', 'invoice.failed',
      'oauth.authorized', 'oauth.revoked',
      'webhook.test',
    ];

    if (!VALID_EVENTS.includes(event)) {
      console.error(chalk.red(`Invalid event: ${event}`));
      console.log('');
      console.log(chalk.bold('  Available events:'));
      for (const e of VALID_EVENTS) {
        console.log(`    ${chalk.dim('•')} ${e}`);
      }
      console.log('');
      return;
    }

    let webhookId = options.webhook;

    // If no webhook ID specified, find the first active one
    if (!webhookId) {
      const listSpinner = ora('Finding webhook...').start();
      try {
        const listRes = await apiClient.get('/api/v1/developer/webhooks');
        const hooks = (listRes.data as Record<string, any>).webhooks || (listRes.data as Record<string, any>).items || [];
        const active = hooks.find((h: Record<string, any>) => h.is_active !== false);
        if (!active) {
          listSpinner.fail(chalk.red('No active webhooks found'));
          console.log(chalk.dim('  Create one: solid webhooks create https://your-url.com'));
          return;
        }
        webhookId = active.id;
        listSpinner.succeed(chalk.green(`Using webhook: ${active.name || active.url} (ID: ${webhookId})`));
      } catch (e) {
        listSpinner.fail(chalk.red('Failed to list webhooks'));
        console.error(handleApiError(e).message);
        process.exit(1);
      }
    }

    const spinner = ora(`Sending ${event} to webhook ${webhookId}...`).start();
    try {
      const payload: Record<string, unknown> = { event_type: event };
      if (options.data) {
        try {
          payload.custom_data = JSON.parse(options.data);
        } catch {
          spinner.fail(chalk.red('Invalid JSON in --data'));
          return;
        }
      }
      const res = await apiClient.post(`/api/v1/developer/webhooks/${webhookId}/test`, payload);
      spinner.succeed(chalk.green(`Event ${event} sent`));
      const data = res.data as Record<string, any>;

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      console.log('');
      console.log(ui.successBox('Webhook Event Sent', [
        `Event: ${event}`,
        `Webhook: ${webhookId}`,
        `Status: ${data.delivery_status || data.status || 'sent'}`,
        data.response_code ? `Response: ${data.response_code}` : '',
        data.latency_ms ? `Latency: ${data.latency_ms}ms` : '',
      ].filter(Boolean)));
      console.log('');
    } catch (e) {
      spinner.fail(chalk.red(`Failed to send ${event}`));
      console.error(chalk.red(`  ${handleApiError(e).message}`));
      process.exit(1);
    }
  });

webhooksCommand.command('events').description('List all available webhook event types')
  .action(async () => {
    const events: Record<string, string[]> = {
      'Company': ['company.created', 'company.updated', 'company.deleted'],
      'API Keys': ['key.created', 'key.revoked', 'key.rotated'],
      'Subscriptions': ['subscription.created', 'subscription.updated', 'subscription.cancelled'],
      'Invoices': ['invoice.created', 'invoice.paid', 'invoice.failed'],
      'OAuth': ['oauth.authorized', 'oauth.revoked'],
      'Testing': ['webhook.test'],
    };

    console.log('');
    console.log(chalk.bold('  Available Webhook Events'));
    console.log('');
    for (const [category, evts] of Object.entries(events)) {
      console.log(`  ${chalk.bold(category)}`);
      for (const e of evts) {
        console.log(`    ${chalk.dim('•')} ${e}`);
      }
      console.log('');
    }
    console.log(chalk.dim('  Simulate: solid webhooks simulate <event>'));
    console.log('');
  });

webhooksCommand.addHelpText('after', `
Examples:
  $ solid webhooks list                            # All configured webhooks
  $ solid webhooks create --url https://me.ngrok.app/hook --event order.created
  $ solid webhooks listen                          # Local tunnel: stream events to your laptop
  $ solid webhooks test <id>                        # Fire a sample payload
  $ solid webhooks simulate order.created          # Offline event preview (no network)
  $ solid webhooks delete <id>

\`listen\` uses an authenticated tunnel keyed to your company_id. Events are
scoped to your tenant only.
`);
