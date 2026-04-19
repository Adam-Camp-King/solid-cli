/**
 * Orders commands.
 * Wraps controllers/orders.py at /api/v1/orders/* (list, get, create, confirm,
 * cancel, refund, allocate, fulfill, quick-sale).
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown) {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
}

export const ordersCommand = new Command('orders')
  .description('Order lifecycle (list, create, confirm, fulfill, cancel, refund, import, watch)');

// ── Shared CSV helpers ───────────────────────────────────────────────
// Exported so `orders watch` can reuse the exact same parser + mapper.

interface OrderImportRow {
  row: number;
  status: 'created' | 'failed' | 'skipped' | 'dry-run';
  id?: number;
  error?: string;
}

interface OrderImportResult {
  total: number;
  created: number;
  failed: number;
  skipped: number;
  dry_run: boolean;
  results: OrderImportRow[];
}

// Minimal RFC-4180 CSV — same parser as contacts/ecommerce imports, kept
// local so we don't take a new dependency just for this.
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') inQ = false;
      else field += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(field); field = ''; }
      else if (ch === '\r') { /* noop */ }
      else if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += ch;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

const DEFAULT_ORDER_HEADER_MAP: Record<string, string> = {
  'customer email': 'customer_email', 'customer_email': 'customer_email', 'email': 'customer_email',
  'customer name': 'customer_name', 'customer': 'customer_name', 'name': 'customer_name',
  'total': 'total', 'amount': 'total', 'subtotal': 'total',
  'status': 'status',
  'sku': 'sku', 'product sku': 'sku',
  'quantity': 'quantity', 'qty': 'quantity',
  'currency': 'currency',
  'reference': 'reference', 'order ref': 'reference', 'external id': 'reference',
};

