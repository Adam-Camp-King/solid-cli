/**
 * Development commands for Solid CLI — Sandbox Engine
 *
 * Full module development lifecycle:
 *   solid dev create --company 47 --name "mortgage-dashboard"
 *   solid dev list --company 47
 *   solid dev status --company 47 --name "mortgage-dashboard"
 *   solid dev validate --company 47 --name "mortgage-dashboard"
 *   solid dev snapshot --company 47
 *   solid dev deploy --company 47 --name "mortgage-dashboard"
 *   solid dev disable --company 47 --name "mortgage-dashboard"
 *   solid dev cleanup --company 47 --name "mortgage-dashboard"
 *
 * See: Owners-Manual/15-AI-Sandbox-Engine/05-SOLID-DEV-CLI.md
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const devCommand = new Command('dev')
  .description('Sandbox engine — create, test, deploy custom modules per company');

// ─── Create ─────────────────────────────────────────────────────────

devCommand
  .command('create')
  .description('Create a new custom module sandbox')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name (lowercase, hyphens)')
  .option('-d, --description <text>', 'Module description')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const companyId = parseInt(options.company, 10);
    if (companyId <= 3) { console.error(chalk.red('Company ID must be > 3 (1-3 are reserved).')); process.exit(1); }

    const spinner = ora(`Creating module "${options.name}" for company ${companyId}...`).start();

    try {
      const res = await apiClient.post<any>('/api/v1/sandbox/create', {
        company_id: companyId,
        module_name: options.name,
        description: options.description || '',
      });

      spinner.succeed(chalk.green('Module created'));

      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }

      const d = res.data as Record<string, any>;
      console.log('');
      console.log(ui.successBox('Sandbox Created', [
        `Folder:  ${d.folder_name}`,
        `Company: ${companyId}`,
        `Module:  ${options.name}`,
        `Version: 0.1.0`,
      ]));
      console.log('');
      console.log(chalk.dim('Next steps:'));
      for (const step of d.next_steps || []) {
        console.log(chalk.dim(`  ${step}`));
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── List ───────────────────────────────────────────────────────────

devCommand
  .command('list')
  .description('List custom modules for a company')
  .requiredOption('-c, --company <id>', 'Company ID')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Loading modules...').start();
    try {
      const res = await apiClient.get<any>(`/sandbox/list/${options.company}`);
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }

      const modules = (res.data as Record<string, any>)?.modules || [];
      console.log('');
      console.log(chalk.bold(`  Modules for Company ${options.company} (${modules.length})`));
      console.log('');

      if (modules.length === 0) {
        console.log(chalk.dim('  No modules yet. Create one with: solid dev create -c <id> -n <name>'));
      } else {
        const headers = ['Module', 'Version', 'Status', 'Description'];
        const rows = modules.map((m: any) => [
          m.module_name,
          m.version,
          m.enabled ? chalk.green('enabled') : chalk.yellow('disabled'),
          (m.description || '').slice(0, 40),
        ]);
        console.log(ui.table(headers, rows));
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Status ─────────────────────────────────────────────────────────

devCommand
  .command('status')
  .description('Check module status')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Checking status...').start();
    try {
      const res = await apiClient.get<any>(`/sandbox/status/${options.company}/${options.name}`);
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }

      const d = res.data as Record<string, any>;
      if (!d.exists) {
        console.log(chalk.yellow(`  Module "${options.name}" not found for company ${options.company}`));
        return;
      }

      console.log('');
      console.log(ui.header(`Module: ${d.module_name}`));
      console.log(ui.label('Folder', d.folder_name));
      console.log(ui.label('Company', String(d.company_id)));
      console.log(ui.label('Version', d.version || 'unknown'));
      console.log(ui.label('Status', d.enabled ? chalk.green('enabled') : chalk.yellow('disabled')));
      console.log(ui.label('Routes', String(d.route_count)));
      console.log(ui.label('Backend', d.has_backend ? chalk.green('yes') : chalk.dim('no')));
      console.log(ui.label('Frontend', d.has_frontend ? chalk.green('yes') : chalk.dim('no')));
      console.log(ui.label('Tests', d.has_tests ? chalk.green('yes') : chalk.dim('no')));
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Validate ───────────────────────────────────────────────────────

devCommand
  .command('validate')
  .alias('check')
  .description('Run 6-checkpoint security validation on a module')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Validating...').start();
    try {
      const res = await apiClient.get<any>(`/sandbox/validate/${options.company}/${options.name}`);
      spinner.stop();

      const d = res.data as Record<string, any>;
      if (d.valid) {
        console.log(chalk.green(`  ✓ Module "${options.name}" passed all 6 checkpoints`));
      } else {
        console.log(chalk.red(`  ✗ Module "${options.name}" failed validation`));
        for (const err of d.errors || []) {
          console.log(chalk.red(`    Checkpoint ${err.checkpoint}: ${err.message}`));
        }
      }
      for (const warn of d.warnings || []) {
        console.log(chalk.yellow(`    Warning: ${warn.message}`));
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Snapshot ───────────────────────────────────────────────────────

devCommand
  .command('snapshot')
  .description('Create a dev database snapshot of company data')
  .requiredOption('-c, --company <id>', 'Company ID')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora(`Creating snapshot for company ${options.company}...`).start();
    try {
      const res = await apiClient.post<any>(`/sandbox/snapshot/${options.company}`, {});
      const d = res.data as Record<string, any>;

      if (d.success) {
        spinner.succeed(chalk.green(`Snapshot created: ${d.sandbox_db}`));
        console.log(chalk.dim(`  Tables: ${d.tables_copied}  Rows: ${d.rows_copied}  Time: ${d.duration_seconds}s`));
      } else {
        spinner.fail(chalk.red('Snapshot failed'));
        for (const err of d.errors || []) {
          console.log(chalk.red(`  ${err}`));
        }
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Deploy ─────────────────────────────────────────────────────────

devCommand
  .command('deploy')
  .description('Deploy module to production (validates first)')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora(`Deploying "${options.name}" for company ${options.company}...`).start();
    try {
      const res = await apiClient.post<any>('/api/v1/sandbox/deploy', {
        company_id: parseInt(options.company, 10),
        module_name: options.name,
      });

      const d = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Deployed: ${options.name} v${d.version}`));
      console.log(chalk.dim(`  Enabled: ${d.enabled}  Routes available at: /api/v1/custom/${options.name}/*`));
    } catch (e: any) {
      spinner.fail(chalk.red('Deploy failed'));
      const err = handleApiError(e);
      if (err.message?.includes('Validation failed')) {
        const detail = (e as any)?.response?.data?.detail;
        if (detail?.errors) {
          for (const v of detail.errors) {
            console.log(chalk.red(`  Checkpoint ${v.checkpoint}: ${v.message}`));
          }
        }
      } else {
        console.error(chalk.red(`  ${err.message}`));
      }
    }
  });

// ─── Disable ────────────────────────────────────────────────────────

devCommand
  .command('disable')
  .description('Disable a module without deleting it')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Disabling module...').start();
    try {
      await apiClient.post(`/sandbox/disable/${options.company}/${options.name}`, {});
      spinner.succeed(chalk.green(`Module "${options.name}" disabled`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Enable (re-deploy) ─────────────────────────────────────────────

devCommand
  .command('enable')
  .description('Re-enable a disabled module')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Enabling module...').start();
    try {
      await apiClient.post('/api/v1/sandbox/deploy', {
        company_id: parseInt(options.company, 10),
        module_name: options.name,
      });
      spinner.succeed(chalk.green(`Module "${options.name}" enabled`));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Cleanup ────────────────────────────────────────────────────────

devCommand
  .command('cleanup')
  .description('Delete a module completely (directory + dev database)')
  .requiredOption('-c, --company <id>', 'Company ID')
  .requiredOption('-n, --name <name>', 'Module name')
  .option('-y, --yes', 'Skip confirmation')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    if (!options.yes) {
      const readline = await import('readline');
      const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
      const answer = await new Promise<string>((resolve) => {
        rl.question(chalk.yellow(`  Delete module "${options.name}" for company ${options.company}? This cannot be undone. (y/N) `), resolve);
      });
      rl.close();
      if (!answer.toLowerCase().startsWith('y')) {
        console.log(chalk.dim('  Cancelled.'));
        return;
      }
    }

    const spinner = ora('Cleaning up...').start();
    try {
      const res = await apiClient.delete<any>(`/sandbox/cleanup/${options.company}/${options.name}`);
      spinner.succeed(chalk.green((res.data as Record<string, any>)?.message || 'Cleaned up'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });

// ─── Modules system status ──────────────────────────────────────────

devCommand
  .command('system')
  .description('Show module system status (all companies)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }

    const spinner = ora('Loading system status...').start();
    try {
      const res = await apiClient.get<any>('/api/v1/modules/admin/status');
      spinner.stop();

      if (options.json) { console.log(JSON.stringify(res.data, null, 2)); return; }

      const d = res.data as Record<string, any>;
      console.log('');
      console.log(chalk.bold(`  Module System`));
      console.log(chalk.dim(`  Loaded: ${d.loaded_count} modules  Cache: ${d.cache_backend}`));
      console.log('');

      if (d.modules?.length > 0) {
        const headers = ['Module', 'Company', 'Version', 'Status', 'Routes', 'Prefix'];
        const rows = d.modules.map((m: any) => [
          m.module_name,
          String(m.company_id),
          m.version,
          m.enabled ? chalk.green('on') : chalk.dim('off'),
          String(m.route_count),
          chalk.dim(m.route_prefix),
        ]);
        console.log(ui.table(headers, rows));
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); }
  });
