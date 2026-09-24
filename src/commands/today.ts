/**
 * `solid today` — the daily brief.
 *
 * ⛔ THIS COMMAND DOES NOT COMPUTE A BRIEF. It renders the platform's one
 * brief (`GET /api/v1/dashboard/brief`), the same payload the web Daily Brief
 * page reads, whose "what needs you" list comes from `services/needs_you.py`
 * — the same list the phone's Home shows.
 *
 * ⛔ WHY (2026-09-23). It used to stitch four endpoints together itself
 * (/crm/dashboard/summary, /crm/tasks, /predictions/targets) and guess at
 * field names — `net_revenue`, `pipeline_value`, `open_deals`. None of those
 * keys exists at the top level of /crm/dashboard/summary: revenue lives at
 * `overview.revenue.revenue` and pipeline at `insights.pipeline`. So every
 * number came back **null**, with no reason, forever. Worse, the pipeline
 * payload it ignored was already carrying `available: false` and a sentence
 * explaining itself — the platform knew why and the brief threw it away.
 *
 * It also reported the raw pending-task total as "urgent": 785 of them, every
 * sample reading "CALLBACK REQUEST: Chat Visitor". Those are now one grouped
 * item with a count, decided once in `services/needs_you.py`, so the phone,
 * the web page and this command agree.
 *
 * The shaping is the pure `buildBrief()` so it can be unit-tested offline.
 */

import { Command } from 'commander';
import ora from '../lib/spinner';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

type AnyRec = Record<string, any>;

/**
 * A number the platform either measured or could not.
 *
 * ⛔ `available: false` means NOT MEASURED — never render it as 0. `value: 0`
 * with `available: true` means measured and empty, which is a fact. A reader
 * that cannot tell those apart reports a false zero, and a false zero is worse
 * than a null.
 */
export interface Metric {
  value: number | null;
  available: boolean;
  /** Plain words: why it is missing, or why it is zero. */
  reason: string | null;
}

export interface NeedsYouItem {
  title: string;
  kicker: string | null;
  priority: string;
  /** How many rows this one item stands for (a grouped backlog), else null. */
  count: number | null;
}

export interface Brief {
  companyName: string | null;
  date: string | null;
  summary: string | null;
  revenue: Metric & { change: number | null; period: string | null };
  pipeline: Metric & { openDeals: number | null };
  tasks: { open: Metric; overdue: number | null; completed: number | null };
  needsYou: { items: NeedsYouItem[]; grouped: number };
  actions: string[];
}

