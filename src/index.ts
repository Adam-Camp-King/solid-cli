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
import { authCommand } from './commands/auth';
import { statusCommand } from './commands/status';
import { kbCommand } from './commands/kb';
import { pagesCommand } from './commands/pages';
import { servicesCommand } from './commands/services';
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
import { ui } from './lib/ui';

const program = new Command();

program
  .name('solid')
  .description('Solid# CLI — AI Business Infrastructure')
  .version('1.2.0')
  .configureHelp({
    sortSubcommands: false,
    sortOptions: false,
  });

// Register commands — grouped by purpose
// Core workflow
program.addCommand(authCommand);
program.addCommand(statusCommand);
program.addCommand(pullCommand);
program.addCommand(pushCommand);

// Business data
program.addCommand(kbCommand);
program.addCommand(pagesCommand);
program.addCommand(servicesCommand);

// CRM
program.addCommand(crmCommand);
program.addCommand(inboxCommand);
program.addCommand(scheduleCommand);

// AI
program.addCommand(vibeCommand);
program.addCommand(trainCommand);
program.addCommand(agentCommand);

// Voice
program.addCommand(voiceCommand);

// Commerce
program.addCommand(flowsCommand);
program.addCommand(brandCommand);
program.addCommand(widgetsCommand);
program.addCommand(inventoryCommand);

// Content
program.addCommand(blogCommand);

// Platform
program.addCommand(cloneCommand);
program.addCommand(integrationsCommand);
program.addCommand(antCommand);
program.addCommand(reportsCommand);
program.addCommand(docsCommand);
program.addCommand(healthCommand);

// Multi-company
program.addCommand(companyCommand);
program.addCommand(switchCommand);

// Dev tools
program.addCommand(devCommand);
program.addCommand(dropletCommand);

// ── Custom help screen ──────────────────────────────────────────────
program.addHelpText('beforeAll', () => {
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
      { cmd: 'solid ant import <code>', desc: 'Code import via Ant Farm' },
    ]),
    '',
    ui.divider(),
    '',
    `  ${chalk.dim('Docs:')}  ${chalk.cyan('solid docs')}      ${chalk.dim('Pull developer documentation')}`,
    `  ${chalk.dim('Help:')}  ${chalk.cyan('solid <cmd> -h')} ${chalk.dim('Help for any command')}`,
    `  ${chalk.dim('Web:')}   ${chalk.hex('#818cf8')('https://solidnumber.com/developers')}`,
    '',
  ];

  return sections.join('\n');
});

// Parse arguments
program.parse(process.argv);

// Show branded help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
