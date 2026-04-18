/**
 * Widgets — embeddable business widgets for Solid CLI
 *
 * Create and manage embeddable widgets (booking, chat, forms, etc.).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const widgetsCommand = new Command('widget')
  .description('Widgets — embeddable business widgets');

// List widgets — full scripting contract
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = widgetsCommand.command('list').alias('ls').description('List widgets');
  withListFlags(listCmd);
  listCmd.option('-t, --type <type>', 'Filter by type (booking, chat, form, review, cta)');
  listCmd.option('-s, --status <status>', 'Filter by status (active, inactive, draft)');
  listCmd.action(async (opts: { type?: string; status?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading widgets...',
      errorText: 'Failed to load widgets',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.type) params.widget_type = opts.type;
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/cli/widgets', { params })).data;
      },
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.widgets || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No widgets found. Create one with `solid widget create <name>`')); return; }
        console.log('');
        const rows = items.map((w) => [
          String(w.id).substring(0, 10),
          String(w.name || '').substring(0, 28),
          chalk.cyan(String(w.widget_type || w.type || '-')),
          w.status === 'active' ? chalk.green(String(w.status)) :
            w.status === 'draft' ? chalk.dim(String(w.status)) : chalk.yellow(String(w.status || '')),
        ]);
        console.log(ui.table(['ID', 'Name', 'Type', 'Status'], rows));
      },
    });
  });
}

// Get widget details
widgetsCommand
  .command('get <widget_id>')
  .description('Get widget details')
  .option('--json', 'Output as JSON')
  .action(async (widgetId, options) => {
    requireAuth();

    const spinner = ora('Loading widget...').start();

    try {
      const response = await apiClient.get(`/api/v1/cli/widgets/${widgetId}`);
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed('Widget loaded');
      console.log(ui.header(data.name || 'Widget Details'));
      console.log(ui.label('ID', String(data.id)));
      console.log(ui.label('Type', data.widget_type || data.type || '-'));
      console.log(ui.label('Status', data.status === 'active' ? chalk.green(data.status) : chalk.dim(data.status)));

      if (data.created_at) {
        console.log(ui.label('Created', new Date(data.created_at).toLocaleDateString()));
      }

      if (data.config) {
        console.log('');
        console.log(ui.divider('Configuration'));
        for (const [key, value] of Object.entries(data.config)) {
          console.log(ui.label(key, String(value)));
        }
      }

      if (data.agents && data.agents.length > 0) {
        console.log('');
        console.log(ui.divider('Agents'));
        for (const agent of data.agents) {
          console.log(`  ${chalk.cyan(agent.name || agent.agent_type)} ${chalk.dim(agent.role || '')}`);
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load widget'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Create widget
widgetsCommand
  .command('create <name>')
  .description('Create a widget')
  .option('-t, --type <type>', 'Widget type (booking, chat, form, review, cta)', 'chat')
  .option('--config <json>', 'Widget config as JSON')
  .option('--agents <ids>', 'Comma-separated agent IDs')
  .action(async (name, options) => {
    requireAuth();

    const spinner = ora('Creating widget...').start();

    try {
      const body: Record<string, unknown> = {
        name,
        widget_type: options.type,
      };

      if (options.config) {
        body.config = JSON.parse(options.config);
      }
      if (options.agents) {
        body.agents = options.agents.split(',').map((id: string) => parseInt(id.trim()));
      }

      const response = await apiClient.post('/api/v1/cli/widgets', body);
      const data = response.data as Record<string, any>;

      spinner.succeed(chalk.green('Widget created'));
      console.log('');
      console.log(ui.label('ID', String(data.id)));
      console.log(ui.label('Name', data.name || name));
      console.log(ui.label('Type', chalk.cyan(data.widget_type || options.type)));
      console.log(ui.label('Status', chalk.dim(data.status || 'draft')));

      console.log('');
      console.log(chalk.dim(`  Next: Run \`solid widget embed ${data.id}\` to get embed code`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create widget'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Update widget
widgetsCommand
  .command('update <widget_id>')
  .description('Update a widget (patch fields — unspecified fields are untouched)')
  .option('--name <name>', 'Widget name')
  .option('--config <json>', 'New config as JSON')
  .option('--agents <ids>', 'Comma-separated agent IDs')
  .option('--status <status>', 'active, paused, draft')
  .option('--json', 'Output as JSON')
  .action(async (widgetId: string, options: { name?: string; config?: string; agents?: string; status?: string; json?: boolean }) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (options.name) body.name = options.name;
    if (options.config) body.config = JSON.parse(options.config);
    if (options.agents) body.agents = options.agents.split(',').map((id) => parseInt(id.trim(), 10));
    if (options.status) body.status = options.status;
    if (!Object.keys(body).length) {
      console.error(chalk.red('No fields to update. Use --name, --config, --agents, or --status.'));
      process.exit(2);
    }
    const spinner = ora({ text: `Updating widget ${widgetId}...`, stream: process.stderr }).start();
    try {
      const response = await apiClient.patch(`/api/v1/cli/widgets/${widgetId}`, body);
      spinner.succeed(chalk.green('Widget updated'));
      if (isJsonOutput(options)) { console.log(JSON.stringify(response.data, null, 2)); return; }
    } catch (error) {
      spinner.fail(chalk.red('Failed to update widget'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

// Delete widget
widgetsCommand
  .command('delete <widget_id>')
  .description('Delete a widget (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (widgetId: string, options: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete widget ${widgetId}?`, { autoConfirm: Boolean(options.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const spinner = ora({ text: `Deleting widget ${widgetId}...`, stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/cli/widgets/${widgetId}`);
      spinner.succeed(chalk.green('Widget deleted'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete widget'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

// Get embed code
widgetsCommand
  .command('embed <widget_id>')
  .description('Get embed code for a widget')
  .option('-f, --format <format>', 'Embed format (html, react, script)', 'html')
  .action(async (widgetId, options) => {
    requireAuth();

    const spinner = ora('Generating embed code...').start();

    try {
      const response = await apiClient.get(`/api/v1/cli/widgets/${widgetId}/embed`, {
        params: { format: options.format },
      });
      const data = response.data as Record<string, any>;

      spinner.succeed(`Embed code (${options.format})`);
      console.log('');

      const code = data.embed_code || data.code || data.snippet;
      if (code) {
        console.log(chalk.dim('  Copy this into your page:'));
        console.log('');
        console.log(code);
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to generate embed code'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Activate widget
widgetsCommand
  .command('activate <widget_id>')
  .description('Activate a widget')
  .action(async (widgetId) => {
    requireAuth();

    const spinner = ora(`Activating widget ${widgetId}...`).start();

    try {
      await apiClient.post(`/api/v1/cli/widgets/${widgetId}/activate`);
      spinner.succeed(chalk.green(`Widget ${widgetId} activated`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to activate widget'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
