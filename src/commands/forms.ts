/**
 * Forms / surveys commands.
 * Wraps controllers/surveys.py.
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
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const formsCommand = new Command('forms')
  .alias('surveys')
  .description('Forms & surveys — CRUD, AI generate, export CSV/Excel/PDF');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = formsCommand.command('list').alias('ls').description('List forms/surveys');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading forms...',
      errorText: 'Failed to load forms',
      fetch: async (offset, limit) =>
        (await apiClient.get('/api/v1/surveys', { params: { limit, offset } })).data,
      extract: (page) => {
        if (Array.isArray(page)) return page as Array<Record<string, unknown>>;
        const d = page as Record<string, unknown>;
        return ((d.surveys || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No forms yet.')); return; }
        for (const f of items) {
          console.log(`  ${chalk.bold(String(f.id))}  ${f.title || f.name}  ${chalk.dim(String(f.created_at || '').split('T')[0])}`);
        }
      },
    });
  });
}

formsCommand
  .command('get <id>')
  .description('Get a form/survey')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora(`Loading ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Form ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('create')
  .description('Create a form (JSON file or basic title)')
  .option('--file <path>', 'JSON file with form definition')
  .option('--title <title>', 'Simple title-only form')
  .action(async (opts) => {
    requireAuth();
    const body = opts.file
      ? JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'))
      : opts.title ? { title: opts.title } : null;
    if (!body) { console.error(chalk.red('Provide --file or --title')); process.exit(1); }
    const s = ora('Creating form...').start();
    try {
      const res = await apiClient.post('/api/v1/surveys/create', body);
      s.succeed(chalk.green(`Form created: ${(res.data as Record<string, any>).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('update <id>')
  .description('Update a form')
  .requiredOption('--file <path>', 'JSON file with update')
  .action(async (id, opts) => {
    requireAuth();
    const body = JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'));
    const s = ora('Updating...').start();
    try {
      await apiClient.put(`/api/v1/surveys/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('delete <id>')
  .description('Delete a form (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete form ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Deleting...', stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/surveys/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('generate <prompt>')
  .description('Generate a form from an AI prompt')
  .action(async (prompt) => {
    requireAuth();
    const s = ora('Generating form...').start();
    try {
      const res = await apiClient.post('/api/v1/surveys/generate', { prompt });
      s.succeed(chalk.green(`Form generated: ${(res.data as Record<string, any>).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('optimize <id>')
  .description('AI-optimize an existing form (shorter, better copy)')
  .action(async (id) => {
    requireAuth();
    const s = ora('Optimizing...').start();
    try {
      await apiClient.post(`/api/v1/surveys/${id}/optimize`);
      s.succeed(chalk.green('Optimized'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('analyze <id>')
  .description('AI analyze submissions for insights')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Analyzing...').start();
    try {
      const res = await apiClient.post(`/api/v1/surveys/${id}/analyze`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Analysis'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('followup <id>')
  .description('Generate AI follow-up messages for responses')
  .action(async (id) => {
    requireAuth();
    const s = ora('Generating follow-ups...').start();
    try {
      const res = await apiClient.post(`/api/v1/surveys/${id}/followup`);
      s.succeed(chalk.green('Follow-ups generated'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('embed <id>')
  .description('Get embed code / public link for a form')
  .action(async (id) => {
    requireAuth();
    const s = ora('Loading embed...').start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}/embed`);
      s.succeed(chalk.green('Embed'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('export <id>')
  .description('Export submissions (csv, excel, pdf)')
  .option('-f, --format <fmt>', 'csv | excel | pdf', 'csv')
  .option('-o, --output <path>', 'Write to file (default: stdout)')
  .action(async (id, opts) => {
    requireAuth();
    const fmt = String(opts.format).toLowerCase();
    if (!['csv', 'excel', 'pdf'].includes(fmt)) {
      console.error(chalk.red('--format must be csv, excel, or pdf'));
      process.exit(1);
    }
    const s = ora(`Exporting ${fmt}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}/export/${fmt}`);
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (opts.output) {
        (await import('fs')).writeFileSync(opts.output, body);
        s.succeed(chalk.green(`Saved to ${opts.output}`));
      } else {
        s.stop();
        process.stdout.write(body);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });


// ── the verb seam ──────────────────────────────────────────────────────────
//
// ⛔ EVERYTHING BELOW CALLS VERBS, NOT REST. The commands above this line wrap
// /api/v1/surveys — the authoring endpoints that predate the forms platform —
// and they are why `solid forms` knew nothing about the lifecycle, the
// respondent-facing reads, or a form's public address. New work goes through
// the verb layer so the CLI, the dashboard, MCP and an agent on a live call
// all get the same validation, consent and tenant scoping.
//
// ⛔ NEVER SEND company_id. The backend binds the tenant from the authenticated
// principal; a CLI that could pass one is a CLI that could pass someone else's.
async function callVerb(name: string, payload: Record<string, unknown> = {}) {
  // ⛔ ONLY THE VERB IS HYPHENATED, NEVER THE NAMESPACE. The backend routes
  // `<ns>/<verb-with-hyphens>` (controllers/agent_verb_index.py::_verb_http_endpoint),
  // and plenty of namespaces carry underscores — call_flow, comms_workflow,
  // agent_config. Hyphenating the whole name would 404 every one of them.
  const [ns, ...rest] = name.split('.');
  const verb = rest.join('.').replace(/_/g, '-');
  const endpoint = verb ? `/api/v1/agent/${ns}/${verb}` : `/api/v1/agent/${ns}`;
  const res = await apiClient.post(endpoint, payload);
  const body = res.data as Record<string, unknown>;
  // The envelope is {ok, result} on some surfaces and the bare result on others.
  return (body && typeof body === 'object' && 'result' in body ? body.result : body) as Record<string, unknown>;
}

/** A write verb. Consent travels as `confirm: true` — the backend refuses without it. */
async function callVerbConfirmed(name: string, payload: Record<string, unknown> = {}) {
  return callVerb(name, { ...payload, confirm: true });
}

