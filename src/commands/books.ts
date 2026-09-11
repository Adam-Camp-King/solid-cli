/**
 * The books from the terminal — money in, money out, one picture.
 *
 *   solid books summary                      in vs out, owed to you, you owe
 *   solid invoices list|get|aging|summary    money in (reads)
 *   solid invoices pay|cancel                money in (writes, --confirm)
 *   solid expenses list|get|aging|summary|vendors   money out (reads)
 *   solid expenses file|pay|void             money out (writes, --confirm)
 *
 * ⭐ Solid# is the book of record for AR and AP — every company has these,
 * with or without QuickBooks / Xero / FreshBooks (those are optional mirrors:
 * `solid accounting`). Every command is a thin wrapper over a verb the same
 * company's ADA, MCP and web use, so the answer is identical everywhere:
 *   reads  → manifest verbs (invoice.*, expense.*, vendor.list, books.summary)
 *   writes → ADA verbs through /api/v1/ada/cli-dispatch (invoice_record_payment,
 *            invoice_cancel, expense_create, bill_mark_paid, expense_void)
 * Writes refuse to run without --confirm. They RECORD money — none pays anyone.
 * Any verb without a shortcut: `solid agent dispatch <verb> --args '{…}' --confirm`.
 */
import { Command } from 'commander';
import chalk from 'chalk';

import { appendExamples } from '../lib/command-kit';
import { dispatchVerbShortcut as dispatch, invokeAgentVerbShortcut as read } from './dispatch_shortcuts';

type Opts = Record<string, any>;

function requireConfirm(options: Opts, what: string): void {
  if (!options.confirm) {
    console.error(chalk.red(`Refusing to ${what} without --confirm.`));
    process.exit(2);
  }
}

function money(value: string, flag: string): number {
  const n = Number(String(value).replace(/[$,]/g, ''));
  if (!Number.isFinite(n) || n <= 0) {
    console.error(chalk.red(`${flag} must be an amount greater than 0 (got "${value}").`));
    process.exit(2);
  }
  return n;
}

function present(entries: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(entries).filter(([, v]) => v !== undefined && v !== null && v !== ''));
}


// ── solid books ─────────────────────────────────────────────────────────────

export const booksCommand = new Command('books')
  .description("The books — money in and out from Solid#'s own records (with or without an accounting system)");

booksCommand
  .command('summary')
  .description('Invoiced / collected, spent / billed, what customers owe you, what you owe')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--until <date>', 'YYYY-MM-DD')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('books.summary', present({ since: options.since, until: options.until }), options, 'Reading the books...');
  });

appendExamples(booksCommand, [
  { cmd: 'solid books summary', why: 'How am I doing — in, out, owed both ways' },
  { cmd: 'solid books summary --since 2026-09-01 --until 2026-09-30', why: 'One month' },
]);


// ── solid invoices (money in) ───────────────────────────────────────────────

export const invoicesCommand = new Command('invoices')
  .description('Money in — invoices, who owes you, recording payments');

invoicesCommand
  .command('list')
  .description('Invoices, newest first')
  .option('--status <status>', 'draft | sent | viewed | partial_paid | paid | overdue | cancelled')
  .option('--open', 'Only invoices with money still owed')
  .option('--overdue', 'Only overdue invoices')
  .option('--contact-id <id>', 'One customer (CRM contact id)')
  .option('--limit <n>', 'How many', '50')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('invoice.list', present({
      status: options.status, open_only: options.open ? true : undefined,
      overdue_only: options.overdue ? true : undefined,
      contact_id: options.contactId ? Number(options.contactId) : undefined, limit: Number(options.limit),
    }), options, 'Loading invoices...');
  });

invoicesCommand
  .command('get <invoice_id>')
  .description('One invoice with its lines and every payment on it')
  .option('--json', 'Output as JSON')
  .action(async (invoiceId: string, options: Opts) => {
    await read('invoice.get', { invoice_id: Number(invoiceId) }, options, `Loading invoice ${invoiceId}...`);
  });

invoicesCommand
  .command('aging')
  .description('What customers owe you, by how overdue')
  .option('--as-of <date>', 'YYYY-MM-DD; default today')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('invoice.receivables', present({ as_of: options.asOf }), options, 'Aging receivables...');
  });

invoicesCommand
  .command('summary')
  .description('Invoiced, collected and still owed — by customer, month or status')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--until <date>', 'YYYY-MM-DD')
  .option('--group-by <by>', 'customer | month | status', 'customer')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('invoice.summary', present({ since: options.since, until: options.until, group_by: options.groupBy }),
      options, 'Summarising money in...');
  });

invoicesCommand
  .command('pay <invoice_id>')
  .description('Record money a customer paid on an invoice (records it — charges no one)')
  .requiredOption('--amount <n>', 'Amount received')
  .option('--method <m>', 'cash | check | card | ach | bank_transfer | venmo | zelle | other', 'other')
  .option('--date <date>', 'YYYY-MM-DD received; default today')
  .option('--reference <ref>', 'Check or confirmation number')
  .option('--notes <text>', 'Notes')
  .option('--confirm', 'Required: actually record the payment')
  .option('--json', 'Output as JSON')
  .action(async (invoiceId: string, options: Opts) => {
    requireConfirm(options, 'record a payment');
    await dispatch('invoice_record_payment', present({
      invoice_id: Number(invoiceId), amount: money(options.amount, '--amount'), method: options.method,
      received_at: options.date, reference: options.reference, notes: options.notes,
    }), options, `Recording a payment on invoice ${invoiceId}...`);
  });

