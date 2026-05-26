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
import { isJsonOutput } from '../lib/json-output';

export const statusCommand = new Command('status')
  .description('Show your business status and setup overview')
  .option('--json', 'Output as JSON')
  .option('--full', 'Comprehensive snapshot: KB, pages, agents, payment, setup completeness')
  .option('--all', 'Show status for all companies (agencies)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    // Agency mode: show all companies
    if (options.all) {
      const spinner = ora('Loading all companies...').start();
      try {
        const companiesRes = await apiClient.companiesList();
        const companies = companiesRes.data.companies || [];
        spinner.stop();

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(companies, null, 2));
          return;
        }

        console.log('');
        console.log(ui.header(`All Companies (${companies.length})`));
        console.log('');
        for (const c of companies) {
          const isActive = c.id === config.companyId;
          const marker = isActive ? chalk.green('● ') : '  ';
          const name = isActive ? chalk.bold.green(c.name) : chalk.bold(c.name);
          console.log(`${marker}${name}  ${chalk.dim('ID:' + c.id)}  ${chalk.dim(c.role)}`);
        }
        console.log('');
        console.log(chalk.dim(`  Active: ${config.companyId}. Switch: solid switch <id>`));
        console.log(chalk.dim('  Full dashboard: solid dashboard'));
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed'));
        console.error(handleApiError(error).message);
        process.exit(1);
      }
      return;
    }

    // --full: comprehensive state introspection for agents
    if (options.full) {
      const spinner = ora('Gathering full state...').start();
      try {
        const [companyRes, pagesRes, kbRes, agentsRes] = await Promise.allSettled([
          apiClient.companyInfo(),
          apiClient.pagesList(),
          apiClient.kbSearch('', 1, 0),
          apiClient.agentsList(),
        ]);

        spinner.stop();

        const company = companyRes.status === 'fulfilled'
          ? (companyRes.value.data as Record<string, any>).company
          : null;
        const pages = pagesRes.status === 'fulfilled'
          ? ((pagesRes.value.data as Record<string, any>).pages || (pagesRes.value.data as Record<string, any>).items || [])
          : [];
        const kbData = kbRes.status === 'fulfilled' ? kbRes.value.data as Record<string, any> : {};
        const agents = agentsRes.status === 'fulfilled'
          ? ((agentsRes.value.data as Record<string, any>).agents || (agentsRes.value.data as Record<string, any>).items || [])
          : [];

        const ws = company?.website_settings || {};
        const fs = company?.feature_settings || {};
        const kbTotal = kbData.total ?? kbData.count ?? (kbData.results || []).length ?? 0;

        const snapshot = {
          company_id: company?.id ?? config.companyId,
          name: company?.name ?? null,
          slug: company?.slug ?? null,
          tier: company?.effective_tier || company?.tier || 'starter',
          industry: company?.industry ?? null,
          onboarding_status: company?.onboarding_status ?? null,

          has_site: !!(company?.slug),
          site_url: company?.slug ? `https://${company.slug}.solidnumber.com` : null,
          pages_count: Array.isArray(pages) ? pages.length : 0,
          kb_count: kbTotal,

          agents_configured: Array.isArray(agents)
            ? agents.map((a: any) => a.name || a.agent_type || a.id).filter(Boolean)
            : [],
          agents_count: Array.isArray(agents) ? agents.length : 0,

          modules: {
            services: ws.show_services !== false,
            products: ws.show_products !== false,
            appointments: ws.show_appointments !== false,
            pricing: ws.show_pricing !== false,
            promotions: ws.show_promotions === true,
          },

          contact: {
            phone: company?.contact_phone ?? null,
            email: company?.contact_email ?? null,
            address: company?.location ?? null,
          },

          setup_complete: {
            has_name: !!company?.name,
            has_phone: !!company?.contact_phone,
            has_email: !!company?.contact_email,
            has_site: !!company?.slug,
            has_kb: kbTotal > 0,
            has_pages: Array.isArray(pages) && pages.length > 0,
            payment_configured: !!company?.payment_setup_completed,
          },
        };

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(snapshot, null, 2));
          return;
        }

        // Human-readable full status
        console.log(ui.bannerSmall());
        console.log(chalk.bold(`  ${snapshot.name || 'Unknown'}`));
        console.log(chalk.dim(`  ID: ${snapshot.company_id}  ·  Tier: ${snapshot.tier}  ·  ${snapshot.industry || 'no industry'}`));
        console.log('');
        console.log(`  ${chalk.dim('Pages:')}    ${snapshot.pages_count}`);
        console.log(`  ${chalk.dim('KB:')}       ${snapshot.kb_count} entries`);
        console.log(`  ${chalk.dim('Agents:')}   ${snapshot.agents_count} (${snapshot.agents_configured.join(', ') || 'none'})`);
        console.log(`  ${chalk.dim('Site:')}     ${snapshot.site_url || chalk.yellow('not configured')}`);
        console.log(`  ${chalk.dim('Payment:')} ${snapshot.setup_complete.payment_configured ? chalk.green('configured') : chalk.yellow('not configured')}`);
        console.log('');

        const checks = Object.entries(snapshot.setup_complete);
        const done = checks.filter(([, v]) => v).length;
        console.log(`  ${chalk.dim('Setup:')}    ${done}/${checks.length} complete`);
        for (const [key, val] of checks) {
          console.log(`    ${val ? chalk.green('✓') : chalk.yellow('○')} ${key.replace(/_/g, ' ')}`);
        }
        console.log('');
        return;
      } catch (error) {
        spinner.fail(chalk.red('Failed to gather full state'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
        process.exit(1);
      }
    }

    const spinner = ora('Loading business status...').start();

    try {
      const response = await apiClient.companyInfo();
      const company = (response.data as Record<string, any>).company;

      if (!company) {
        spinner.fail(chalk.red('Company not found'));
        return;
      }

      if (isJsonOutput(options)) {
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
        // Prefer effective_tier (derived from feature_settings — reflects
        // what the company actually has access to right now). Falls back
        // to subscription tier column, then 'starter'.
        `${chalk.dim('Tier:')}   ${chalk.hex('#818cf8')(company.effective_tier || company.tier || 'starter')}`,
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

import { appendExamples as __ae_status } from '../lib/command-kit';
__ae_status(statusCommand, [
  { cmd: 'solid status',          why: 'Overall setup + progress' },
  { cmd: 'solid status --json',   why: 'Scriptable snapshot' },
]);
