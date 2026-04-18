#!/usr/bin/env node
/**
 * ================================================================================
 * Solid# CLI — AI Business Infrastructure
 * ================================================================================
 * @solidnumber/cli
 *
 * The command-line interface for building on Solid#.
 * Everything is scoped to your company_id. Safe and isolated.
 *
 * Install:  npm install -g @solidnumber/cli
 * Login:    solid auth login
 * Pull:     solid pull
 * Push:     solid push
 * Train:    solid train chat sarah
 * ================================================================================
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';

// Single source of truth for version — always reads from package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));

// T11.2 — activate global --dry-run BEFORE command parsing so the api-client
// interceptor sees the flag on the very first API call.
import { activateDryRunIfRequested, dryRunSummary, isDryRun } from './lib/dry-run';
activateDryRunIfRequested(process.argv);

// T11.3 — program-level --json flag that cascades to subcommands which
// don't explicitly declare their own --json option.
import { activateProgramJsonIfRequested } from './lib/json-output';
activateProgramJsonIfRequested(process.argv);
import { authCommand, whoamiCommand } from './commands/auth';
import { statusCommand } from './commands/status';
import { kbCommand } from './commands/kb';
import { pagesCommand } from './commands/pages';
import { siteCommand } from './commands/site';
import { servicesCommand } from './commands/services';
import { completionCommand } from './commands/completion';
import { integrationsCommand } from './commands/integrations';
import { vibeCommand } from './commands/vibe';
import { healthCommand } from './commands/health';
import { pullCommand } from './commands/pull';
import { pushCommand } from './commands/push';
import { docsCommand } from './commands/docs';
import { trainCommand } from './commands/train';
import { cloneCommand } from './commands/clone';
import { devCommand } from './commands/dev';
import { dropletCommand } from './commands/droplet';
import { companyCommand } from './commands/company';
import { switchCommand } from './commands/switch';
import { agentCommand } from './commands/agent';
import { antCommand } from './commands/ant';
import { connectCommand } from './commands/connect';
import { flowsCommand } from './commands/flows';
import { brandCommand } from './commands/brand';
import { widgetsCommand } from './commands/widgets';
import { crmCommand } from './commands/crm';
import { voiceCommand } from './commands/voice';
import { inboxCommand } from './commands/inbox';
import { scheduleCommand } from './commands/schedule';
import { reportsCommand } from './commands/reports';
import { inventoryCommand } from './commands/inventory';
import { blogCommand } from './commands/blog';
import { exploreCommand } from './commands/explore';
import { designCommand } from './commands/design';
import { visualCommand } from './commands/visual';
import { paymentCommand } from './commands/payment';
import { contextCommand } from './commands/context';
import { analyticsCommand } from './commands/analytics';
import { seoCommand } from './commands/seo';
import { insightsCommand } from './commands/insights';
import { llmsCommand } from './commands/llms';
import { accountingCommand } from './commands/accounting';
import { webhooksCommand } from './commands/webhooks';
import { supportCommand } from './commands/support';
import { exportCommand } from './commands/export';
import { billingCommand } from './commands/billing';
import { auditCommand } from './commands/audit';
import { notificationsCommand } from './commands/notifications';
import { domainsCommand } from './commands/domains';
import { openCommand } from './commands/open';
import { diffCommand } from './commands/diff';
import { serveCommand } from './commands/serve';
import { importCommand } from './commands/import';
import { watchCommand } from './commands/watch';
import { sandboxCommand } from './commands/sandbox';
import { historyCommand, rollbackCommand } from './commands/history';
import { logsCommand } from './commands/logs';
import { testCommand } from './commands/test';
import { deployCommand } from './commands/deploy';
import { migrateCommand } from './commands/migrate';
import { dashboardCommand } from './commands/dashboard';
import { apiCommand } from './commands/api';
import { proposalCommand } from './commands/proposal';
import { addWebhookListenCommand } from './commands/webhooks-listen';
import { demoCommand } from './commands/demo';
import { initCommand } from './commands/init';
import { leadsCommand } from './commands/leads';
import { productsCommand } from './commands/products';
import { ordersCommand } from './commands/orders';
import { ecommerceCommand } from './commands/ecommerce';
import { marketplaceCommand } from './commands/marketplace';
import { usersCommand } from './commands/users';
import { keysCommand } from './commands/keys';
import { storageCommand } from './commands/storage';
import { onboardingCommand } from './commands/onboarding';
import { chainsCommand } from './commands/chains';
import { draftsCommand } from './commands/drafts';
import { publishCommand } from './commands/publish';
import { inboundCommand } from './commands/inbound';
import { formsCommand } from './commands/forms';
import { emailsCommand } from './commands/emails';
import { landingCommand } from './commands/landing';
import { chatWidgetsCommand } from './commands/chat_widgets';
import { paymentLinksCommand } from './commands/payment_links';
import { subscriptionsCommand } from './commands/subscriptions';
import { schemaCommand } from './commands/schema';
import { ui } from './lib/ui';

// Check for updates (non-blocking, runs in background)
import updateNotifier from 'update-notifier';
updateNotifier({ pkg, updateCheckInterval: 1000 * 60 * 60 * 4 }).notify({
  message: `Update available: {currentVersion} → {latestVersion}\nRun {updateCommand} to update`,
});

const program = new Command();

program
  .name('solid')
  .description('Solid# CLI — AI Business Infrastructure')
  .version(pkg.version)
  .option('--dry-run', 'Preview every mutation without touching the server (T11). Global. Also: SOLID_DRY_RUN=1')
  .option('--json', 'Prefer JSON output (if the subcommand supports it). Also: SOLID_JSON=1')
  .option('--token <token>', 'Auth token for this invocation only (never persisted). Overrides env/config.')
  .option('--no-spinner', 'Disable the progress spinner (same as --quiet)')
  .option('--raw', 'Clean pipeline output: no spinner, no decoration (alias for --quiet)')
  .option('--no-color', 'Disable all ANSI colors (also: NO_COLOR=1)')
  .option('--output <file>', 'Write JSON output to this file instead of stdout (creates parent dirs)')
  .option('--format <fmt>', 'Output format for lists: json | csv | tsv (subcommand must support it)')
  .option('--sort-by <field>', 'Sort list output by this field (subcommand must support it)')
  .option('--order <asc|desc>', 'Sort direction — asc (default) or desc')
  .configureHelp({
    sortSubcommands: false,
    sortOptions: false,
  });

// Honor --no-color / NO_COLOR by disabling chalk globally BEFORE any
// command runs. chalk already honors NO_COLOR env var, but the --no-color
// flag needs this explicit hook since we consume it before parsing.
if (process.argv.includes('--no-color') || process.env.NO_COLOR) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const chalkMod = require('chalk');
  if (chalkMod && typeof chalkMod === 'object') {
    // chalk v4: set level on the default export; chalk v5: same API.
    if ('level' in chalkMod) chalkMod.level = 0;
    if (chalkMod.default && 'level' in chalkMod.default) chalkMod.default.level = 0;
  }
}

// Pre-capture --output so command-kit run() can stream JSON payloads to
// a file instead of stdout. Per-subcommand --output also works when the
// subcommand wires it explicitly.
{
  const outIdx = process.argv.findIndex((a) => a === '--output' || a.startsWith('--output='));
  if (outIdx !== -1) {
    const val = process.argv[outIdx].includes('=')
      ? process.argv[outIdx].split('=')[1]
      : process.argv[outIdx + 1];
    if (val) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const ck = require('./lib/command-kit');
      if (ck && typeof ck.setOutputFile === 'function') ck.setOutputFile(val);
    }
  }
}

// Same for --format / --sort-by / --order (list-UX hints; subcommands
// opt in via helpers in command-kit).
{
  const grab = (flag: string): string | null => {
    const i = process.argv.findIndex((a) => a === flag || a.startsWith(flag + '='));
    if (i === -1) return null;
    return process.argv[i].includes('=') ? process.argv[i].split('=')[1] : process.argv[i + 1] ?? null;
  };
  const format = grab('--format');
  const sortBy = grab('--sort-by');
  const order = grab('--order');
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const ck = require('./lib/command-kit');
  if (format && typeof ck.setListFormat === 'function') ck.setListFormat(format);
  if (sortBy && typeof ck.setListSortBy === 'function') ck.setListSortBy(sortBy);
  if (order && typeof ck.setListOrder === 'function') ck.setListOrder(order);
}

// Pre-parse --token before any subcommand runs so the api-client sees it
// on the first request. Same trick as --dry-run / --json above.
{
  const i = process.argv.findIndex((a) => a === '--token' || a.startsWith('--token='));
  if (i !== -1) {
    const val = process.argv[i].includes('=')
      ? process.argv[i].split('=')[1]
      : process.argv[i + 1];
    if (val) {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { setOverrideToken } = require('./lib/api-client');
      setOverrideToken(val);
    }
  }
}

// Register commands — grouped by purpose
// Onboarding (programmatic client provisioning)
program.addCommand(onboardingCommand);

// Core workflow
program.addCommand(authCommand);
program.addCommand(whoamiCommand);
program.addCommand(statusCommand);
program.addCommand(pullCommand);
program.addCommand(pushCommand);
program.addCommand(diffCommand);
program.addCommand(serveCommand);
program.addCommand(openCommand);
program.addCommand(importCommand);
program.addCommand(watchCommand);
program.addCommand(sandboxCommand);
program.addCommand(historyCommand);
program.addCommand(rollbackCommand);
program.addCommand(deployCommand);
program.addCommand(migrateCommand);
program.addCommand(logsCommand);
program.addCommand(testCommand);

// Business data
program.addCommand(kbCommand);
program.addCommand(pagesCommand);
program.addCommand(siteCommand);
program.addCommand(servicesCommand);
program.addCommand(schemaCommand);

// CRM
program.addCommand(crmCommand);
program.addCommand(leadsCommand);
program.addCommand(inboxCommand);
program.addCommand(scheduleCommand);

// Team & access
program.addCommand(usersCommand);
program.addCommand(keysCommand);

// Storage / files
program.addCommand(storageCommand);

// AI
program.addCommand(vibeCommand);
program.addCommand(trainCommand);
program.addCommand(agentCommand);
program.addCommand(chainsCommand);
program.addCommand(draftsCommand);
program.addCommand(publishCommand);
program.addCommand(inboundCommand);

// Voice
program.addCommand(voiceCommand);

// Commerce
program.addCommand(flowsCommand);
program.addCommand(brandCommand);
program.addCommand(widgetsCommand);
program.addCommand(inventoryCommand);
program.addCommand(productsCommand);
program.addCommand(ordersCommand);
program.addCommand(ecommerceCommand);
program.addCommand(marketplaceCommand);
program.addCommand(paymentCommand);

// Content
program.addCommand(blogCommand);
program.addCommand(landingCommand);
program.addCommand(chatWidgetsCommand);
program.addCommand(formsCommand);

// Email
program.addCommand(emailsCommand);

// Billing / payments
program.addCommand(paymentLinksCommand);
program.addCommand(subscriptionsCommand);

// Design
program.addCommand(designCommand);
program.addCommand(visualCommand);

// Platform
program.addCommand(cloneCommand);
program.addCommand(integrationsCommand);
program.addCommand(connectCommand);
program.addCommand(antCommand);
program.addCommand(reportsCommand);
program.addCommand(docsCommand);
program.addCommand(healthCommand);
program.addCommand(completionCommand);

// Multi-company
program.addCommand(companyCommand);
program.addCommand(switchCommand);

// Discovery
program.addCommand(exploreCommand);

// AI Context & Discovery
program.addCommand(contextCommand);
program.addCommand(llmsCommand);

// Analytics & Insights
program.addCommand(analyticsCommand);
program.addCommand(seoCommand);
program.addCommand(insightsCommand);

// Integrations & Operations
program.addCommand(accountingCommand);
program.addCommand(webhooksCommand);
program.addCommand(supportCommand);
program.addCommand(exportCommand);
program.addCommand(billingCommand);
program.addCommand(auditCommand);
program.addCommand(notificationsCommand);
program.addCommand(domainsCommand);

// Dev tools
program.addCommand(devCommand);
program.addCommand(dropletCommand);

// Agency & developer tools
program.addCommand(dashboardCommand);
program.addCommand(apiCommand);
program.addCommand(proposalCommand);

program.addCommand(demoCommand);
program.addCommand(initCommand);

// Wire webhook listen/test into existing webhooks command
addWebhookListenCommand(webhooksCommand);

// ── Custom help screen ──────────────────────────────────────────────
program.addHelpText('before', () => {
  return ui.banner();
});

program.addHelpText('after', () => {
  const sections = [
    '',
    ui.divider('Quick Start'),
    '',
    ui.commandHelp([
      { cmd: 'solid auth login', desc: 'Login to your company' },
      { cmd: 'solid clone plumber', desc: 'Scaffold from 52 industry templates' },
      { cmd: 'solid pull', desc: 'Download business data as local files' },
      { cmd: 'solid push', desc: 'Push local changes to production' },
      { cmd: 'solid history', desc: 'View version history for pages & KB' },
      { cmd: 'solid rollback', desc: 'Rollback to a previous version' },
      { cmd: 'solid deploy', desc: 'Preview deployment with shareable URL' },
      { cmd: 'solid migrate', desc: 'Copy pages/KB between companies' },
      { cmd: 'solid train chat', desc: 'Chat with your AI agent' },
      { cmd: 'solid switch', desc: 'Switch between companies (agencies)' },
    ]),
    '',
    ui.divider('Run Your Business'),
    '',
    ui.commandHelp([
      { cmd: 'solid crm contacts', desc: 'Contacts, deals, tasks, pipeline' },
      { cmd: 'solid inbox', desc: 'Unified inbox (email, SMS, all channels)' },
      { cmd: 'solid schedule list', desc: 'Appointments and calendar' },
      { cmd: 'solid voice calls', desc: 'Call logs, voicemail, voice AI config' },
      { cmd: 'solid inventory list', desc: 'Inventory and stock management' },
      { cmd: 'solid reports revenue', desc: 'Revenue, analytics, CSV export' },
    ]),
    '',
    ui.divider('Agent Management'),
    '',
    ui.commandHelp([
      { cmd: 'solid agent dashboard', desc: 'Agent overview + telemetry' },
      { cmd: 'solid agent soul sarah', desc: 'View identity, config, performance' },
      { cmd: 'solid agent chat sarah "Hi"', desc: 'Chat with any agent' },
      { cmd: 'solid agent mission "..."', desc: 'Multi-agent mission (ADA coordinates)' },
    ]),
    '',
    ui.divider('Commerce & Content'),
    '',
    ui.commandHelp([
      { cmd: 'solid flow list', desc: 'Commerce flows' },
      { cmd: 'solid brand get', desc: 'Brand identity' },
      { cmd: 'solid widget list', desc: 'Embeddable widgets' },
      { cmd: 'solid blog list', desc: 'Blog posts + SEO audit' },
      { cmd: 'solid connect figma <url>', desc: 'Import external content' },
      { cmd: 'solid ant import <code>', desc: 'Code import via Ant Farm' },
    ]),
    '',
    ui.divider('AI Integration'),
    '',
    ui.commandHelp([
      { cmd: 'solid context --claude', desc: 'Give Claude full company knowledge' },
      { cmd: 'solid context --cursor', desc: 'Give Cursor full company knowledge' },
      { cmd: 'solid llms preview', desc: 'Preview what AI shopping agents see' },
      { cmd: 'solid llms check', desc: 'AI commerce readiness score' },
    ]),
    '',
    ui.divider('Analytics & SEO'),
    '',
    ui.commandHelp([
      { cmd: 'solid analytics dashboard', desc: 'Revenue, customers, transactions' },
      { cmd: 'solid analytics mcp-traffic', desc: 'Who is crawling your site (AI bots)' },
      { cmd: 'solid seo audit', desc: 'Full local SEO audit' },
      { cmd: 'solid seo rank', desc: 'Search rankings' },
      { cmd: 'solid insights list', desc: 'AI-generated conversation insights' },
    ]),
    '',
    ui.divider(),
    '',
    `  ${chalk.dim('Docs:')}    ${chalk.cyan('solid docs')}      ${chalk.dim('Pull developer documentation')}`,
    `  ${chalk.dim('Help:')}    ${chalk.cyan('solid <cmd> -h')} ${chalk.dim('Help for any command')}`,
    `  ${chalk.dim('Portal:')}  ${chalk.hex('#818cf8')('https://developers.solidnumber.com')}`,
    `  ${chalk.dim('API:')}     ${chalk.hex('#818cf8')('https://solidnumber.com/docs/api')}`,
    `  ${chalk.dim('SDK:')}     ${chalk.hex('#818cf8')('https://solidnumber.com/docs/sdks')}`,
    '',
  ];

  return sections.join('\n');
});

// Parse arguments
program.parse(process.argv);

// T11.2 — on exit, print a dry-run summary if any mutations were intercepted.
process.on('beforeExit', () => {
  if (isDryRun()) {
    const summary = dryRunSummary();
    if (summary) process.stderr.write(summary);
  }
});

// Show branded help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
