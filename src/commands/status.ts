/**
 * Company status/overview command for Solid CLI
 *
 * Shows a summary of the authenticated company's setup:
 * phone, KB, website, services, tier — everything at a glance.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const statusCommand = new Command('status')
  .description('Show your business status and setup overview')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading business status...').start();

    try {
      const response = await apiClient.companyInfo();
      const company = (response.data as any).company;

      if (!company) {
        spinner.fail(chalk.red('Company not found'));
        return;
      }

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(company, null, 2));
        return;
      }

      spinner.stop();

      const ws = company.website_settings || {};

      console.log('');
      console.log(chalk.bold.white(`  ${company.name}`));
      console.log(chalk.dim(`  Company ID: ${company.id} | Tier: ${chalk.cyan(company.tier || 'starter')}`));
      console.log(chalk.dim(`  Industry: ${company.industry || 'not set'}`));
      console.log('');

      // Contact
      console.log(chalk.bold('  Contact'));
      console.log(`    Phone:   ${company.contact_phone ? chalk.green(company.contact_phone) : chalk.yellow('not set')}`);
      console.log(`    Email:   ${company.contact_email ? chalk.green(company.contact_email) : chalk.yellow('not set')}`);
      console.log(`    Address: ${company.location || chalk.dim('not set')}`);
      console.log('');

      // Website
      const slug = company.slug;
      console.log(chalk.bold('  Website'));
      console.log(`    URL:     ${slug ? chalk.cyan(`https://${slug}.solidnumber.com`) : chalk.yellow('not set')}`);
      console.log(`    Color:   ${ws.primary_color || '#6366f1'}`);
      console.log(`    Locale:  ${ws.default_locale || 'en'}`);
      console.log('');

      // Modules
      console.log(chalk.bold('  Modules'));
      const moduleStatus = (enabled: boolean) => enabled ? chalk.green('on') : chalk.dim('off');
      console.log(`    Services:     ${moduleStatus(ws.show_services !== false)}`);
      console.log(`    Products:     ${moduleStatus(ws.show_products !== false)}`);
      console.log(`    Appointments: ${moduleStatus(ws.show_appointments !== false)}`);
      console.log(`    Pricing:      ${moduleStatus(ws.show_pricing !== false)}`);
      console.log(`    Promotions:   ${moduleStatus(ws.show_promotions === true)}`);
      console.log('');

      // Quick tips
      console.log(chalk.dim('  Commands:'));
      console.log(chalk.dim('    solid kb list        — view knowledge base'));
      console.log(chalk.dim('    solid pages list     — view website pages'));
      console.log(chalk.dim('    solid services list  — view service catalog'));
      console.log(chalk.dim('    solid health         — check system health'));
      console.log('');

    } catch (error) {
      spinner.fail(chalk.red('Failed to load status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