function lifecycleOf(f: Record<string, unknown>): string {
  if ((f.status ?? 'published') === 'draft') return 'draft';
  return f.is_active === false ? 'paused' : 'live';
}

function lifecycleTag(state: string): string {
  return state === 'live' ? chalk.green('live')
    : state === 'draft' ? chalk.yellow('draft')
    : chalk.dim('paused');
}

formsCommand
  .command('describe <id>')
  .description('The questions as a respondent meets them, plus lifecycle + public link')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora(`Reading ${id}...`).start();
    try {
      const out = await callVerb('form.describe', { form_id: String(id), provider: opts.provider });
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      s.stop();
      const questions = (out.questions ?? []) as Array<Record<string, unknown>>;
      console.log(`  ${chalk.bold(String(out.title ?? id))}  ${lifecycleTag(String(out.lifecycle ?? ''))}`);
      if (out.public_url) console.log(`  ${chalk.dim('public link')}  ${chalk.cyan(String(out.public_url))}`);
      else if (out.public_path) console.log(`  ${chalk.dim('public path')}  ${String(out.public_path)}`);
      console.log(`  ${chalk.dim(`${questions.length} question${questions.length === 1 ? '' : 's'}`)}`);
      questions.forEach((q, i) => {
        const req = q.required ? chalk.dim(' (required)') : '';
        console.log(`    ${String(i + 1).padStart(2, '0')}  ${chalk.dim(String(q.kind).padEnd(8))} ${q.prompt}${req}`);
      });
    } catch (e) { fail(s, 'Failed to read the form', e); }
  });

formsCommand
  .command('publish <id>')
  .description('Publish a draft — it starts taking answers')
  .action(async (id) => {
    requireAuth();
    const s = ora(`Publishing ${id}...`).start();
    try {
      const out = await callVerbConfirmed('survey.publish', { survey_id: Number(id) });
      if (out.status === 'error' || out.status === 'not_found') {
        s.fail(chalk.red(String(out.summary ?? 'Could not publish')));
        process.exit(1);
      }
      s.succeed(chalk.green('Published — live and taking answers'));
      try {
        const d = await callVerb('form.describe', { form_id: String(id), provider: 'native' });
        if (d.public_url) console.log(`  ${chalk.dim('public link')}  ${chalk.cyan(String(d.public_url))}`);
      } catch { /* the publish still succeeded */ }
    } catch (e) { fail(s, 'Failed to publish', e); }
  });

formsCommand
  .command('pause <id>')
  .description('Stop taking new answers. Every answer already given is kept')
  .action(async (id) => {
    requireAuth();
    const s = ora(`Pausing ${id}...`).start();
    try {
      const out = await callVerbConfirmed('survey.set_live', { survey_id: Number(id), live: false });
      if (out.status === 'invalid' || out.status === 'error') {
        s.fail(chalk.red(String(out.summary ?? 'Could not pause it')));
        process.exit(1);
      }
      s.succeed(chalk.green('Paused — every answer kept, no new ones'));
    } catch (e) { fail(s, 'Failed to pause', e); }
  });

