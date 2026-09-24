/**
 * solid publish — make CMS pages live (T12).
 *
 *   solid publish <page_id>        Promote the pending draft on one page + flip is_published
 *   solid publish --all            Publish every page that is not fully live:
 *                                    • pages with a pending draft, and
 *                                    • pages that have NEVER been published
 *                                  one page at a time through the per-page publish
 *                                  endpoint (paywall + guardrails run for each),
 *                                  with a per-page result.
 *   solid publish --all --drafts-only
 *                                  Old behaviour: only promote pending drafts
 *                                  (POST /cms/pages/drafts/publish-all).
 *
 * Why --all changed: the backend's publish-all only touches rows that carry a
 * draft. A page created by `solid push` lands unpublished with its content on
 * the live fields and no draft, so `--all` reported "No pending drafts" and the
 * page never went live.
 *
 * Pairs with `solid drafts list` + `solid pages update <id>`.
 */

import { Command } from 'commander';
import ora from '../lib/spinner';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { fail, requireCompanyContext } from '../lib/command-kit';
import { isJsonOutput, printJson } from '../lib/json-output';
import { resolvePublicUrl } from '../lib/page-url';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export interface PublishCandidate {
  page_id: number;
  slug?: string;
  title?: string;
  reason: 'pending_draft' | 'never_published';
}

export interface PublishResult extends PublishCandidate {
  status: 'published' | 'failed' | 'skipped';
  http_status?: number;
  error?: string;
}

/**
 * Pure: merge the drafts list and the unpublished-pages list into one ordered,
 * de-duplicated set. A page in both is reported once, as `pending_draft`.
 */
export function planPublishAll(
  drafts: Array<{ page_id?: number; slug?: string; title?: string }>,
  unpublished: Array<{ id?: number; slug?: string; title?: string; is_published?: boolean }>,
): PublishCandidate[] {
  const seen = new Set<number>();
  const out: PublishCandidate[] = [];
  for (const d of drafts) {
    if (typeof d.page_id !== 'number' || seen.has(d.page_id)) continue;
    seen.add(d.page_id);
    out.push({ page_id: d.page_id, slug: d.slug, title: d.title, reason: 'pending_draft' });
  }
  for (const p of unpublished) {
    if (typeof p.id !== 'number' || seen.has(p.id) || p.is_published === true) continue;
    seen.add(p.id);
    out.push({ page_id: p.id, slug: p.slug, title: p.title, reason: 'never_published' });
  }
  return out;
}

const PAGE_SIZE = 100; // backend caps `limit` at 100

async function listUnpublishedPages(): Promise<Array<Record<string, any>>> {
  const all: Array<Record<string, any>> = [];
  for (let skip = 0; skip < 10_000; skip += PAGE_SIZE) {
    const res = await apiClient.get('/api/v1/cms/pages', {
      params: { published: false, skip, limit: PAGE_SIZE },
    });
    const body = (res.data || {}) as Record<string, any>;
    const rows: Array<Record<string, any>> = body.pages || body.items || [];
    all.push(...rows);
    const total = typeof body.total === 'number' ? body.total : undefined;
    if (rows.length < PAGE_SIZE || (total !== undefined && all.length >= total)) break;
  }
  return all;
}

async function publishAll(json: boolean): Promise<void> {
  const spinner = ora({ text: 'Finding pages that are not live...', isSilent: json }).start();
  let plan: PublishCandidate[] = [];
  try {
    const draftsRes = await apiClient.get('/api/v1/cms/pages/drafts/list');
    const drafts = ((draftsRes.data || {}) as Record<string, any>).drafts || [];
    const unpublished = await listUnpublishedPages();
    plan = planPublishAll(drafts, unpublished);
  } catch (error) {
    fail(spinner, 'Could not list pages to publish', error);
  }

  if (plan.length === 0) {
    spinner.stop();
    if (json) {
      printJson({ published: 0, failed: 0, skipped: 0, results: [] });
    } else {
      console.log(chalk.yellow('  Nothing to publish — no pending drafts and no unpublished pages.'));
    }
    return;
  }

  const results: PublishResult[] = [];
  let paywalled: string | null = null;
  for (const c of plan) {
    if (paywalled) {
      results.push({ ...c, status: 'skipped', http_status: 402, error: paywalled });
      continue;
    }
    spinner.text = `Publishing page ${c.page_id}${c.slug ? ` (/${c.slug})` : ''}...`;
    try {
      await apiClient.post(`/api/v1/cms/pages/${c.page_id}/publish`, {});
      results.push({ ...c, status: 'published' });
    } catch (error) {
      const e = handleApiError(error);
      results.push({ ...c, status: 'failed', http_status: e.status, error: e.message });
      // The paywall is company-wide: every remaining page would get the same
      // 402, so stop calling and say so instead of hammering the endpoint.
      if (e.status === 402) paywalled = e.message || 'Payment required to publish';
    }
  }
  spinner.stop();

  const published = results.filter((r) => r.status === 'published').length;
  const failed = results.filter((r) => r.status === 'failed').length;
  const skipped = results.filter((r) => r.status === 'skipped').length;

  if (json) {
    printJson({ published, failed, skipped, results });
  } else {
    console.log('');
    for (const r of results) {
      const label = `page ${r.page_id}${r.slug ? ` /${r.slug}` : ''}${r.title ? ` — ${r.title}` : ''}`;
      const why = chalk.dim(`[${r.reason === 'pending_draft' ? 'pending draft' : 'never published'}]`);
      if (r.status === 'published') console.log(`  ${chalk.green('✓')} ${label} ${why}`);
      else if (r.status === 'skipped') console.log(`  ${chalk.dim('-')} ${label} ${why} ${chalk.dim('skipped (publishing is blocked for this company)')}`);
      else console.log(`  ${chalk.red('✗')} ${label} ${why} ${chalk.red(r.error || 'failed')}`);
    }
    console.log('');
    const summary = `${published} published, ${failed} failed, ${skipped} skipped`;
    console.log(failed + skipped > 0 ? chalk.yellow(`  ${summary}`) : chalk.green(`  ${summary}`));
    if (paywalled) console.log(chalk.yellow(`  ${paywalled}`));
    console.log('');
  }
  if (failed + skipped > 0) process.exitCode = 1;
}

