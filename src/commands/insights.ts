/**
 * Insights command for Solid CLI
 *
 * AI-generated conversation insights — patterns, suggestions,
 * and KB recommendations from customer interactions.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const insightsCommand = new Command('insights')
  .description('AI-generated conversation insights')
  .action(async () => {
    insightsCommand.outputHelp();
  });

insightsCommand
  .command('list')
  .description('List pending conversation insights')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading insights...').start();

    try {
      const response = await apiClient.get('/api/v1/insights/pending');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as Record<string, any>;
      const insights = d.insights || d.items || [];
      console.log('');
      console.log(ui.header(`Pending Insights (${insights.length})`));

      if (insights.length === 0) {
        console.log(chalk.dim('  No pending insights. Your AI agents are learning!'));
      } else {
        for (const insight of insights) {
          const type = insight.insight_type || insight.type || 'suggestion';
          const color = type === 'kb_gap' ? chalk.yellow : type === 'pattern' ? chalk.cyan : chalk.white;
          console.log(`  ${color('●')} [${type}] ${insight.title || insight.summary}`);
          if (insight.recommendation) {
            console.log(chalk.dim(`    → ${insight.recommendation}`));
          }
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load insights'));
      console.error(handleApiError(error).message);
    }
  });

insightsCommand
  .command('stats')
  .description('Insight statistics overview')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading insight stats...').start();

    try {
      const response = await apiClient.get('/api/v1/insights/stats');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as Record<string, any>;
      console.log('');
      console.log(ui.header('Insight Statistics'));
      if (d.total !== undefined) console.log(ui.label('Total', String(d.total)));
      if (d.pending !== undefined) console.log(ui.label('Pending', chalk.yellow(String(d.pending))));
      if (d.applied !== undefined) console.log(ui.label('Applied', chalk.green(String(d.applied))));
      if (d.rejected !== undefined) console.log(ui.label('Rejected', chalk.dim(String(d.rejected))));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load insight stats'));
      console.error(handleApiError(error).message);
    }
  });

insightsCommand
  .command('approve <id>')
  .description('Approve an insight (optionally apply to KB)')
  .option('--apply', 'Also apply the insight to knowledge base')
  .action(async (id, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Approving insight...').start();

    try {
      await apiClient.post(`/api/v1/insights/${id}/approve`, {
        apply_to_kb: !!options.apply,
      });
      spinner.succeed(chalk.green(`Insight ${id} approved${options.apply ? ' and applied to KB' : ''}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to approve insight'));
      console.error(handleApiError(error).message);
    }
  });

insightsCommand
  .command('reject <id>')
  .description('Reject an insight')
  .action(async (id) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Rejecting insight...').start();

    try {
      await apiClient.post(`/api/v1/insights/${id}/reject`);
      spinner.succeed(chalk.green(`Insight ${id} rejected`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to reject insight'));
      console.error(handleApiError(error).message);
    }
  });