// Core import — file path in, structured result out. No console side-effects
// beyond per-row progress callbacks. Returns the full summary.
//
// Flags worth knowing about:
//   - `concurrency`: how many POSTs can be in flight at once (default 5).
//     Keeps small enough to respect backend rate limits but parallel enough
//     that 1000-row imports don't take 30+ minutes.
//   - `from`: 1-indexed data row to start from (row 1 is the header, row 2
//     is the first data record). Lets you resume a failed import.
//   - `stopOnError`: bail on the first failed row. Default is to continue.
export async function importOrdersFromCSV(
  absPath: string,
  opts: {
    map?: string;
    dryRun?: boolean;
    stopOnError?: boolean;
    concurrency?: number;
    from?: number;
    onProgress?: (row: number, total: number) => void;
  } = {},
): Promise<OrderImportResult> {
  const fs = await import('fs');
  const stat = fs.statSync(absPath);
  // Memory guardrail: warn (stderr) on files >50 MB so caller knows we're
  // loading it fully. Streaming parse would need a proper state machine —
  // not worth the dependency until someone actually hits this.
  if (stat.size > 50 * 1024 * 1024) {
    console.error(chalk.yellow(`  ⚠ CSV is ${Math.round(stat.size / 1024 / 1024)} MB. Loading fully into memory.`));
  }
  const raw = fs.readFileSync(absPath, 'utf-8');
  const rows = parseCSV(raw);
  if (rows.length < 2) throw new Error('CSV needs a header row + at least one data row.');
  const header = rows[0].map((h) => h.trim());

  const overrides: Record<string, string> = {};
  if (opts.map) {
    for (const pair of opts.map.split(',')) {
      const [k, v] = pair.split('=').map((s) => s.trim());
      if (k && v) overrides[k.toLowerCase()] = v;
    }
  }
  const headerField = header.map((h) => overrides[h.toLowerCase()] ?? DEFAULT_ORDER_HEADER_MAP[h.toLowerCase()] ?? null);

  const total = rows.length - 1;
  const fromRow = Math.max(1, opts.from ?? 1); // 1-indexed over data rows
  const concurrency = Math.max(1, opts.concurrency ?? 5);
  let created = 0, failed = 0, skipped = 0;
  const results: OrderImportRow[] = [];
  let aborted = false;

  // Build the pending work — one unit per data row to import.
  type Task = { row: number; body: Record<string, unknown> | null; skipReason?: string };
  const tasks: Task[] = [];
  for (let i = fromRow; i < rows.length; i++) {
    const body: Record<string, unknown> = {};
    for (let c = 0; c < header.length; c++) {
      const target = headerField[c];
      if (!target) continue;
      const val = rows[i][c]?.trim();
      if (!val) continue;
      if (target === 'total' || target === 'quantity') body[target] = parseFloat(val);
      else body[target] = val;
    }
    if (!body.customer_email && !body.customer_name) {
      tasks.push({ row: i + 1, body: null, skipReason: 'no customer identifier' });
    } else {
      tasks.push({ row: i + 1, body });
    }
  }

  // Dispatch with a simple async pool. Ordered results via row index.
  let cursor = 0;
  async function worker() {
    while (!aborted) {
      const idx = cursor++;
      if (idx >= tasks.length) return;
      const t = tasks[idx];
      if (opts.onProgress) opts.onProgress(idx + 1, tasks.length);

      if (t.body === null) {
        skipped++;
        results.push({ row: t.row, status: 'skipped', error: t.skipReason });
        continue;
      }
      if (opts.dryRun) {
        results.push({ row: t.row, status: 'dry-run' });
        continue;
      }
      try {
        const res = await apiClient.post('/api/v1/orders/', t.body);
        const d = res.data as Record<string, unknown>;
        created++;
        results.push({ row: t.row, status: 'created', id: Number(d.id) });
      } catch (e) {
        failed++;
        const msg = handleApiError(e).message;
        results.push({ row: t.row, status: 'failed', error: msg });
        if (opts.stopOnError) aborted = true;
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  // Ensure output is in original row order (workers race)
  results.sort((a, b) => a.row - b.row);

  return { total, created, failed, skipped, dry_run: Boolean(opts.dryRun), results };
}

ordersCommand
  .command('import <file>')
  .description('Bulk-import orders from a CSV (header row required)')
  .option('--map <pairs>', 'Header→field overrides, e.g. "Customer=customer_email,Qty=quantity"')
  .option('--preview', 'Parse + preview without creating anything (alias for --dry-run)')
  .option('--stop-on-error', 'Abort on the first failed row (default: continue)')
  .option('--concurrency <n>', 'Parallel POSTs in flight at once (default: 5)', '5')
  .option('--from <row>', 'Resume at this 1-indexed data row (row 1 = first after header)')
  .option('--json', 'Per-row result JSON plus summary')
  .action(async (file: string, opts: { map?: string; preview?: boolean; stopOnError?: boolean; concurrency: string; from?: string; json?: boolean }) => {
    requireAuth();
    const fs = await import('fs');
    const path = await import('path');
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) { console.error(chalk.red(`File not found: ${abs}`)); process.exit(2); }

    // Honor the root-level --dry-run (commander captures it there, not on
    // this subcommand). --preview is a local alias that always means
    // "don't write" even without the global flag.
    const { isDryRun } = await import('../lib/dry-run');
    const isPreview = Boolean(opts.preview) || isDryRun();

    const spinner = ora({ text: 'Importing orders...', stream: process.stderr }).start();
    let result: OrderImportResult;
    try {
      result = await importOrdersFromCSV(abs, {
        map: opts.map,
        dryRun: isPreview,
        stopOnError: opts.stopOnError,
        concurrency: Math.max(1, parseInt(opts.concurrency, 10)),
        from: opts.from ? parseInt(opts.from, 10) : undefined,
        onProgress: (i, total) => { spinner.text = `Importing ${total} orders... (${i}/${total})`; },
      });
    } catch (e) {
      spinner.fail(chalk.red('Import aborted'));
      console.error(chalk.red(`  ${(e as Error).message}`));
      process.exit(1);
    }

    if (result.dry_run) spinner.succeed(chalk.yellow(`[dry-run] would import ${result.total - result.skipped} orders (${result.skipped} skipped)`));
    else if (result.failed === 0) spinner.succeed(chalk.green(`Imported ${result.created} orders (${result.skipped} skipped)`));
    else spinner.warn(chalk.yellow(`Imported ${result.created}/${result.total} (failed: ${result.failed}, skipped: ${result.skipped})`));

    if (isJsonOutput(opts)) {
      console.log(JSON.stringify({ summary: { total: result.total, created: result.created, failed: result.failed, skipped: result.skipped, dry_run: result.dry_run }, results: result.results }, null, 2));
      return;
    }
    if (result.failed > 0) process.exit(1);
  });

// ── Watch mode — auto-import CSVs dropped into a directory ────────────
// Answers "what if the CLI could look at a file on a desktop?" — yes:
// point it at a folder; every new *.csv triggers importOrdersFromCSV and
// the file is moved to .processed/ or .failed/ based on the result.

ordersCommand
  .command('watch <dir>')
  .description('Watch a directory for new CSVs and auto-import them as orders')
  .option('--map <pairs>', 'Header→field overrides, same format as `orders import`')
  .option('--preview', 'Parse + preview every file, never write (alias for --dry-run)')
  .option('--no-move', 'Keep processed files in place instead of moving to .processed/ .failed/')
  .option('--interval <sec>', 'Re-scan interval for new files', '5')
  .action(async (dir: string, opts: { map?: string; preview?: boolean; move?: boolean; interval: string }) => {
    requireAuth();
    const { isDryRun } = await import('../lib/dry-run');
    const isPreview = Boolean(opts.preview) || isDryRun();
    const fs = await import('fs');
    const path = await import('path');
    const abs = path.resolve(dir);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
      console.error(chalk.red(`Not a directory: ${abs}`));
      process.exit(2);
    }
    const processedDir = path.join(abs, '.processed');
    const failedDir = path.join(abs, '.failed');
    fs.mkdirSync(processedDir, { recursive: true });
    fs.mkdirSync(failedDir, { recursive: true });

    const seen = new Set<string>();
    const intervalMs = Math.max(1, parseInt(opts.interval, 10)) * 1000;

    console.error(chalk.bold(`  Watching ${abs} for *.csv (poll every ${opts.interval}s)`));
    console.error(chalk.dim(`  Processed → ${processedDir}`));
    console.error(chalk.dim(`  Failed    → ${failedDir}`));
    if (isPreview) console.error(chalk.yellow('  [dry-run] — nothing will be written server-side'));
    console.error(chalk.dim('  Press Ctrl+C to stop.'));
    console.error('');

    // Track size + mtime across scans so we only process files whose bytes
    // stopped changing for one interval — prevents grabbing a half-written
    // CSV that another process is still streaming into.
    const pending = new Map<string, { size: number; mtime: number }>();

    const scan = async () => {
      const entries = fs.readdirSync(abs);
      for (const name of entries) {
        if (!name.toLowerCase().endsWith('.csv')) continue;
        const full = path.join(abs, name);
        if (seen.has(full)) continue;
        const stat = fs.statSync(full);
        if (!stat.isFile()) continue;

        // Stability gate: require two consecutive scans with the same size
        // and mtime before treating the file as done-being-written.
        const prev = pending.get(full);
        const sig = { size: stat.size, mtime: stat.mtimeMs };
        if (!prev || prev.size !== sig.size || prev.mtime !== sig.mtime) {
          pending.set(full, sig);
          continue;
        }
        pending.delete(full);
        seen.add(full);

        const ts = new Date().toISOString().replace(/[:.]/g, '-').split('.')[0];
        const spinner = ora({ text: `[${ts}] ${name} — importing...`, stream: process.stderr }).start();
        try {
          const result = await importOrdersFromCSV(full, { map: opts.map, dryRun: isPreview });
          const summary = `${result.created} ok, ${result.failed} failed, ${result.skipped} skipped`;
          if (result.failed === 0) {
            spinner.succeed(chalk.green(`[${ts}] ${name} — ${summary}`));
            if (opts.move && !isPreview) fs.renameSync(full, path.join(processedDir, name));
          } else {
            spinner.warn(chalk.yellow(`[${ts}] ${name} — ${summary}`));
            if (opts.move && !isPreview) fs.renameSync(full, path.join(failedDir, name));
          }
        } catch (e) {
          spinner.fail(chalk.red(`[${ts}] ${name} — ${(e as Error).message}`));
          if (opts.move && !isPreview) fs.renameSync(full, path.join(failedDir, name));
        }
      }
    };

    await scan();
    setInterval(scan, intervalMs);
  });

// List orders — full scripting contract (withListFlags + runListCommand)
{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = ordersCommand.command('list').alias('ls').description('List orders');
  withListFlags(listCmd, '100');
  listCmd.option('--status <status>', 'Filter by status');
  listCmd.action(async (opts: { status?: string } & import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading orders...',
      errorText: 'Failed to load orders',
      fetch: async (offset, limit) => {
        const params: Record<string, unknown> = { limit, offset };
        if (opts.status) params.status = opts.status;
        return (await apiClient.get('/api/v1/orders/', { params })).data;
      },
      extract: (page) => {
        if (Array.isArray(page)) return page as Array<Record<string, unknown>>;
        const d = page as Record<string, unknown>;
        return ((d.items || d.orders || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No orders.')); return; }
        console.log('');
        for (const o of items) {
          const total = o.total !== undefined ? chalk.green(`$${Number(o.total).toFixed(2)}`) : chalk.dim('—');
          console.log(`  ${chalk.bold(String(o.id))}  ${o.customer_name || o.customer_email || '—'}  ${total}  ${chalk.dim(String(o.status || ''))}  ${chalk.dim(String(o.created_at || '').split('T')[0])}`);
        }
      },
    });
  });
}

ordersCommand
  .command('get <id>')
  .description('Get order details')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const spinner = ora(`Loading order ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/orders/${id}`);
      const o = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(o, null, 2)); return; }
      spinner.succeed(chalk.green(`Order ${id}`));
      console.log('');
      console.log(`  ${chalk.bold('Status:')}    ${o.status || '—'}`);
      console.log(`  ${chalk.bold('Customer:')}  ${o.customer_name || o.customer_email || '—'}`);
      console.log(`  ${chalk.bold('Total:')}     $${o.total ?? '—'}`);
      console.log(`  ${chalk.bold('Items:')}     ${o.items?.length ?? o.line_items?.length ?? 0}`);
      console.log(`  ${chalk.bold('Created:')}   ${o.created_at || '—'}`);
    } catch (e) { fail(spinner, 'Failed to load order', e); }
  });

