/**
 * Insights command for Solid CLI
 *
 * AI-generated conversation insights — patterns, suggestions,
 * and KB recommendations from customer interactions.
 */

import { Command } from 'commander';
import chalk from 'chalk';

import { apiClient } from '../lib/api-client';
import { run } from '../lib/command-kit';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

interface InsightItem {
  insight_type?: string;
  type?: string;
  title?: string;
  summary?: string;
  recommendation?: string;
}

interface InsightListResponse {
  insights?: InsightItem[];
  items?: InsightItem[];
}

interface InsightStatsResponse {
  total?: number;
  pending?: number;
  applied?: number;
  rejected?: number;
}

export const insightsCommand = new Command('insights')
  .description('AI-generated conversation insights')
  .action(async () => {
    insightsCommand.outputHelp();
  });

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = insightsCommand.command('list').alias('ls').description('List pending conversation insights');
  withListFlags(listCmd);
  listCmd.action(async (options: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(options, {
      spinnerText: 'Loading insights...',
      errorText: 'Failed to load insights',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/insights/pending', { params: { limit, offset } })).data,
      extract: (page) => {
        const d = page as InsightListResponse;
        return ((d.insights || d.items || []) as unknown as Array<Record<string, unknown>>);
      },
      render: (items) => {
          const insights = items as unknown as InsightItem[];
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
        },
    });
  });
}

insightsCommand
  .command('stats')
  .description('Insight statistics overview')
  .option('--json', 'JSON output')
  .action(async (options) => {
    await run<InsightStatsResponse>(
      async () => (await apiClient.get('/api/v1/insights/stats')).data as InsightStatsResponse,
      {
        spinner: 'Loading insight stats...',
        errorText: 'Failed to load insight stats',
        json: isJsonOutput(options),
        render: (d) => {
          console.log('');
          console.log(ui.header('Insight Statistics'));
          if (d.total !== undefined) console.log(ui.label('Total', String(d.total)));
          if (d.pending !== undefined) console.log(ui.label('Pending', chalk.yellow(String(d.pending))));
          if (d.applied !== undefined) console.log(ui.label('Applied', chalk.green(String(d.applied))));
          if (d.rejected !== undefined) console.log(ui.label('Rejected', chalk.dim(String(d.rejected))));
          console.log('');
        },
      },
    );
  });

insightsCommand
  .command('approve <id>')
  .description('Approve an insight (optionally apply to KB)')
  .option('--apply', 'Also apply the insight to knowledge base')
  .action(async (id: string, options) => {
    await run(
      async () => {
        await apiClient.post(`/api/v1/insights/${id}/approve`, { apply_to_kb: !!options.apply });
      },
      {
        spinner: 'Approving insight...',
        errorText: 'Failed to approve insight',
        successText: `Insight ${id} approved${options.apply ? ' and applied to KB' : ''}`,
      },
    );
  });

insightsCommand
  .command('reject <id>')
  .description('Reject an insight')
  .action(async (id: string) => {
    await run(
      async () => {
        await apiClient.post(`/api/v1/insights/${id}/reject`);
      },
      {
        spinner: 'Rejecting insight...',
        errorText: 'Failed to reject insight',
        successText: `Insight ${id} rejected`,
      },
    );
  });
