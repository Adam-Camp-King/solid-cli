/**
 * Development commands for Solid CLI
 *
 * Redirects to the real commands that replaced the old stubs:
 *   solid dev sandbox → solid sandbox
 *   solid dev server  → solid serve
 *   solid dev logs    → solid health --full
 */

import { Command } from 'commander';
import chalk from 'chalk';

export const devCommand = new Command('dev')
  .description('Development tools (see: solid serve, solid sandbox, solid import)');

devCommand
  .command('sandbox')
  .description('Use `solid sandbox` instead')
  .allowUnknownOption()
  .action(() => {
    console.log(chalk.cyan('solid dev sandbox has been replaced by:'));
    console.log('');
    console.log(`  ${chalk.bold('solid sandbox create')}    Fork site into isolated sandbox`);
    console.log(`  ${chalk.bold('solid sandbox status')}    Show what changed`);
    console.log(`  ${chalk.bold('solid sandbox diff')}      Compare sandbox vs original`);
    console.log(`  ${chalk.bold('solid sandbox push')}      Promote sandbox to main files`);
    console.log(`  ${chalk.bold('solid sandbox reset')}     Discard sandbox`);
    console.log('');
  });

devCommand
  .command('server')
  .description('Use `solid serve` instead')
  .action(() => {
    console.log(chalk.cyan('solid dev server has been replaced by:'));
    console.log('');
    console.log(`  ${chalk.bold('solid serve')}             Start local preview at localhost:4000`);
    console.log(`  ${chalk.bold('solid serve --open')}      Auto-open browser`);
    console.log(`  ${chalk.bold('solid serve --port 3333')} Custom port`);
    console.log('');
    console.log(chalk.dim('Renders all 25 CMS block types with live reload.'));
    console.log('');
  });

devCommand
  .command('generate <type>')
  .alias('g')
  .description('Use `solid import` for HTML or `solid clone` for templates')
  .action((type) => {
    console.log(chalk.cyan('solid dev generate has been replaced by:'));
    console.log('');
    console.log(`  ${chalk.bold('solid import file.html --page "Title"')}   Convert HTML to CMS blocks`);
    console.log(`  ${chalk.bold('solid import --clipboard --page "Title"')} Import from clipboard`);
    console.log(`  ${chalk.bold('solid import --ai --page "Title"')}        Use Claude for smart parsing`);
    console.log(`  ${chalk.bold('solid clone plumber')}                     Scaffold from industry template`);
    console.log('');
  });

devCommand
  .command('logs')
  .description('Use `solid health` for system status')
  .action(() => {
    console.log(chalk.cyan('For logs and health monitoring:'));
    console.log('');
    console.log(`  ${chalk.bold('solid health')}            Quick health check`);
    console.log(`  ${chalk.bold('solid health --full')}     Full 6-layer health check`);
    console.log(`  ${chalk.bold('solid health --mcp')}      MCP/agent system health`);
    console.log('');
  });
