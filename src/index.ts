#!/usr/bin/env node
/**
 * ================================================================================
 * Solid CLI - Main Entry Point
 * ================================================================================
 * @solidnumber/cli
 *
 * Command-line interface for Solid# platform:
 * - Authentication (scoped to your company_id)
 * - Business status overview
 * - Knowledge base management
 * - Website page management
 * - Service catalog
 * - Integration discovery
 * - Health checks
 * - Vibe natural language commands
 * - Development tools
 *
 * Install: npx @solidnumber/cli
 * Auth:    solid auth login
 * Status:  solid status
 *
 * All commands are scoped to your authenticated company_id.
 * You can only see and modify your own business data.
 * ================================================================================
 */

import { Command } from 'commander';
import { authCommand } from './commands/auth';
import { statusCommand } from './commands/status';
import { kbCommand } from './commands/kb';
import { pagesCommand } from './commands/pages';
import { servicesCommand } from './commands/services';
import { integrationsCommand } from './commands/integrations';
import { vibeCommand } from './commands/vibe';
import { healthCommand } from './commands/health';
import { devCommand } from './commands/dev';
import { dropletCommand } from './commands/droplet';

const program = new Command();

program
  .name('solid')
  .description('Solid# CLI — AI Business Infrastructure\n\n  Login, manage your KB, pages, services, and AI agents.\n  Everything is scoped to your company. Safe and isolated.')
  .version('1.0.0');

// Register commands — business commands first, then dev tools
program.addCommand(authCommand);
program.addCommand(statusCommand);
program.addCommand(kbCommand);
program.addCommand(pagesCommand);
program.addCommand(servicesCommand);
program.addCommand(vibeCommand);
program.addCommand(integrationsCommand);
program.addCommand(healthCommand);
program.addCommand(devCommand);
program.addCommand(dropletCommand);

// Parse arguments
program.parse(process.argv);

// Show help if no command provided
if (!process.argv.slice(2).length) {
  program.outputHelp();
}
