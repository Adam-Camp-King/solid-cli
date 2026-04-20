/**
 * `solid signal` — agent-facing event stream.
 *
 *   solid signal topics              # list known topics
 *   solid signal tail                # poll for new events once
 *   solid signal tail --topic draft.any --since 42 --limit 100
 *   solid signal watch --topic ask.any --interval 10
 *     → long-running: print events as they arrive, advance cursor
 *       internally. SIGINT stops. Good for dev / debug.
 *   solid signal watch --topic ask.any --json
 *     → each event as a JSON line (ndjson). Pipe-friendly for agents.
 *
 * v1 is polling. Webhook delivery is v2.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import { apiClient, handleApiError } from '../lib/api-client';
import { config } from '../lib/config';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run: solid auth login'));
    process.exit(1);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

interface TailResponse {
  topic: string;
  count: number;
  next_cursor: number;
  events: Array<{
    id: number;
    action: string;
    resource_type?: string;
    resource_id?: string;
    source?: string;
    details?: Record<string, unknown>;
    created_at?: string;
  }>;
  message?: string;
}

function _printEvent(e: TailResponse['events'][number]): void {
  const ts = (e.created_at || '').slice(11, 19);
  const src = e.source ? chalk.dim(`[${e.source}]`) : '';
  console.log(`  ${chalk.dim(ts)}  ${chalk.cyan(String(e.id).padStart(6))}  ${chalk.bold(e.action)}  ${src}`);
  if (e.resource_id) console.log(`    ${chalk.dim('resource:')} ${e.resource_type}/${e.resource_id}`);
}

export const signalCommand = new Command('signal')
  .description('Agent-facing event stream — sense what happened on this company');

signalCommand
  .command('topics')
  .description('List agent-facing topic vocabulary')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    requireAuth();
    try {
      const res = await apiClient.get<{ topics: string[] }>('/api/v1/signal/topics');
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      console.log(chalk.bold(`  ${res.data.topics.length} topics`));
      console.log('');
      for (const t of res.data.topics) console.log(`  ${chalk.cyan(t)}`);
    } catch (e) {
      console.error(chalk.red(handleApiError(e).message));
      process.exit(1);
    }
  });

signalCommand
  .command('tail')
  .description('One-shot poll for new events (stateless; pass --since to resume)')
  .option('--topic <topic>', 'Topic to poll', 'agent.any')
  .option('--since <id>', 'Return events with id > this', '')
  .option('--limit <n>', 'Max events to return', '50')
  .option('--json', 'JSON output')
  .action(async (opts) => {
    requireAuth();
    try {
      const qs = new URLSearchParams({
        topic: opts.topic,
        limit: String(opts.limit),
      });
      if (opts.since) qs.set('since_id', String(opts.since));
      const res = await apiClient.get<TailResponse>(`/api/v1/signal/tail?${qs.toString()}`);
      if (opts.json) { console.log(JSON.stringify(res.data, null, 2)); return; }
      if (res.data.message) console.log(chalk.yellow(`  ${res.data.message}`));
      console.log(chalk.bold(`  ${res.data.count} event(s)  [topic: ${res.data.topic}]`));
      console.log(chalk.dim(`  next_cursor: ${res.data.next_cursor}`));
      console.log('');
      res.data.events.forEach(_printEvent);
    } catch (e) {
      console.error(chalk.red(handleApiError(e).message));
      process.exit(1);
    }
  });

signalCommand
  .command('watch')
  .description('Long-running: print events as they arrive (Ctrl+C to stop)')
  .option('--topic <topic>', 'Topic to watch', 'agent.any')
  .option('--interval <seconds>', 'Poll interval', '10')
  .option('--limit <n>', 'Max events per poll', '100')
  .option('--json', 'Emit ndjson (one JSON object per line)')
  .action(async (opts) => {
    requireAuth();
    const intervalMs = Math.max(2, parseInt(opts.interval, 10) || 10) * 1000;
    let cursor: number | null = null;

    if (!opts.json) {
      console.error(chalk.dim(
        `  watching ${opts.topic} every ${opts.interval}s (Ctrl+C to stop)`,
      ));
    }

    // Advance cursor on every poll. Bounded by process lifetime —
    // SIGINT kills the loop, which is the expected stop signal.
    while (true) {
      try {
        const qs = new URLSearchParams({ topic: opts.topic, limit: String(opts.limit) });
        if (cursor !== null) qs.set('since_id', String(cursor));
        const res = await apiClient.get<TailResponse>(`/api/v1/signal/tail?${qs.toString()}`);
        cursor = res.data.next_cursor;
        if (opts.json) {
          for (const ev of res.data.events) {
            process.stdout.write(JSON.stringify(ev) + '\n');
          }
        } else {
          res.data.events.forEach(_printEvent);
        }
      } catch (e) {
        // Don't die on transient network errors — just log and continue.
        const msg = handleApiError(e).message;
        if (!opts.json) console.error(chalk.dim(`  (poll error: ${msg})`));
      }
      await sleep(intervalMs);
    }
  });