ordersCommand
  .command('create')
  .description('Create an order from a JSON payload (use --file or --items)')
  .option('--file <path>', 'JSON file with order payload')
  .option('--items <json>', 'Inline JSON: [{"product_id":1,"quantity":2}]')
  .option('--customer-email <email>')
  .option('--location <id>', 'Location ID')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Creating order...').start();
    try {
      let payload: Record<string, unknown> = {};
      if (opts.file) {
        const fs = await import('fs');
        payload = JSON.parse(fs.readFileSync(opts.file, 'utf-8'));
      } else if (opts.items) {
        payload.items = JSON.parse(opts.items);
      } else {
        spinner.fail(chalk.red('Provide --file or --items.'));
        process.exit(1);
      }
      if (opts.customerEmail) payload.customer_email = opts.customerEmail;
      const url = opts.location ? `/api/v1/orders/?location_id=${opts.location}` : '/api/v1/orders/';
      const res = await apiClient.post(url, payload);
      const o = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Order created: ${o.id}`));
    } catch (e) { fail(spinner, 'Failed to create order', e); }
  });

ordersCommand
  .command('confirm <id>')
  .description('Confirm a pending order')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Confirming order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/confirm`);
      spinner.succeed(chalk.green(`Order ${id} confirmed`));
    } catch (e) { fail(spinner, 'Failed to confirm order', e); }
  });

