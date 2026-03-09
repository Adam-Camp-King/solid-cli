/**
 * Ant Farm — Code import system for Solid CLI
 *
 * Import, analyze, and manage code imports into your business.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
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

export const antCommand = new Command('ant')
  .description('Ant Farm — code import system');

// Import code
antCommand
  .command('import <code>')
  .description('Import code into your business')
  .option('--format-hint <format>', 'Format hint (html, css, react, vue, etc.)')
  .option('--source-url <url>', 'Source URL for attribution')
  .action(async (code, options) => {
    requireAuth();

    const spinner = ora('Analyzing and importing code...').start();

    try {
      const body: Record<string, unknown> = { code };
      if (options.formatHint) body.format_hint = options.formatHint;
      if (options.sourceUrl) body.source_url = options.sourceUrl;

      const response = await apiClient.post('/api/v1/cli/ant/import', body);
      const data = response.data as any;

      spinner.succeed(chalk.green('Import created'));
      console.log('');
      console.log(ui.label('Import ID', data.import_id || data.id));
      console.log(ui.label('Status', data.status || 'pending'));
      console.log(ui.label('Format', data.detected_format || data.format || 'auto'));

      if (data.preview) {
        console.log('');
        console.log(ui.header('Preview'));
        console.log(chalk.dim(`  ${data.preview.substring(0, 200)}`));
      }

      console.log('');
      console.log(chalk.dim(`  Next: Run \`solid ant execute ${data.import_id || data.id}\` to apply`));
    } catch (error) {
      spinner.fail(chalk.red('Import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Import from URL
antCommand
  .command('import-url <url>')
  .description('Fetch URL and import HTML')
  .action(async (url) => {
    requireAuth();

    const spinner = ora(`Fetching ${url}...`).start();

    try {
      const response = await apiClient.post('/api/v1/cli/ant/import-url', { url });
      const data = response.data as any;

      spinner.succeed(chalk.green('URL imported'));
      console.log('');
      console.log(ui.label('Import ID', data.import_id || data.id));
      console.log(ui.label('Status', data.status || 'pending'));
      console.log(ui.label('Source', url));

      if (data.elements_found) {
        console.log(ui.label('Elements', String(data.elements_found)));
      }

      console.log('');
      console.log(chalk.dim(`  Next: Run \`solid ant execute ${data.import_id || data.id}\` to apply`));
    } catch (error) {
      spinner.fail(chalk.red('URL import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Execute import
antCommand
  .command('execute <import_id>')
  .description('Execute a previewed import')
  .option('--modifications <json>', 'JSON modifications to apply before executing')
  .action(async (importId, options) => {
    requireAuth();

    const spinner = ora(`Executing import ${importId}...`).start();

    try {
      const body: Record<string, unknown> = { import_id: importId };
      if (options.modifications) {
        body.modifications = JSON.parse(options.modifications);
      }

      const response = await apiClient.post('/api/v1/cli/ant/execute', body);
      const data = response.data as any;

      spinner.succeed(chalk.green('Import executed'));
      console.log('');
      console.log(ui.label('Status', data.status || 'completed'));

      if (data.created) {
        console.log(ui.label('Created', JSON.stringify(data.created)));
      }
      if (data.warnings && data.warnings.length > 0) {
        console.log('');
        for (const warning of data.warnings) {
          console.log(chalk.yellow(`  ! ${warning}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Execution failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// List imports
antCommand
  .command('list')
  .alias('ls')
  .description('List imports')
  .option('-s, --status <status>', 'Filter by status (pending, completed, rolled_back)')
  .option('-l, --limit <number>', 'Number of results', '20')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading imports...').start();
    try {
      const params: Record<string, unknown> = {};
      if (options.status) params.status = options.status;
      if (options.limit) params.limit = parseInt(options.limit);

      const response = await apiClient.get('/api/v1/cli/ant/imports', { params });
      const data = response.data as any;
      const imports = data.imports || [];

      spinner.succeed(`${imports.length} imports`);

      if (imports.length === 0) {
        console.log(chalk.dim('  No imports found.'));
        return;
      }

      console.log('');
      const headers = ['ID', 'Format', 'Status', 'Created'];
      const rows = imports.map((imp: any) => [
        String(imp.id || imp.import_id).substring(0, 12),
        imp.format || imp.detected_format || 'auto',
        imp.status === 'completed' ? chalk.green(imp.status) :
          imp.status === 'rolled_back' ? chalk.red(imp.status) :
          chalk.yellow(imp.status),
        imp.created_at ? new Date(imp.created_at).toLocaleDateString() : '-',
      ]);
      console.log(ui.table(headers, rows));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load imports'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Get import details
antCommand
  .command('get <import_id>')
  .description('Get import details')
  .option('--json', 'Output as JSON')
  .action(async (importId, options) => {
    requireAuth();
    const spinner = ora('Loading import...').start();
    try {
      const response = await apiClient.get(`/api/v1/cli/ant/imports/${importId}`);
      const data = response.data as any;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed('Import loaded');
      console.log(ui.header('Import Details'));
      console.log(ui.label('ID', String(data.id || data.import_id)));
      console.log(ui.label('Status', data.status));
      console.log(ui.label('Format', data.format || data.detected_format || 'auto'));

      if (data.source_url) {
        console.log(ui.label('Source URL', data.source_url));
      }
      if (data.created_at) {
        console.log(ui.label('Created', new Date(data.created_at).toLocaleString()));
      }
      if (data.executed_at) {
        console.log(ui.label('Executed', new Date(data.executed_at).toLocaleString()));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load import'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Rollback import
antCommand
  .command('rollback <import_id>')
  .description('Rollback a completed import')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (importId, options) => {
    requireAuth();

    if (!options.yes) {
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Rollback import ${importId}? This will undo all changes.`,
        default: false,
      }]);
      if (!confirm) {
        console.log(chalk.dim('Rollback cancelled'));
        return;
      }
    }

    const spinner = ora('Rolling back import...').start();

    try {
      const response = await apiClient.post(`/api/v1/cli/ant/imports/${importId}/rollback`);
      const data = response.data as any;

      spinner.succeed(chalk.green('Import rolled back'));
      if (data.rolled_back) {
        console.log(chalk.dim(`  Reverted: ${JSON.stringify(data.rolled_back)}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Rollback failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Analyze code
antCommand
  .command('analyze <code>')
  .description('Classify code without creating an import')
  .option('--format-hint <format>', 'Format hint')
  .action(async (code, options) => {
    requireAuth();
    const spinner = ora('Analyzing code...').start();
    try {
      const body: Record<string, unknown> = { code };
      if (options.formatHint) body.format_hint = options.formatHint;

      const response = await apiClient.post('/api/v1/cli/ant/analyze', body);
      const data = response.data as any;

      spinner.succeed('Analysis complete');
      console.log(ui.header('Code Analysis'));
      console.log(ui.label('Format', data.format || data.detected_format || 'unknown'));
      console.log(ui.label('Language', data.language || 'unknown'));
      console.log(ui.label('Confidence', data.confidence ? `${(data.confidence * 100).toFixed(0)}%` : '-'));
      if (data.components && data.components.length > 0) {
        console.log('');
        console.log(ui.divider('Components'));
        for (const comp of data.components) {
          console.log(`  ${chalk.cyan(comp.type || comp.name)} ${chalk.dim(comp.description || '')}`);
        }
      }
      if (data.suggestions && data.suggestions.length > 0) {
        console.log('');
        console.log(ui.divider('Suggestions'));
        for (const suggestion of data.suggestions) {
          console.log(chalk.dim(`  - ${suggestion}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
