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
import { ui } from './lib/ui';

const program = new Command();

program
  .name('solid')
  .description('Solid# CLI — AI Business Infrastructure')
  .version('1.0.0')
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

// AI
program.addCommand(vibeCommand);
program.addCommand(trainCommand);

// Platform
program.addCommand(cloneCommand);
program.addCommand(integrationsCommand);
program.addCommand(docsCommand);
program.addCommand(healthCommand);

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
    ]),
    '',
    ui.divider('Workflow'),
    '',
    `  ${chalk.dim('1.')} ${chalk.cyan('solid pull')}     ${chalk.dim('→ Download pages, KB, services')}`,
    `  ${chalk.dim('2.')} ${chalk.dim('Edit files')}     ${chalk.dim('→ VS Code, Cursor, any editor')}`,
    `  ${chalk.dim('3.')} ${chalk.cyan('solid push')}     ${chalk.dim('→ Deploy changes instantly')}`,
    `  ${chalk.dim('4.')} ${chalk.cyan('solid vibe')}     ${chalk.dim('→ "Add a hero section" (natural language)')}`,
    '',
    ui.divider('AI Training'),
    '',
    ui.commandHelp([
      { cmd: 'solid train import ./kb/', desc: 'Bulk import knowledge base' },
      { cmd: 'solid train chat sarah', desc: 'Test your AI agent interactively' },
      { cmd: 'solid train status', desc: 'See KB coverage and gaps' },
      { cmd: 'solid train add -t "Title"', desc: 'Quick-add a KB entry' },
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