/** A finite number, or null. Never coerces absent/garbage to 0. */
function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v) : (v as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

/**
 * Read one `keyMetrics` entry. `available` is trusted when the server sends it;
 * an older server that does not gets the honest fallback — a present number is
 * measured, an absent one is unknown with no reason we can invent.
 */
function metric(m: AnyRec | null | undefined, key = 'value'): Metric {
  const value = num(m?.[key]);
  const available = typeof m?.available === 'boolean' ? m.available : value !== null;
  return {
    value: available ? value : null,
    available,
    reason: (m?.reason ?? null) as string | null,
  };
}

function asArray(v: unknown): AnyRec[] {
  return Array.isArray(v) ? (v as AnyRec[]) : [];
}

/**
 * Pure: the brief payload (plus the company record, for its name) as the
 * model this command renders. Every field degrades to null/empty rather than
 * throwing, so a partial payload never breaks the brief.
 */
export function buildBrief(parts: { company?: AnyRec | null; brief?: AnyRec | null }): Brief {
  const company = parts.company || {};
  const b = parts.brief || {};
  const km = (b.keyMetrics || {}) as AnyRec;
  // The brief itself did not come back. Say that once, on every number, rather
  // than four bare nulls that look like "you have no revenue".
  if (!parts.brief) {
    const dead: AnyRec = { value: null, available: false, reason: 'The daily brief could not be read from the server.' };
    km.revenue = km.revenue || dead;
    km.pipeline = km.pipeline || dead;
    km.tasks = km.tasks || dead;
  }

  const revenue = { ...metric(km.revenue), change: num(km.revenue?.change), period: (km.revenue?.period ?? null) as string | null };
  const pipeline = { ...metric(km.pipeline), openDeals: num(km.pipeline?.openDeals) };
  const tasks = {
    open: metric(km.tasks),
    overdue: num(km.tasks?.overdue),
    completed: num(km.tasks?.completed),
  };

  const items: NeedsYouItem[] = asArray(b.priorities)
    .map((p) => ({
      title: String(p.title || '').trim(),
      kicker: (p.subtitle ?? null) || null,
      priority: String(p.priority || 'medium'),
      count: num(p.count),
    }))
    .filter((i) => i.title.length > 0);

  // The rows the grouped items stand for — so "1 item" never hides 785 rows.
  const grouped = items.reduce((sum, i) => sum + (i.count && i.count > 1 ? i.count : 0), 0);

  const actions: string[] = asArray(b.recommendations).map((r) => String(r).trim()).filter(Boolean);

  return {
    companyName: (company.name ?? null) as string | null,
    date: (b.date ?? null) as string | null,
    summary: (b.summary ?? null) as string | null,
    revenue,
    pipeline,
    tasks,
    needsYou: { items, grouped },
    actions,
  };
}

function money(m: Metric): string {
  if (m.value === null) return chalk.dim('—');
  return '$' + m.value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function count(v: number | null): string {
  return v === null ? chalk.dim('—') : String(v);
}

/** The reason line under a number. This is the whole point: never a bare null. */
function why(m: { available: boolean; reason: string | null }): void {
  if (m.reason) console.log(chalk.dim('    ' + (m.available ? '' : 'not measured — ') + m.reason));
  else if (!m.available) console.log(chalk.dim('    not measured, and the server gave no reason'));
}

function render(brief: Brief): void {
  console.log('');
  console.log(ui.header(`Daily Brief${brief.companyName ? ' — ' + brief.companyName : ''}${brief.date ? ' · ' + brief.date : ''}`));
  if (brief.summary) {
    console.log('');
    console.log('  ' + brief.summary);
  }

  console.log('');
  console.log(chalk.bold('Revenue'));
  console.log('  ' + ui.label(brief.revenue.period || 'Recent', money(brief.revenue)));
  why(brief.revenue);

  console.log('');
  console.log(chalk.bold('Pipeline'));
  console.log('  ' + ui.label('Open pipeline', money(brief.pipeline)));
  console.log('  ' + ui.label('Open deals', count(brief.pipeline.openDeals)));
  why(brief.pipeline);

  console.log('');
  console.log(chalk.bold('Open tasks'));
  console.log('  ' + ui.label('On the books', count(brief.tasks.open.value)));
  console.log('  ' + ui.label('Overdue', count(brief.tasks.overdue)));
  why(brief.tasks.open);

  console.log('');
  console.log(chalk.bold('Needs you'));
  if (brief.needsYou.items.length === 0) {
    console.log(chalk.dim('    nothing is waiting on you'));
  }
  for (const i of brief.needsYou.items) {
    const tag = i.count && i.count > 1 ? chalk.dim(` (${i.count} rows, grouped)`) : '';
    console.log(`    • ${i.title}${tag}`);
    if (i.kicker) console.log(chalk.dim(`      ${i.kicker} · ${i.priority}`));
  }

  if (brief.actions.length) {
    console.log('');
    console.log(chalk.bold('Recommended actions'));
    brief.actions.forEach((a, i) => console.log(`  ${chalk.cyan(String(i + 1) + '.')} ${a}`));
  }
  console.log('');
}

export const todayCommand = new Command('today')
  .description('Your daily brief: revenue, pipeline, what needs you, recommended actions')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Building your brief...').start();
    try {
      const [companyRes, briefRes] = await Promise.allSettled([
        apiClient.companyInfo(),
        apiClient.get('/api/v1/dashboard/brief'),
      ]);
      spinner.stop();

      const pick = (r: PromiseSettledResult<any>): AnyRec | null =>
        r.status === 'fulfilled' ? ((r.value?.data as AnyRec) ?? null) : null;

      const brief = buildBrief({
        company: (pick(companyRes) as AnyRec)?.company ?? pick(companyRes),
        brief: pick(briefRes),
      });

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(brief, null, 2));
        return;
      }
      render(brief);
    } catch (error) {
      spinner.fail(chalk.red('Failed to build brief'));
      console.error(handleApiError(error).message);
      process.exit(1);
    }
  });