export const publishCommand = new Command('publish')
  .description('Make CMS pages live — one page, or --all (pending drafts + never-published pages)')
  .argument('[page_id]', 'Page ID to publish (omit with --all)')
  .option('--all', 'Publish every pending draft AND every never-published page, one page at a time')
  .option('--drafts-only', 'With --all: only promote pending drafts (skips never-published pages)')
  .option('--json', 'JSON output (per-page results with --all)')
  .action(async (pageId: string | undefined, opts) => {
    requireAuth();
    await requireCompanyContext();

    if (opts.all && pageId) {
      console.error(chalk.red('Pass EITHER a <page_id> OR --all, not both.'));
      process.exit(1);
    }
    if (!opts.all && !pageId) {
      console.error(chalk.red('Pass a <page_id> or use --all.'));
      process.exit(1);
    }
    if (opts.draftsOnly && !opts.all) {
      console.error(chalk.red('--drafts-only only applies with --all.'));
      process.exit(1);
    }
    const json = isJsonOutput(opts);

    if (opts.all && !opts.draftsOnly) {
      await publishAll(json);
      return;
    }

    if (opts.all) {
      const spinner = ora({ text: 'Publishing all pending drafts...', isSilent: json }).start();
      try {
        const res = await apiClient.post('/api/v1/cms/pages/drafts/publish-all');
        const r = res.data as Record<string, any>;
        spinner.stop();
        if (json) { printJson(r); return; }
        if (r.promoted === 0) {
          console.log(chalk.yellow('  No pending drafts to promote (never-published pages are skipped by --drafts-only)'));
          return;
        }
        console.log(chalk.green(`  Promoted ${r.promoted} draft(s) → live`));
        for (const id of (r.page_ids as number[]) || []) {
          console.log(chalk.dim(`  ✓ page ${id}`));
        }
      } catch (error) { fail(spinner, 'publish-all failed', error); }
      return;
    }

    const id = parseInt(pageId!, 10);
    if (isNaN(id)) {
      console.error(chalk.red('Invalid page ID.'));
      process.exit(1);
    }
    const spinner = ora({ text: `Publishing page ${id}...`, isSilent: json }).start();
    try {
      const res = await apiClient.post(`/api/v1/cms/pages/${id}/publish`, {});
      // The publish response has no address, and `url: null` read as "not
      // live" when the page was being served. Compute it from the page's
      // site (or /p/<slug> on the primary site for an unattached page), and
      // when that is impossible say why instead of returning a bare null.
      const where = await resolvePublicUrl(id);
      spinner.stop();
      const body = (res.data && typeof res.data === 'object' ? res.data : {}) as Record<string, unknown>;
      if (json) {
        printJson({
          ...body,
          page_id: id,
          published: true,
          url: (typeof body.url === 'string' && body.url) ? body.url : where.url,
          ...(where.url_basis ? { url_basis: where.url_basis } : {}),
          ...(where.url_unavailable_reason && !(typeof body.url === 'string' && body.url)
            ? { url_unavailable_reason: where.url_unavailable_reason } : {}),
          site_id: where.site_id ?? null,
        });
        return;
      }
      console.log(chalk.green(`  Page ${id} published`));
      console.log(chalk.dim(`  Pending draft (if any) was promoted to live.`));
      if (where.url) console.log(chalk.dim(`  ${where.url}`));
      else if (where.url_unavailable_reason) console.log(chalk.yellow(`  No public URL: ${where.url_unavailable_reason}`));
    } catch (error) { fail(spinner, 'Publish failed', error); }
  });

import { appendExamples as __ae_publish } from '../lib/command-kit';
__ae_publish(publishCommand, [
  { cmd: 'solid publish <id>',                why: 'Make one page live (promotes its pending draft)' },
  { cmd: 'solid publish --all',               why: 'Pending drafts + never-published pages, per-page results' },
  { cmd: 'solid publish --all --drafts-only', why: 'Only promote pending drafts' },
  { cmd: 'solid drafts list',                 why: 'See what pending drafts exist first' },
], 'Note: --all also publishes pages that were never published, including any page created but meant to stay private. Use --drafts-only to avoid that.');