invoicesCommand
  .command('cancel <invoice_id>')
  .description('Cancel an invoice — never deleted; the reason stays on it')
  .requiredOption('--reason <text>', 'Why')
  .option('--confirm', 'Required: actually cancel the invoice')
  .option('--json', 'Output as JSON')
  .action(async (invoiceId: string, options: Opts) => {
    requireConfirm(options, 'cancel an invoice');
    await dispatch('invoice_cancel', { invoice_id: Number(invoiceId), reason: options.reason }, options,
      `Cancelling invoice ${invoiceId}...`);
  });

appendExamples(invoicesCommand, [
  { cmd: 'solid invoices aging', why: 'Who owes you, and how late' },
  { cmd: 'solid invoices list --overdue', why: 'Just the overdue ones' },
  { cmd: 'solid invoices pay 31 --amount 500 --method check --reference 1042 --confirm', why: 'A check came in' },
]);


// ── solid expenses (money out) ──────────────────────────────────────────────

export const expensesCommand = new Command('expenses')
  .description('Money out — expenses, bills, vendors');

expensesCommand
  .command('list')
  .description('Expenses and bills, newest first')
  .option('--kind <kind>', 'expense | bill')
  .option('--status <status>', 'draft | posted | paid | void')
  .option('--deal-id <id>', 'One job')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--until <date>', 'YYYY-MM-DD')
  .option('--limit <n>', 'How many', '50')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('expense.list', present({
      kind: options.kind, status: options.status, deal_id: options.dealId ? Number(options.dealId) : undefined,
      since: options.since, until: options.until, limit: Number(options.limit),
    }), options, 'Loading expenses...');
  });

expensesCommand
  .command('get <purchase_id>')
  .description('One expense or bill with its lines')
  .option('--json', 'Output as JSON')
  .action(async (purchaseId: string, options: Opts) => {
    await read('expense.get', { purchase_id: Number(purchaseId) }, options, `Loading ${purchaseId}...`);
  });

expensesCommand
  .command('aging')
  .description('Bills you owe, by how overdue')
  .option('--as-of <date>', 'YYYY-MM-DD; default today')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('expense.payables', present({ as_of: options.asOf }), options, 'Aging payables...');
  });

expensesCommand
  .command('summary')
  .description('Money out, paid and owed apart — by category, vendor, kind or job')
  .option('--since <date>', 'YYYY-MM-DD')
  .option('--until <date>', 'YYYY-MM-DD')
  .option('--group-by <by>', 'category | vendor | kind | deal', 'category')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('expense.summary', present({ since: options.since, until: options.until, group_by: options.groupBy }),
      options, 'Summarising money out...');
  });

expensesCommand
  .command('vendors')
  .description('The vendors this business buys from')
  .option('--search <text>', 'Name contains')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    await read('vendor.list', present({ search: options.search }), options, 'Loading vendors...');
  });

expensesCommand
  .command('file')
  .description('Record money spent (expense, paid) or owed (--bill)')
  .requiredOption('--vendor <name>', 'Who it was from')
  .requiredOption('--amount <n>', 'The total')
  .option('--bill', 'A bill still owed, instead of an expense already paid')
  .option('--category <c>', 'materials | fuel | tools | meals | rent | software …')
  .option('--date <date>', 'YYYY-MM-DD; default today')
  .option('--due <date>', 'Bills: YYYY-MM-DD due')
  .option('--reference <ref>', "The vendor's receipt or invoice number")
  .option('--deal-id <id>', 'The job it was for')
  .option('--notes <text>', 'Notes')
  .option('--confirm', 'Required: actually record it')
  .option('--json', 'Output as JSON')
  .action(async (options: Opts) => {
    requireConfirm(options, 'record an expense');
    await dispatch('expense_create', present({
      kind: options.bill ? 'bill' : 'expense', vendor_name: options.vendor, amount: money(options.amount, '--amount'),
      category: options.category, purchase_date: options.date, due_date: options.due, reference: options.reference,
      deal_id: options.dealId ? Number(options.dealId) : undefined, notes: options.notes,
    }), options, `Recording ${options.bill ? 'a bill' : 'an expense'} from ${options.vendor}...`);
  });

expensesCommand
  .command('pay <purchase_id>')
  .description('A bill was paid (records it — pays no one)')
  .option('--date <date>', 'YYYY-MM-DD paid; default today')
  .option('--method <m>', 'card | cash | check | ach | company_card | personal_reimburse | other')
  .option('--reference <ref>', 'Check or confirmation number')
  .option('--confirm', 'Required: actually mark it paid')
  .option('--json', 'Output as JSON')
  .action(async (purchaseId: string, options: Opts) => {
    requireConfirm(options, 'mark a bill paid');
    await dispatch('bill_mark_paid', present({
      purchase_id: Number(purchaseId), paid_at: options.date, payment_method: options.method, reference: options.reference,
    }), options, `Marking ${purchaseId} paid...`);
  });

expensesCommand
  .command('void <purchase_id>')
  .description('Void an expense or bill — never deleted; the reason stays on it')
  .requiredOption('--reason <text>', 'Why')
  .option('--confirm', 'Required: actually void it')
  .option('--json', 'Output as JSON')
  .action(async (purchaseId: string, options: Opts) => {
    requireConfirm(options, 'void a purchase');
    await dispatch('expense_void', { purchase_id: Number(purchaseId), reason: options.reason }, options,
      `Voiding ${purchaseId}...`);
  });

appendExamples(expensesCommand, [
  { cmd: 'solid expenses aging', why: 'Bills you owe, and how late' },
  { cmd: 'solid expenses file --vendor "Ferguson" --amount 110.70 --category materials --confirm', why: 'A receipt' },
  { cmd: 'solid expenses pay 12 --method check --reference 2210 --confirm', why: 'A bill was paid' },
]);
