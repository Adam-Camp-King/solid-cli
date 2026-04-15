/**
 * Demo company for agency prospects
 *
 * solid demo plumber "Joe's Plumbing"    → Create a demo company
 * solid demo list                        → List active demos
 * solid demo delete <id>                 → Clean up demo
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const demoCommand = new Command('demo')
  .description('Create temporary demo companies for prospects');

demoCommand
  .command('create <template> <name>')
  .description('Spin up a demo company with an industry template')
  .option('--open', 'Open in browser after creation')
  .action(async (template, name, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Creating demo: ${name} (${template})...`).start();

    try {
      // Create company
      spinner.text = 'Creating company...';
      const createRes = await apiClient.companyCreate(name);
      const company = (createRes.data as Record<string, any>).company || createRes.data;
      const companyId = company.id || company.company_id;

      // Switch to it
      spinner.text = 'Applying template...';
      await apiClient.companySwitch(companyId);

      // Clone template
      await apiClient.templateClone(template);

      // Switch back to original
      const originalId = config.companyId;
      if (originalId && originalId !== companyId) {
        await apiClient.companySwitch(originalId).catch(() => {});
        config.companyId = originalId;
      }

      spinner.succeed(chalk.green(`Demo created: ${name}`));
      console.log('');
      console.log(`  ${chalk.bold('Company ID:')}  ${companyId}`);
      console.log(`  ${chalk.bold('Template:')}    ${template}`);
      console.log(`  ${chalk.bold('URL:')}         ${chalk.cyan(`https://${company.slug || name.toLowerCase().replace(/[^a-z0-9]/g, '-')}.solidnumber.com`)}`);
      console.log('');
      console.log(chalk.dim('  Show prospect: solid switch ' + companyId));
      console.log(chalk.dim('  Clean up:      solid demo delete ' + companyId));
      console.log('');

      if (options.open) {
        const { exec } = await import('child_process');
        const url = `https://${company.slug || 'demo'}.solidnumber.com`;
        exec(`open "${url}"`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to create demo'));
      console.error(handleApiError(error).message);
    }
  });

demoCommand
  .command('list')
  .description('List companies (find your demos)')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading companies...').start();

    try {
      const res = await apiClient.companiesList();
      const companies = res.data.companies || [];
      spinner.stop();

      console.log('');
      console.log(ui.header(`${companies.length} Companies`));
      console.log('');

      for (const c of companies) {
        const isActive = c.id === config.companyId;
        const marker = isActive ? chalk.green('● ') : '  ';
        console.log(`${marker}${chalk.bold(c.name)}  ${chalk.dim('ID:' + c.id)}  ${chalk.dim(c.role)}`);
      }

      console.log('');
      console.log(chalk.dim('  Delete a demo: solid demo delete <id>'));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed'));
      console.error(handleApiError(error).message);
    }
  });

demoCommand
  .command('delete <companyId>')
  .description('Delete a demo company')
  .action(async (companyId) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Deleting company ${companyId}...`).start();

    try {
      await apiClient.delete(`/api/v1/cli/companies/${companyId}`);
      spinner.succeed(chalk.green(`Company ${companyId} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete'));
      console.error(handleApiError(error).message);
      console.log(chalk.dim('  Note: Only demo/test companies can be deleted via CLI.'));
    }
  });
