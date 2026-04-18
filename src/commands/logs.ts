/**
 * Agent logs command for Solid CLI
 *
 * Real-time agent activity from terminal:
 *   solid logs                    — All agent activity (last 24h)
 *   solid logs sarah              — Sarah's activity
 *   solid logs sarah --errors     — Sarah's errors only
 *   solid logs --hours 72         — Last 3 days
 *   solid logs --follow           — Poll for new activity
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

const AGENT_NAME_MAP: Record<string, string> = {
  sarah: 'customer_service', marcus: 'growth_intelligence', devon: 'operations_monitor',
  ada: 'orchestrator', jake: 'inventory_manager', morgan: 'appointment_scheduler',
  alex: 'sales_rep', jordan: 'review_manager', maya: 'email_marketer',
  riley: 'loyalty_program', ace: 'design_engine', annie: 'phone_agent',
  nora: 'social_media', emma: 'content_writer', victor: 'voice_setup',
  gwen: 'google_workspace', jackson: 'estimates', lucie: 'lead_intake',
  daphne: 'dispatch', dexter: 'data_entry',
};

function resolveAgentType(name: string): string {
  return AGENT_NAME_MAP[name.toLowerCase()] || name.toLowerCase();
}

function eventIcon(type: string, success?: boolean): string {
  if (type === 'execution') return success ? chalk.green('●') : chalk.red('●');
  if (type === 'task') return success ? chalk.cyan('▶') : chalk.red('▶');
  if (type === 'communication') return chalk.blue('◆');
  return chalk.dim('○');
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return chalk.dim('—');
  const d = new Date(iso);
  return chalk.dim(d.toLocaleTimeString());
}

function formatLatency(ms: number | null): string {
  if (!ms) return '';
  if (ms < 1000) return chalk.dim(`${ms}ms`);
  return chalk.dim(`${(ms / 1000).toFixed(1)}s`);
}

export const logsCommand = new Command('logs')
  .description('View real-time agent activity logs')
  .argument('[agent]', 'Agent name (sarah, marcus, etc.) or type')
  .option('--hours <n>', 'How far back to look (default: 24)', '24')
  .option('-n, --limit <n>', 'Max log entries', '50')
  .option('-e, --errors', 'Show errors only')
  .option('-t, --type <type>', 'Filter: execution, task, communication')
  .option('-f, --follow', 'Poll for new activity every 5 seconds')
  .option('--json', 'Output as JSON')
  .action(async (agent, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    const agentType = agent ? resolveAgentType(agent) : undefined;
    const hours = parseInt(options.hours, 10);
    const limit = parseInt(options.limit, 10);

    // Errors-only mode
    if (options.errors && agentType) {
      const spinner = ora(`Loading errors for ${agent}...`).start();
      try {
        const res = await apiClient.agentErrors(agentType, hours, limit);
        spinner.succeed(chalk.green('Errors loaded'));
        const data = res.data as Record<string, any>;

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        if (data.errors.length === 0) {
          console.log(chalk.green(`  No errors for ${agent} in the last ${hours}h`));
        } else {
          console.log(chalk.bold(`  ${chalk.red(data.count)} errors — ${agent} (last ${hours}h)`));
          console.log('');
          for (const err of data.errors) {
            console.log(`  ${chalk.red('●')} ${formatTimestamp(err.timestamp)}  ${chalk.dim(err.action)}`);
            console.log(`    ${chalk.red(err.error || 'Unknown error')}`);
            if (err.latency_ms) console.log(`    ${formatLatency(err.latency_ms)}`);
            console.log('');
          }
        }
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load errors'));
        console.error(chalk.red(`  ${handleApiError(error).message}`));
      }
      return;
    }

    // Main logs view
    async function fetchAndDisplay(isFollow = false): Promise<void> {
      const spinner = isFollow ? null : ora('Loading agent logs...').start();
      try {
        const res = await apiClient.agentLogs(agentType, {
          hours: isFollow ? 1 : hours,
          limit,
          event_type: options.type,
        });
        if (spinner) spinner.succeed(chalk.green('Logs loaded'));
        const data = res.data as Record<string, any>;

        if (isJsonOutput(options)) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        if (!isFollow) {
          console.log('');
          const label = agentType ? `${agent} — last ${hours}h` : `All agents — last ${hours}h`;
          console.log(chalk.bold(`  ${label} (${data.count} events)`));

          // Stats if agent-specific
          if (data.stats) {
            const s = data.stats;
            console.log(`  ${chalk.dim('Success rate:')} ${(s.success_rate * 100).toFixed(1)}%  ${chalk.dim('Avg latency:')} ${s.avg_latency_ms}ms  ${chalk.dim('Tokens:')} ${s.total_tokens.toLocaleString()}`);
          }
          console.log('');
        }

        if (data.logs.length === 0 && !isFollow) {
          console.log(chalk.dim('  No activity found.'));
          console.log('');
          return;
        }

        for (const log of data.logs) {
          const icon = eventIcon(log.event_type, log.success);
          const time = formatTimestamp(log.timestamp);
          const agent_label = log.agent_type ? chalk.cyan(log.agent_type) : '';
          const action = log.action ? chalk.white(log.action.substring(0, 60)) : '';
          const latency = formatLatency(log.latency_ms);
          const tokens = log.tokens_used ? chalk.dim(`${log.tokens_used}tok`) : '';

          let line = `  ${icon} ${time}  ${agent_label}  ${action}`;
          if (latency || tokens) line += `  ${latency} ${tokens}`;
          console.log(line);

          if (log.error) {
            console.log(`    ${chalk.red(log.error.substring(0, 100))}`);
          }
          if (log.result_preview) {
            console.log(`    ${chalk.dim(log.result_preview.substring(0, 100))}`);
          }
        }

        if (!isFollow) console.log('');
      } catch (error) {
        if (spinner) spinner.fail(chalk.red('Failed to load logs'));
        console.error(chalk.red(`  ${handleApiError(error).message}`));
      }
    }

    // Follow mode — poll every 5 seconds
    if (options.follow) {
      console.log('');
      console.log(chalk.bold(`  Following ${agent || 'all agents'}... (Ctrl+C to stop)`));
      console.log('');
      await fetchAndDisplay(false);

      const seenTimestamps = new Set<string>();

      setInterval(async () => {
        try {
          const res = await apiClient.agentLogs(agentType, { hours: 1, limit: 10, event_type: options.type });
          const data = res.data as Record<string, any>;

          for (const log of (data.logs || []).reverse()) {
            const key = `${log.timestamp}-${log.event_type}-${log.action}`;
            if (!seenTimestamps.has(key)) {
              seenTimestamps.add(key);
              const icon = eventIcon(log.event_type, log.success);
              const time = formatTimestamp(log.timestamp);
              const agent_label = log.agent_type ? chalk.cyan(log.agent_type) : '';
              const action = log.action ? chalk.white(log.action.substring(0, 60)) : '';
              console.log(`  ${icon} ${time}  ${agent_label}  ${action}`);
              if (log.error) console.log(`    ${chalk.red(log.error.substring(0, 100))}`);
            }
          }
        } catch {
          // Silently retry on follow poll failures
        }
      }, 5000);

      // Keep process alive
      await new Promise(() => {});
      return;
    }

    await fetchAndDisplay();
  });
