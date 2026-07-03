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

// ── Communications master report (Insights suite) ───────────────────
// The SAME payload the web Insights Overview renders and the
// insights.master_summary verb returns — one aggregation layer.
insightsCommand
  .command('report')
  .description('Master communications report — sentiment, evaluation, needs-attention')
  .option('-d, --days <n>', 'Window in days (1-90)', '7')
  .option('--json', 'Output as JSON')
  .action(async (options: { days: string; json?: boolean }) => {
    const chalk = (await import('chalk')).default;
    const ora = (await import('ora')).default;
    const spinner = ora('Building the master report...').start();
    try {
      const res = await apiClient.get('/api/v1/communications/insights/summary', {
        params: { days: options.days },
      });
      const d = res.data as Record<string, any>;
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(d, null, 2)); return; }
      const s = d.sentiment || {};
      const all = s.all_communications || {};
      const e = d.evaluation || {};
      spinner.succeed(chalk.green(`Last ${d.period_days} days — ${all.total || 0} communications, overall ${s.overall || 'neutral'}`));
      console.log(
        `  Mood: ${chalk.green(`${all.positive || 0} positive`)} · ${chalk.dim(`${all.neutral || 0} neutral`)} · ${chalk.red(`${all.negative || 0} negative`)}` +
        (all.unscored ? chalk.dim(` · ${all.unscored} unscored`) : ''),
      );
      const ch = s.channels || {};
      const chan = (k: string, label: string) => (ch[k]?.total ? `${label} ${ch[k].total}` : null);
      const parts = [chan('voice', 'calls'), chan('sms', 'texts'), chan('email', 'emails'), chan('chat', 'chats')].filter(Boolean);
      if (parts.length) console.log(chalk.dim(`  Channels: ${parts.join(' · ')}`));
      if (e.calls_scored) {
        console.log(chalk.dim(`  Calls: avg quality ${e.avg_quality}/100 · resolution ${Math.round((e.resolution_rate || 0) * 100)}% · escalation ${Math.round((e.escalation_rate || 0) * 100)}%`));
      }
      const attention = d.needs_attention || [];
      if (attention.length) {
        console.log(chalk.red(`  Needs attention (${attention.length}):`));
        for (const a of attention.slice(0, 5) as Record<string, any>[]) {
          console.log(`    ${chalk.yellow(a.channel)} ${a.summary || 'negative communication'} ${chalk.dim(a.line || '')}`);
        }
      } else {
        console.log(chalk.dim('  Nothing negative needs attention.'));
      }
      const reply = e.needs_reply || [];
      if (reply.length) console.log(chalk.red(`  Unanswered negatives: ${reply.length} — reply first.`));
    } catch (error) {
      spinner.fail('Failed to build the report');
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  });

import { appendExamples as __ae_insights } from '../lib/command-kit';
__ae_insights(insightsCommand, [
  { cmd: 'solid insights report',           why: 'How are my customer communications doing?' },
  { cmd: 'solid insights list',             why: 'AI-generated insights from conversations' },
  { cmd: 'solid insights stats',            why: 'Insight volume + top themes' },
  { cmd: 'solid insights approve <id>',     why: 'Send insight → KB' },
]);
