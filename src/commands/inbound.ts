/**
 * solid inbound — Inbound webhook receiver management (T2)
 *
 * Lets agencies + developers register endpoints that external systems
 * (Zapier, Stripe, agency backends) POST to with HMAC signatures, and
 * have those events fire chains.
 *
 * Subcommands:
 *   solid inbound list                                  List endpoints
 *   solid inbound create --event <key> [--chain <id>]   Create endpoint (returns secret ONCE)
 *   solid inbound get <id>
 *   solid inbound update <id> [--chain <id>] [--active <bool>] [--description <text>]
 *   solid inbound rotate <id>                            Mint new signing secret
 *   solid inbound delete <id>
 *   solid inbound events [--endpoint <id>] [--status <s>] [--limit <n>]
 *   solid inbound event <event_id>                       Full payload + headers
 *   solid inbound replay <event_id>                      Re-fire chain w/ original payload
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, error: unknown): void {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(error).message}`));
}

export const inboundCommand = new Command('inbound')
  .description('Inbound webhooks — receive events from Zapier/Stripe/external systems and fire chains');

// ── list ─────────────────────────────────────────────────────────────

inboundCommand
  .command('list').alias('ls')
  .description('List configured inbound webhook endpoints for this company')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading endpoints...').start();
    try {
      const res = await apiClient.get('/api/v1/inbound/endpoints');
      const r = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      const items = r.endpoints || [];
      spinner.succeed(chalk.green(`${items.length} endpoint(s)`));
      console.log('');
      for (const e of items as Record<string, any>[]) {
        const dot = e.is_active ? chalk.green('●') : chalk.dim('○');
        const chain = e.chain_id ? chalk.cyan(`→ chain #${e.chain_id}`) : chalk.yellow('(audit-only — no chain)');
        console.log(`  ${dot} ${chalk.bold(e.id)}  ${e.event_key}  ${chain}`);
        const stats = `received:${e.total_received ?? 0}  fired:${e.total_chain_fires ?? 0}`;
        const last = e.last_received_at ? `last:${e.last_received_at.split('T')[0]}` : 'never received';
        console.log(`      ${chalk.dim(stats)}  ${chalk.dim(last)}`);
        if (e.description) console.log(`      ${chalk.dim(e.description)}`);
      }
    } catch (error) { fail(spinner, 'Failed to list endpoints', error); }
  });

// ── create ───────────────────────────────────────────────────────────

inboundCommand
  .command('create')
  .description('Create an inbound endpoint (returns signing secret ONCE — copy it now)')
  .requiredOption('--event <key>', 'Event key (e.g. "lead.created", "stripe.charge.succeeded")')
  .option('--chain <id>', 'Chain ID to fire when this event arrives (omit for audit-only)')
  .option('--description <text>', 'What this endpoint is for')
  .option('--source <name>', 'Expected source: zapier | stripe | internal | etc.')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { event_key: opts.event };
    if (opts.chain) body.chain_id = parseInt(opts.chain, 10);
    if (opts.description) body.description = opts.description;
    if (opts.source) body.expected_source = opts.source;

    const spinner = ora(`Creating inbound endpoint for ${opts.event}...`).start();
    try {
      const res = await apiClient.post('/api/v1/inbound/endpoints', body);
      const r = res.data as Record<string, any>;
      const e = r.endpoint;
      spinner.succeed(chalk.green(`Endpoint ${e.id} created`));
      console.log('');
      console.log(`  ${chalk.bold('Event:')}   ${e.event_key}`);
      console.log(`  ${chalk.bold('Chain:')}   ${e.chain_id ? `#${e.chain_id}` : chalk.dim('none (audit-only)')}`);
      console.log(`  ${chalk.bold('URL:')}     ${chalk.cyan(`https://api.solidnumber.com${r.public_url}`)}`);
      console.log('');
      console.log(chalk.yellow('  ⚠ Copy this signing secret NOW — it will not be shown again:'));
      console.log('');
      console.log(`  ${chalk.cyan(e.signing_secret)}`);
      console.log('');
      console.log(chalk.dim('  External systems must include these headers on every POST:'));
      console.log(chalk.dim('    X-Solid-Signature:  sha256=<hex>'));
      console.log(chalk.dim('    X-Solid-Timestamp:  <unix seconds>'));
      console.log(chalk.dim('    X-Solid-Idempotency-Key: <uuid>   (optional but recommended)'));
      console.log('');
      console.log(chalk.dim('  Signature = HMAC-SHA256 of `{timestamp}.{raw_body}` using the secret above.'));
    } catch (error) { fail(spinner, 'Failed to create endpoint', error); }
  });

// ── get / update / delete / rotate ───────────────────────────────────

inboundCommand
  .command('get <id>')
  .description('Get one endpoint')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/inbound/endpoints/${id}`);
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green(`Endpoint ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (error) { fail(spinner, 'Failed to load endpoint', error); }
  });

inboundCommand
  .command('update <id>')
  .description('Update an endpoint (chain, description, active state)')
  .option('--chain <id>', 'New chain ID (use 0 to detach)')
  .option('--description <text>', 'New description')
  .option('--source <name>', 'New expected source')
  .option('--active <bool>', 'true|false')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.chain !== undefined) body.chain_id = parseInt(opts.chain, 10);
    if (opts.description) body.description = opts.description;
    if (opts.source) body.expected_source = opts.source;
    if (opts.active !== undefined) body.is_active = opts.active === 'true';
    if (Object.keys(body).length === 0) {
      console.error(chalk.red('Provide at least one field to update.'));
      process.exit(1);
    }
    const spinner = ora('Updating...').start();
    try {
      await apiClient.patch(`/api/v1/inbound/endpoints/${id}`, body);
      spinner.succeed(chalk.green('Endpoint updated'));
    } catch (error) { fail(spinner, 'Failed to update endpoint', error); }
  });

inboundCommand
  .command('delete <id>')
  .description('Delete an endpoint (prompts by default — cascades to all received events)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(
      `Delete endpoint ${id}? All received events for this endpoint will also be deleted.`,
      { autoConfirm: Boolean(opts.yes) },
    );
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const spinner = ora({ text: `Deleting endpoint ${id}...`, stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/inbound/endpoints/${id}`);
      spinner.succeed(chalk.green(`Endpoint ${id} deleted`));
    } catch (error) { fail(spinner, 'Failed to delete endpoint', error); }
  });

inboundCommand
  .command('rotate <id>')
  .description('Rotate the signing secret (old secret stops working immediately)')
  .action(async (id) => {
    requireAuth();
    const spinner = ora('Rotating secret...').start();
    try {
      const res = await apiClient.post(`/api/v1/inbound/endpoints/${id}/rotate-secret`);
      const r = res.data as Record<string, any>;
      const e = r.endpoint;
      spinner.succeed(chalk.green(`Secret rotated for endpoint ${e.id}`));
      console.log('');
      console.log(chalk.yellow('  ⚠ Copy the new signing secret NOW:'));
      console.log('');
      console.log(`  ${chalk.cyan(e.signing_secret)}`);
      console.log('');
      console.log(chalk.dim('  Update every external system that posts to this endpoint.'));
    } catch (error) { fail(spinner, 'Failed to rotate secret', error); }
  });

// ── events ───────────────────────────────────────────────────────────

inboundCommand
  .command('events')
  .description('List recent received events (audit log)')
  .option('--endpoint <id>', 'Filter by endpoint ID')
  .option('--status <s>', 'Filter by status (pending|chain_fired|chain_failed|deduped|invalid_signature)')
  .option('-l, --limit <n>', 'Max results (1-500)', '50')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const params: Record<string, unknown> = { limit: parseInt(opts.limit, 10) };
    if (opts.endpoint) params.endpoint_id = parseInt(opts.endpoint, 10);
    if (opts.status) params.status = opts.status;

    const spinner = ora('Loading events...').start();
    try {
      const res = await apiClient.get('/api/v1/inbound/events', { params });
      const r = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(r, null, 2)); return; }
      const items = r.events || [];
      spinner.succeed(chalk.green(`${items.length} of ${r.total} event(s)`));
      console.log('');
      for (const e of items as Record<string, any>[]) {
        const status = e.status === 'chain_fired' ? chalk.green(e.status)
          : e.status === 'chain_failed' ? chalk.red(e.status)
          : e.status === 'invalid_signature' ? chalk.red(e.status)
          : e.status === 'deduped' ? chalk.dim(e.status)
          : chalk.yellow(e.status);
        const when = e.received_at ? e.received_at.replace('T', ' ').split('.')[0] : '?';
        const exec = e.chain_execution_id ? chalk.dim(`exec=${e.chain_execution_id}`) : '';
        const idem = e.idempotency_key ? chalk.dim(`idem=${e.idempotency_key.substring(0, 8)}`) : '';
        console.log(`  ${chalk.bold(e.id)}  ${chalk.dim(when)}  endpoint:${e.endpoint_id}  ${status}  ${exec}  ${idem}`);
        if (e.error_message) console.log(`      ${chalk.red(e.error_message.substring(0, 150))}`);
      }
    } catch (error) { fail(spinner, 'Failed to load events', error); }
  });

inboundCommand
  .command('event <id>')
  .description('Full event payload + headers (use for debugging "why did my Zap arrive but the chain not fire")')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora('Loading event...').start();
    try {
      const res = await apiClient.get(`/api/v1/inbound/events/${id}`);
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green(`Event ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (error) { fail(spinner, 'Failed to load event', error); }
  });

inboundCommand
  .command('replay <id>')
  .description('Re-fire the chain with the original payload (creates a new event linked back to the original)')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Replaying event ${id}...`).start();
    try {
      const res = await apiClient.post(`/api/v1/inbound/events/${id}/replay`);
      const r = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Replay status: ${r.status}`));
      console.log(`  Original event: ${r.original_event_id}`);
      console.log(`  Replay event:   ${r.replay_event_id}`);
      if (r.chain_execution_id) console.log(`  New chain exec: ${r.chain_execution_id}`);
    } catch (error) { fail(spinner, 'Replay failed', error); }
  });
