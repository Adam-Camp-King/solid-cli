/**
 * Company status/overview command for Solid CLI
 *
 * Shows a branded summary of the authenticated company's setup:
 * phone, KB, website, services, tier — everything at a glance.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

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
      const slug = company.slug;

      // ── Header ──────────────────────────────────────────────────
      console.log(ui.bannerSmall());
      console.log(ui.successBox(company.name, [
        `${chalk.dim('ID:')}     ${company.id}`,
        `${chalk.dim('Tier:')}   ${chalk.hex('#818cf8')(company.tier || 'starter')}`,
        `${chalk.dim('Industry:')} ${company.industry || 'not set'}`,
      ]));

      // ── Contact ─────────────────────────────────────────────────
      console.log(ui.header('Contact'));
      console.log(ui.label('Phone', company.contact_phone ? chalk.green(company.contact_phone) : chalk.yellow('not set')));
      console.log(ui.label('Email', company.contact_email ? chalk.green(company.contact_email) : chalk.yellow('not set')));
      console.log(ui.label('Address', company.location || chalk.dim('not set')));

      // ── Website ─────────────────────────────────────────────────
      console.log(ui.header('Website'));
      console.log(ui.label('URL', slug ? chalk.cyan(`https://${slug}.solidnumber.com`) : chalk.yellow('not set')));
      console.log(ui.label('Color', ws.primary_color || '#6366f1'));
      console.log(ui.label('Locale', ws.default_locale || 'en'));

      // ── Modules ─────────────────────────────────────────────────
      console.log(ui.header('Modules'));
      const on = chalk.green('●') + chalk.green(' on');
      const off = chalk.dim('○ off');
      console.log(ui.label('Services', ws.show_services !== false ? on : off));
      console.log(ui.label('Products', ws.show_products !== false ? on : off));
      console.log(ui.label('Appointments', ws.show_appointments !== false ? on : off));
      console.log(ui.label('Pricing', ws.show_pricing !== false ? on : off));
      console.log(ui.label('Promotions', ws.show_promotions === true ? on : off));

      // ── Quick Commands ──────────────────────────────────────────
      console.log('');
      console.log(ui.divider('Commands'));
      console.log('');
      console.log(ui.commandHelp([
        { cmd: 'solid pull', desc: 'Download your data as files' },
        { cmd: 'solid push', desc: 'Push local changes' },
        { cmd: 'solid kb list', desc: 'View knowledge base' },
        { cmd: 'solid pages list', desc: 'View website pages' },
        { cmd: 'solid train chat', desc: 'Chat with your AI agent' },
        { cmd: 'solid health', desc: 'Check system health' },
      ]));
      console.log('');

    } catch (error) {
      spinner.fail(chalk.red('Failed to load status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
