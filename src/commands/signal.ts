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
 *   solid signal stream --topic ask.any
 *     → hold ONE connection open; the server pushes events as they happen
 *       (SSE). ndjson when piped. Falls back to polling on older backends.
 *
 * `tail`/`watch` poll; `stream` is server-push (SSE) — a reactive system reads
 * one stream instead of running its own poll loop.
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

/**
 * Drain complete SSE event blocks (`...\n\n`) from a buffer. Pure + exported
 * so the wire parser is unit-tested without a socket. Returns the parsed event
 * objects (only those that look like signals — i.e. carry an `id`, so the
 * `ready` prelude and `: keepalive` heartbeats are skipped) and the leftover
 * partial block to carry into the next chunk.
 */
export function drainSSE(buffer: string): { events: Array<Record<string, unknown>>; rest: string } {
  const events: Array<Record<string, unknown>> = [];
  let rest = buffer;
  let idx: number;
  while ((idx = rest.indexOf('\n\n')) !== -1) {
    const block = rest.slice(0, idx);
    rest = rest.slice(idx + 2);
    const data = block
      .split('\n')
      .filter((l) => l.startsWith('data:'))
      .map((l) => l.slice(5).trim())
      .join('\n');
    if (!data) continue; // comment / heartbeat / event-line only
    try {
      const obj = JSON.parse(data);
      if (obj && typeof obj === 'object' && 'id' in obj) events.push(obj as Record<string, unknown>);
    } catch {
      // ignore malformed frame — never let one bad line kill the stream
    }
  }
  return { events, rest };
}

function consumeSSE(
  stream: NodeJS.ReadableStream,
  onEvent: (e: TailResponse['events'][number]) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let buf = '';
    stream.on('data', (chunk: Buffer | string) => {
      buf += chunk.toString();
      const { events, rest } = drainSSE(buf);
      buf = rest;
      for (const ev of events) onEvent(ev as unknown as TailResponse['events'][number]);
    });
    stream.on('end', () => resolve());
    stream.on('error', reject);
  });
}

interface PollOptions { topic: string; limit: string; interval: string; json: boolean; since?: string }

/** Long-running poll loop over /signal/tail. Shared by `watch` and by `stream`'s
 *  fallback when the backend has no SSE endpoint. Runs until the process is killed. */
async function pollLoop(opts: PollOptions): Promise<void> {
  const intervalMs = Math.max(2, parseInt(opts.interval, 10) || 10) * 1000;
  let cursor: number | null = opts.since ? parseInt(opts.since, 10) : null;
  while (true) {
    try {
      const qs = new URLSearchParams({ topic: opts.topic, limit: String(opts.limit) });
      if (cursor !== null) qs.set('since_id', String(cursor));
      const res = await apiClient.get<TailResponse>(`/api/v1/signal/tail?${qs.toString()}`);
      cursor = res.data.next_cursor;
      if (opts.json) {
        for (const ev of res.data.events) process.stdout.write(JSON.stringify(ev) + '\n');
      } else {
        res.data.events.forEach(_printEvent);
      }
    } catch (e) {
      const msg = handleApiError(e).message;
      if (!opts.json) console.error(chalk.dim(`  (poll error: ${msg})`));
    }
    await sleep(intervalMs);
  }
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
    if (!opts.json) {
      console.error(chalk.dim(`  watching ${opts.topic} every ${opts.interval}s (Ctrl+C to stop)`));
    }
    await pollLoop({ topic: opts.topic, limit: String(opts.limit), interval: String(opts.interval), json: !!opts.json });
  });

signalCommand
  .command('stream')
  .description('Hold one connection open and receive events as the server PUSHES them (SSE)')
  .option('--topic <topic>', 'Topic to stream', 'agent.any')
  .option('--since <id>', 'Start after this event id', '')
  .option('--json', 'Emit ndjson (one JSON object per line) — the default when piped')
  .option('--no-fallback', 'Fail instead of falling back to polling on an older backend')
  .action(async (opts) => {
    requireAuth();
    // ndjson by default for non-TTY consumers (agents, pipes); pretty on a TTY.
    const asJson = !!opts.json || !process.stdout.isTTY;
    const qs = new URLSearchParams({ topic: opts.topic });
    if (opts.since) qs.set('since_id', String(opts.since));

    let stream: NodeJS.ReadableStream;
    try {
      const res = await apiClient.get(`/api/v1/signal/stream?${qs.toString()}`, { responseType: 'stream' });
      stream = res.data as NodeJS.ReadableStream;
    } catch (e) {
      const err = handleApiError(e);
      // Graceful degradation: a backend without the SSE endpoint (404) still
      // serves /signal/tail, so fall back to polling unless --no-fallback.
      if (err.status === 404 && opts.fallback !== false) {
        if (!asJson) console.error(chalk.dim('  server has no push endpoint — falling back to polling'));
        await pollLoop({ topic: opts.topic, limit: '100', interval: '5', json: asJson, since: opts.since || undefined });
        return;
      }
      console.error(chalk.red(err.message));
      process.exit(1);
    }

    if (!asJson) console.error(chalk.dim(`  streaming ${opts.topic} — server-pushed (Ctrl+C to stop)`));
    try {
      await consumeSSE(stream, (ev) => {
        if (asJson) process.stdout.write(JSON.stringify(ev) + '\n');
        else _printEvent(ev);
      });
    } catch (e) {
      console.error(chalk.red(`  stream error: ${e instanceof Error ? e.message : String(e)}`));
      process.exit(1);
    }
  });
