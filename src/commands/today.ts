/**
 * `solid today` — the daily brief.
 *
 * One command that answers "what's going on and what should I do" — revenue,
 * pipeline, urgent work, and recommended actions — instead of stitching
 * together dashboard / sales / tasks / predictions by hand. The operator's
 * first command of the day.
 *
 * Data is assembled from existing REST endpoints (best-effort, degrades
 * gracefully if one is unavailable). The shaping logic is the pure
 * `buildBrief()` so it can be unit-tested without the network.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

type AnyRec = Record<string, any>;

export interface Brief {
  companyName: string | null;
  revenue: { net: number | null; orders: number | null; aov: number | null };
  pipeline: { total: number | null; openDeals: number | null };
  urgent: { taskCount: number; samples: string[] };
  actions: string[];
}

/** Pick the first present, finite number from a list of candidate values. */
function num(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c) : (c as number);
    if (typeof n === 'number' && Number.isFinite(n)) return n;
  }
  return null;
}

function asArray(v: unknown): AnyRec[] {
  if (Array.isArray(v)) return v as AnyRec[];
  if (v && typeof v === 'object') {
    const o = v as AnyRec;
    if (Array.isArray(o.tasks)) return o.tasks;
    if (Array.isArray(o.items)) return o.items;
    if (Array.isArray(o.results)) return o.results;
    if (Array.isArray(o.targets)) return o.targets;
  }
  return [];
}

/**
 * Pure: turn the (possibly partial) API payloads into a brief model.
 * Every field degrades to null/empty rather than throwing, so a missing
 * endpoint never breaks the brief.
 */
export function buildBrief(parts: {
  company?: AnyRec | null;
  summary?: AnyRec | null;
  tasks?: unknown;
  targets?: unknown;
}): Brief {
  const company = parts.company || {};
  const s = parts.summary || {};

  const revenue = {
    net: num(s.net_revenue, s.revenue, s.total_revenue, s.revenue_30_days, s.revenue?.net),
    orders: num(s.orders, s.order_count, s.total_orders, s.revenue?.orders),
    aov: num(s.average_order_value, s.aov, s.avg_order_value),
  };
  const pipeline = {
    total: num(s.pipeline_value, s.total_pipeline, s.pipeline?.total, s.pipeline_total),
    openDeals: num(s.open_deals, s.open_deals_count, s.deals_open, s.pipeline?.open_deals),
  };

  const taskList = asArray(parts.tasks);
  const urgent = {
    taskCount: num(
      (parts.tasks as AnyRec)?.total,
      (parts.tasks as AnyRec)?.count,
      taskList.length,
    ) ?? taskList.length,
    samples: taskList
      .slice(0, 3)
      .map((t) => String(t.title || t.name || t.description || 'Untitled task').slice(0, 80)),
  };

  // Recommended actions: prefer server-suggested targets, else derive from state.
  const targetList = asArray(parts.targets);
  const actions: string[] = targetList
    .slice(0, 5)
    .map((t) => String(t.title || t.recommendation || t.action || '').trim())
    .filter(Boolean);

  if (actions.length === 0) {
    if (urgent.taskCount > 0) actions.push(`Clear ${urgent.taskCount} pending task(s)`);
    if ((pipeline.openDeals ?? 0) > 0) actions.push(`Follow up on ${pipeline.openDeals} open deal(s)`);
    if (actions.length === 0) actions.push('No urgent items — good time to prospect or publish content');
  }

  return {
    companyName: company.name ?? null,
    revenue,
    pipeline,
    urgent,
    actions,
  };
}

function money(n: number | null): string {
  if (n === null) return chalk.dim('—');
  return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function render(brief: Brief): void {
  console.log('');
  console.log(ui.header(`Daily Brief${brief.companyName ? ' — ' + brief.companyName : ''}`));

  console.log('');
  console.log(chalk.bold('Revenue'));
  console.log('  ' + ui.label('Net (recent)', money(brief.revenue.net)));
  if (brief.revenue.orders !== null) console.log('  ' + ui.label('Orders', String(brief.revenue.orders)));
  if (brief.revenue.aov !== null) console.log('  ' + ui.label('Avg order', money(brief.revenue.aov)));

  console.log('');
  console.log(chalk.bold('Pipeline'));
  console.log('  ' + ui.label('Open pipeline', money(brief.pipeline.total)));
  console.log('  ' + ui.label('Open deals', brief.pipeline.openDeals !== null ? String(brief.pipeline.openDeals) : chalk.dim('—')));

  console.log('');
  console.log(chalk.bold('Urgent work'));
  console.log('  ' + ui.label('Pending tasks', String(brief.urgent.taskCount)));
  for (const s of brief.urgent.samples) console.log(chalk.dim('    • ' + s));

  console.log('');
  console.log(chalk.bold('Recommended actions'));
  brief.actions.forEach((a, i) => console.log(`  ${chalk.cyan(String(i + 1) + '.')} ${a}`));
  console.log('');
}

export const todayCommand = new Command('today')
  .description('Your daily brief: revenue, pipeline, urgent work, recommended actions')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Building your brief...').start();
    try {
      const [companyRes, summaryRes, tasksRes, targetsRes] = await Promise.allSettled([
        apiClient.companyInfo(),
        apiClient.get('/api/v1/crm/dashboard/summary'),
        apiClient.get('/api/v1/crm/tasks', { params: { status: 'pending', limit: 50 } }),
        apiClient.get('/api/v1/predictions/targets'),
      ]);
      spinner.stop();

      const pick = (r: PromiseSettledResult<any>): AnyRec | null =>
        r.status === 'fulfilled' ? ((r.value?.data as AnyRec) ?? null) : null;

      const brief = buildBrief({
        company: (pick(companyRes) as AnyRec)?.company ?? pick(companyRes),
        summary: pick(summaryRes),
        tasks: pick(tasksRes),
        targets: pick(targetsRes),
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