ordersCommand
  .command('cancel <id>')
  .description('Cancel an order')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Cancelling order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/cancel`);
      spinner.succeed(chalk.green(`Order ${id} cancelled`));
    } catch (e) { fail(spinner, 'Failed to cancel order', e); }
  });

ordersCommand
  .command('refund <id>')
  .description('Refund an order')
  .option('--amount <amount>', 'Partial refund amount (omit for full)')
  .option('--reason <text>', 'Reason for refund')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.amount) body.amount = parseFloat(opts.amount);
    if (opts.reason) body.reason = opts.reason;
    const spinner = ora(`Refunding order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/refund`, body);
      spinner.succeed(chalk.green(`Order ${id} refunded`));
    } catch (e) { fail(spinner, 'Failed to refund order', e); }
  });

ordersCommand
  .command('allocate <id>')
  .description('Allocate inventory for an order')
  .option('--location <id>', 'Location to allocate from')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.location) body.location_id = parseInt(opts.location, 10);
    const spinner = ora(`Allocating order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/allocate`, body);
      spinner.succeed(chalk.green(`Order ${id} allocated`));
    } catch (e) { fail(spinner, 'Failed to allocate order', e); }
  });

ordersCommand
  .command('fulfill <id>')
  .description('Mark an order fulfilled')
  .action(async (id) => {
    requireAuth();
    const spinner = ora(`Fulfilling order ${id}...`).start();
    try {
      await apiClient.post(`/api/v1/orders/${id}/fulfill`);
      spinner.succeed(chalk.green(`Order ${id} fulfilled`));
    } catch (e) { fail(spinner, 'Failed to fulfill order', e); }
  });

ordersCommand
  .command('quick-sale')
  .description('Single-line POS-style sale (one product, one customer)')
  .requiredOption('--product <id>', 'Product ID')
  .requiredOption('--quantity <n>', 'Quantity')
  .option('--customer-email <email>')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Recording quick sale...').start();
    try {
      const body: Record<string, unknown> = {
        product_id: parseInt(opts.product, 10),
        quantity: parseInt(opts.quantity, 10),
      };
      if (opts.customerEmail) body.customer_email = opts.customerEmail;
      const res = await apiClient.post('/api/v1/orders/quick-sale', body);
      const o = res.data as Record<string, any>;
      spinner.succeed(chalk.green(`Sale recorded: order ${o.order_id || o.id}`));
    } catch (e) { fail(spinner, 'Failed to record sale', e); }
  });

ordersCommand.addHelpText('after', `
Examples:
  $ solid orders list                              # First page
  $ solid orders list --all --json                 # All orders, one JSON array
  $ solid orders list --status paid --limit 50     # Filter + paginate
  $ solid orders get 1234                          # Detail view
  $ solid orders import ./sales.csv --preview      # Dry-run a bulk CSV import
  $ solid orders import ./sales.csv --concurrency 5
  $ solid orders import ./sales.csv --from 200     # Resume after row 200
  $ solid orders watch ./inbox/                    # Auto-import files dropped in a folder

CSV columns (flexible; map with --map=src:dest): customer_email, amount,
status, external_id. Unknown columns are forwarded as metadata. Empty files
and malformed rows are reported, not retried silently.
`);
