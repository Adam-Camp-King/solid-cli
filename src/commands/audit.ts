import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const auditCommand = new Command('audit')
  .description('Activity log — who changed what, when')
  .option('--limit <n>', 'Number of entries', '20')
  .option('--user <email>', 'Filter by user email')
  .option('--action <type>', 'Filter by action (create, update, delete)')
  .option('--by-key <id>', 'T11 — filter to one API key (what did Claude do?)')
  .option('--since <duration>', 'T11 — relative window: 15m, 1h, 24h, 7d')
  .option('--method <verb>', 'T11 — filter by HTTP method: GET/POST/PUT/PATCH/DELETE')
  .option('--status <code>', 'T11 — filter by HTTP status code (e.g. 200, 403)')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;

    // ── T11.6 — by-key mode: hit the per-key audit endpoint ────────────
    if (options.byKey) {
      const keyId = parseInt(options.byKey, 10);
      if (!keyId) {
        console.error(chalk.red('--by-key must be a numeric API key id. Use `solid auth token list` to see ids.'));
        process.exit(1);
      }
      const params: Record<string, unknown> = { limit: options.limit };
      if (options.since) params.since = options.since;
      if (options.method) params.method = options.method;
      if (options.status) params.status_code = options.status;

      const spinner = ora(`Loading audit for key #${keyId}...`).start();
      try {
        const res = await apiClient.get(`/api/v1/cli/api-keys/${keyId}/audit`, { params });
        spinner.stop();
        const data = res.data as Record<string, any>;
        if (isJsonOutput(options)) { console.log(JSON.stringify(data, null, 2)); return; }
        const events: any[] = data.events || [];
        console.log('');
        console.log(ui.header(`Audit — key "${data.api_key_name}" (id=${data.api_key_id})`));
        if (data.since) console.log(chalk.dim(`  Since: ${data.since}`));
        if (events.length === 0) {
          console.log(chalk.dim('  No events in this window.'));
        } else {
          for (const e of events) {
            const color = e.status_code >= 500 ? chalk.red
              : e.status_code >= 400 ? chalk.yellow
              : e.status_code >= 300 ? chalk.blue
              : chalk.green;
            console.log(`  ${chalk.dim(e.created_at)}  ${color(String(e.status_code).padEnd(3))}  ${(e.method || '').padEnd(6)}  ${chalk.cyan(e.path)}  ${chalk.dim(`${e.response_time_ms ?? '?'}ms`)}`);
          }
        }
        console.log('');
        console.log(chalk.dim(`  ${events.length} event(s) shown.`));
        console.log('');
      } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
      return;
    }

    const spinner = ora('Loading audit log...').start();
    try {
      const params: Record<string, unknown> = { limit: options.limit };
      if (options.user) params.user_email = options.user;
      if (options.action) params.action_type = options.action;
      const res = await apiClient.get('/api/v1/security/audit/logs', { params });
      spinner.stop();
      if (isJsonOutput(options)) { console.log(JSON.stringify(res.data, null, 2)); return; }
      const entries = (res.data as Record<string, any>).entries || (res.data as Record<string, any>).logs || (res.data as Record<string, any>).items || [];
      console.log('');
      console.log(ui.header(`Audit Log (${entries.length})`));
      if (entries.length === 0) { console.log(chalk.dim('  No activity recorded yet.')); }
      else {
        for (const entry of entries) {
          const action = entry.action || entry.action_type || '';
          const color = action === 'delete' ? chalk.red : action === 'create' ? chalk.green : chalk.yellow;
          const user = entry.user_email || entry.user || '';
          const entity = entry.entity_type || entry.resource || '';
          const time = entry.created_at || entry.timestamp || '';
          console.log(`  ${chalk.dim(time)}  ${color(action.padEnd(8))}  ${entity}  ${chalk.dim(user)}`);
        }
      }
      console.log('');
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

// ── Subcommands for the rest of the security/audit surface ─────────

auditCommand.command('export').description('Export audit logs (CSV)')
  .option('--from <date>', 'Start date (YYYY-MM-DD)')
  .option('--to <date>', 'End date (YYYY-MM-DD)')
  .option('-o, --output <path>', 'Save to file')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Exporting...').start();
    try {
      const params: Record<string, unknown> = {};
      if (options.from) params.from_date = options.from;
      if (options.to) params.to_date = options.to;
      const res = await apiClient.get('/api/v1/security/audit/export', { params });
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (options.output) {
        (await import('fs')).writeFileSync(options.output, body);
        spinner.succeed(chalk.green(`Saved to ${options.output}`));
      } else {
        spinner.stop();
        process.stdout.write(body);
      }
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('suspicious <userId>').description('Suspicious activity for a user')
  .option('--json', 'JSON output')
  .action(async (userId, options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/security/audit/suspicious/${userId}`);
      if (isJsonOutput(options)) { spinner.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      spinner.succeed(chalk.green('Suspicious activity'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('compliance-report').description('Compliance summary report')
  .action(async () => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/security/compliance/report');
      spinner.succeed(chalk.green('Compliance'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('gdpr-export').description('Trigger GDPR data export for a user')
  .requiredOption('--user <id>', 'User ID')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Initiating GDPR export...').start();
    try {
      const res = await apiClient.post('/api/v1/security/gdpr/export', { user_id: parseInt(options.user, 10) });
      spinner.succeed(chalk.green('GDPR export started'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('gdpr-delete').description('Trigger GDPR data deletion (right to be forgotten)')
  .requiredOption('--user <id>', 'User ID')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Initiating GDPR deletion...').start();
    try {
      await apiClient.post('/api/v1/security/gdpr/delete', { user_id: parseInt(options.user, 10) });
      spinner.succeed(chalk.green('GDPR deletion initiated'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('gdpr-consent <userId>').description('Get a user\'s GDPR consent record')
  .action(async (userId) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Loading consent...').start();
    try {
      const res = await apiClient.get(`/api/v1/security/gdpr/consent/${userId}`);
      spinner.succeed(chalk.green('Consent'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

auditCommand.command('gdpr-consent-set').description('Record a GDPR consent decision')
  .requiredOption('--user <id>', 'User ID')
  .requiredOption('--consent <type>', 'Consent type key')
  .requiredOption('--granted <bool>', 'true|false')
  .action(async (options) => {
    if (!config.isLoggedIn()) { console.error(chalk.red('Not logged in.')); process.exit(1); }
    const ora = (await import('ora')).default;
    const spinner = ora('Recording...').start();
    try {
      await apiClient.post('/api/v1/security/gdpr/consent', {
        user_id: parseInt(options.user, 10),
        consent_type: options.consent,
        granted: options.granted === 'true',
      });
      spinner.succeed(chalk.green('Consent recorded'));
    } catch (e) { spinner.fail(chalk.red('Failed')); console.error(handleApiError(e).message); process.exit(1); }
  });

// ---------------------------------------------------------------------------
// A.5 — `solid audit a11y|perf|mobile <slug>`
//
// Lighthouse-style page quality scoring. The existing `audit` family
// is activity-log focused; these are page-quality focused. Same verb
// (`audit`) because the user-facing word is the same — quality gates
// are audits too.
//
// Each subcommand:
//   - takes a page slug (e.g. "home", "pricing", "/about")
//   - hits the same Chromium installer that `solid render` uses
//   - runs Lighthouse with the relevant category enabled
//   - prints a 0..100 score, top issues sorted by severity
//   - exits 1 if score < --threshold (default 80) — CI-gateable
// ---------------------------------------------------------------------------

import type { LighthouseCategory } from '../lib/lighthouse-runner';

function makeQualityAudit(name: 'a11y' | 'perf' | 'mobile', categoryDescription: string) {
  return auditCommand
    .command(`${name} <slug>`)
    .description(`${categoryDescription} (Lighthouse-driven, A.5)`)
    .option('--url <baseUrl>', 'Override the base URL. Defaults to https://app.solidnumber.com.')
    .option('--threshold <score>', 'Exit 1 if score below this 0..100 value', '80')
    .option('--keep-raw', 'Include the full Lighthouse JSON in --json output (large)')
    .option('--json', 'Emit JSON for programmatic consumption')
    .action(async (slug: string, opts: { url?: string; threshold: string; keepRaw?: boolean; json?: boolean }) => {
      const ora = (await import('ora')).default;
      const { runLighthouse } = await import('../lib/lighthouse-runner');
      const { buildRenderUrl } = await import('../lib/render-utils');

      const baseUrl = opts.url || process.env.SOLID_RENDER_BASE || 'https://app.solidnumber.com';
      const fullUrl = buildRenderUrl(baseUrl, slug);
      const threshold = Math.max(0, Math.min(100, parseInt(opts.threshold, 10) || 80));

      const spinner = ora({ text: `Auditing ${categoryDescription.toLowerCase()} on ${fullUrl}…`, stream: process.stderr }).start();
      try {
        const result = await runLighthouse(fullUrl, name as LighthouseCategory, { keepRaw: Boolean(opts.keepRaw) });
        spinner.succeed(`${categoryDescription}: ${result.score}/100`);

        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify(result, null, 2) + '\n');
          process.exit(result.score >= threshold ? 0 : 1);
        }

        // Pretty render — 0..100 score, then top issues
        console.log('');
        const scoreColor = result.score >= 90 ? chalk.green : result.score >= 50 ? chalk.yellow : chalk.red;
        console.log(`  ${scoreColor.bold(`${result.score}/100`)}  ${chalk.dim(`(threshold: ${threshold})`)}`);
        console.log(chalk.dim(`  ${fullUrl}`));
        console.log('');
        const failing = result.issues.filter((i) => i.severity !== 'pass');
        if (failing.length === 0) {
          console.log(chalk.green('  ✓ no issues — every audit passed'));
          console.log('');
        } else {
          console.log(chalk.bold(`  ${failing.length} issue${failing.length === 1 ? '' : 's'}:`));
          for (const issue of failing.slice(0, 10)) {
            const sev = issue.severity === 'serious' ? chalk.red('●') : issue.severity === 'moderate' ? chalk.yellow('●') : chalk.dim('●');
            console.log(`    ${sev} ${chalk.bold(issue.title)} ${chalk.dim(`(${issue.rule})`)}`);
          }
          if (failing.length > 10) console.log(chalk.dim(`    … and ${failing.length - 10} more (use --json for full list)`));
          console.log('');
        }
        process.exit(result.score >= threshold ? 0 : 1);
      } catch (err) {
        spinner.fail(chalk.red(`Audit failed: ${(err as Error).message}`));
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2) + '\n');
        }
        process.exit(1);
      }
    });
}

makeQualityAudit('a11y',   'Accessibility audit');
makeQualityAudit('perf',   'Performance audit');
makeQualityAudit('mobile', 'Mobile performance audit');

// =====================================================================
// `solid audit log` — Phase 2.5 of agent-attraction.
// Hits /api/v1/agent/audit which returns paginated, cursor-based,
// machine-readable AuditLog rows (default JSON output for AI agents).
// =====================================================================
auditCommand
  .command('log')
  .description('Machine-readable audit log (paginated, cursor-based)')
  .option('--since <iso>', 'Only entries on/after this ISO 8601 timestamp')
  .option('--until <iso>', 'Only entries on/before this ISO 8601 timestamp')
  .option('--resource <type>', 'Filter by resource_type (e.g. contact)')
  .option('--action <name>', 'Filter by action (e.g. contact.create)')
  .option('--limit <n>', 'Page size (1..500)', '100')
  .option('--cursor <id>', 'Cursor-after-id from a previous page')
  .option('--format <fmt>', 'Output format: json|jsonl|table', 'json')
  .action(async (options) => {
    const spinner = (options.format === 'json' || options.format === 'jsonl')
      ? null : ora('Fetching audit log...').start();
    try {
      const params: Record<string, any> = {};
      if (options.since) params.since = options.since;
      if (options.until) params.until = options.until;
      if (options.resource) params.resource_type = options.resource;
      if (options.action) params.action = options.action;
      params.limit = parseInt(options.limit, 10);
      if (options.cursor) params.cursor_after_id = parseInt(options.cursor, 10);

      const { apiClient } = await import('../lib/api-client');
      const res = await apiClient.get('/api/v1/agent/audit', { params });
      spinner?.stop();
      const data: any = res.data;

      if (options.format === 'jsonl') {
        for (const row of (data.rows || [])) console.log(JSON.stringify(row));
        if (data.next_cursor != null) {
          console.error(chalk.dim(`-- next page: --cursor ${data.next_cursor}`));
        }
        return;
      }
      if (options.format === 'table') {
        console.log(chalk.cyan(`AuditLog (${data.count} rows)`));
        (data.rows || []).forEach((r: any) => {
          console.log(`${chalk.gray(r.created_at)} ${(r.action || '').padEnd(20)} ${r.resource_type ?? '-'}/${r.resource_id ?? '-'}`);
        });
        if (data.next_cursor != null) {
          console.log(chalk.dim(`-- next page: --cursor ${data.next_cursor}`));
        }
        return;
      }
      // default: full JSON envelope (cursor + filters + rows)
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      spinner?.stop();
      const { handleApiError } = await import('../lib/api-client');
      handleApiError(e);
    }
  });

import { appendExamples as __ae_audit } from '../lib/command-kit';
__ae_audit(auditCommand, [
  { cmd: 'solid audit log --since 2026-05-15T00:00:00Z',
                                               why: 'Machine-readable audit trail for agents' },
  { cmd: 'solid audit log --format jsonl --action contact.create',
                                               why: 'Stream contact.create events as JSONL' },
  { cmd: 'solid audit export --since 30d',     why: 'Dump activity log (who changed what)' },
  { cmd: 'solid audit compliance-report',      why: 'Auditor-ready PDF' },
  { cmd: 'solid audit gdpr-export <email>',    why: 'GDPR subject access request' },
  { cmd: 'solid audit gdpr-delete <email> -y', why: 'GDPR right-to-be-forgotten (prompts without -y)' },
  { cmd: 'solid audit gdpr-consent-set <id>',  why: 'Record marketing consent' },
  { cmd: 'solid audit a11y home --json',       why: 'A.5 — accessibility score for a page' },
  { cmd: 'solid audit perf home --threshold 90', why: 'A.5 — performance score; exit 1 if <90' },
  { cmd: 'solid audit mobile home',            why: 'A.5 — mobile performance audit' },
]);