formsCommand
  .command('resume <id>')
  .description('Take answers again on a paused form')
  .action(async (id) => {
    requireAuth();
    const s = ora(`Resuming ${id}...`).start();
    try {
      const out = await callVerbConfirmed('survey.set_live', { survey_id: Number(id), live: true });
      if (out.status === 'invalid' || out.status === 'error') {
        s.fail(chalk.red(String(out.summary ?? 'Could not resume it')));
        process.exit(1);
      }
      s.succeed(chalk.green('Live — taking answers again'));
    } catch (e) { fail(s, 'Failed to resume', e); }
  });

formsCommand
  .command('link <id>')
  .description("The form's standing public URL — the one address you can share anywhere")
  .option('--provider <name>', 'Form provider', 'native')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Resolving...').start();
    // ⛔ THE EXIT LIVES OUTSIDE THE try. An intentional process.exit inside it
    // is caught by the error handler below and reported as "Failed to resolve
    // the link" — the command would then exit 0 with a misleading message.
    let out: Record<string, unknown>;
    try {
      out = await callVerb('form.describe', { form_id: String(id), provider: opts.provider });
    } catch (e) { fail(s, 'Failed to resolve the link', e); return; }

    if (out.public_url || out.public_path) {
      s.stop();
      // Bare URL on stdout so it pipes into pbcopy, a QR generator, anything.
      console.log(String(out.public_url ?? out.public_path));
      return;
    }
    s.fail(chalk.yellow(`No public link — this form is ${String(out.lifecycle ?? 'not live')}.`));
    console.error(chalk.dim('  Only a live form has a public address. Publish it first:'));
    console.error(chalk.dim(`    solid forms publish ${id}`));
    process.exit(1);
  });

formsCommand
  .command('responses <id>')
  .description('What people actually answered')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--limit <n>', 'How many to show', '25')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading responses...').start();
    try {
      const out = await callVerb('form.responses', {
        form_id: String(id), provider: opts.provider, per_page: Number(opts.limit),
      });
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      s.stop();
      const rows = (out.responses ?? []) as Array<Record<string, unknown>>;
      if (!rows.length) { console.log(chalk.dim('  Nothing answered yet.')); return; }
      for (const r of rows) {
        const when = String(r.completed_at ?? r.created_at ?? '').split('T')[0];
        const channels = Array.isArray(r.channels) ? (r.channels as string[]).join('+') : '';
        console.log(`  ${chalk.bold(String(r.external_id ?? r.id ?? ''))}  ${chalk.dim(when)}  ${chalk.dim(channels)}`);
        for (const [k, v] of Object.entries((r.answers ?? {}) as Record<string, unknown>)) {
          console.log(`      ${chalk.dim(k)}: ${String(v)}`);
        }
      }
    } catch (e) { fail(s, 'Failed to load responses', e); }
  });

formsCommand
  .command('status')
  .description('Every form with its lifecycle — the CLI view of the library')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const out = await callVerb('form.list', { provider: opts.provider });
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      s.stop();
      const rows = (out.forms ?? []) as Array<Record<string, unknown>>;
      if (!rows.length) { console.log(chalk.dim('  No forms yet.')); return; }
      for (const f of rows) {
        const state = lifecycleOf(f);
        const answered = Number(f.response_count ?? 0);
        console.log(
          `  ${chalk.bold(String(f.external_id).padEnd(5))} ${lifecycleTag(state).padEnd(16)} ` +
          `${String(f.title ?? '').padEnd(34)} ${chalk.dim(`${answered} answered`)}`,
        );
      }
    } catch (e) { fail(s, 'Failed to load forms', e); }
  });

import { appendExamples as __appendExamplesForms } from '../lib/command-kit';
__appendExamplesForms(formsCommand, [
  { cmd: 'solid forms status', why: 'Every form with its lifecycle (live / draft / paused)' },
  { cmd: 'solid forms describe <id>', why: 'The questions a respondent meets, + the public link' },
  { cmd: 'solid forms publish <id>', why: 'A draft starts taking answers' },
  { cmd: 'solid forms link <id>', why: "The form's shareable URL, bare on stdout" },
  { cmd: 'solid forms responses <id>', why: 'What people actually answered' },
  { cmd: 'solid forms pause <id>', why: 'Stop new answers, keep every existing one' },
]);
