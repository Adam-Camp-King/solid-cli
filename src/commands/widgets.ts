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

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const widgetsCommand = new Command('widget')
  .description('Widgets — embeddable business widgets');

// List widgets
widgetsCommand
  .command('list')
  .alias('ls')
  .description('List widgets')
  .option('-t, --type <type>', 'Filter by type (booking, chat, form, review, cta)')
  .option('-s, --status <status>', 'Filter by status (active, inactive, draft)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Loading widgets...').start();

    try {
      const params: Record<string, unknown> = {};
      if (options.type) params.widget_type = options.type;
      if (options.status) params.status = options.status;

      const response = await apiClient.get('/api/v1/cli/widgets', { params });
      const data = response.data as any;
      const widgets = data.widgets || [];

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed(`${widgets.length} widgets`);

      if (widgets.length === 0) {
        console.log(chalk.dim('  No widgets found. Create one with `solid widget create <name>`'));
        return;
      }

      console.log('');
      const headers = ['ID', 'Name', 'Type', 'Status'];
      const rows = widgets.map((w: any) => [
        String(w.id).substring(0, 10),
        w.name.substring(0, 28),
        chalk.cyan(w.widget_type || w.type || '-'),
        w.status === 'active' ? chalk.green(w.status) :
          w.status === 'draft' ? chalk.dim(w.status) :
          chalk.yellow(w.status),
      ]);
      console.log(ui.table(headers, rows));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load widgets'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

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
      const data = response.data as any;

      if (options.json) {
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
      const data = response.data as any;

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
      const data = response.data as any;

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
