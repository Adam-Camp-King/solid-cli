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
  // ⛔ `list` GOES THROUGH VERBS. It used to read /api/v1/surveys directly, so it
  // showed a different set than `solid forms status` (no lifecycle, native only,
  // and blind to lead forms). Two commands in one CLI disagreeing about what
  // forms exist is worse than either being wrong. One seam, one answer.
  const listCmd = formsCommand.command('list').alias('ls')
    .description('Every form, with its lifecycle — across every connected provider');
  listCmd.option('--provider <name>', 'Only this provider');
  listCmd.option('--json', 'Output as JSON');
  listCmd.action(async (opts: { provider?: string; json?: boolean }) => {
    requireAuth();
    const s2 = ora('Loading forms...').start();
    try {
      const providers = opts.provider
        ? [opts.provider]
        : (((await callVerb('form.sources')).connected ?? []) as Array<Record<string, unknown>>)
            .map((c) => String(c.provider));
      const rows: Array<Record<string, unknown>> = [];
      for (const provider of providers.length ? providers : ['native']) {
        try {
          const out = await callVerb('form.list', { provider });
          for (const f of (out.forms ?? []) as Array<Record<string, unknown>>) {
            rows.push({ ...f, provider });
          }
        } catch { /* one provider down must not blank the list */ }
      }
      if (isJsonOutput(opts)) { s2.stop(); console.log(JSON.stringify({ forms: rows }, null, 2)); return; }
      s2.stop();
      if (!rows.length) {
        console.log(chalk.dim('  No forms yet.'));
        console.log(chalk.dim('  Build one:  solid forms build --intent intake --save'));
        return;
      }
      for (const f of rows) {
        const state = lifecycleOf(f);
        const answered = Number(f.response_count ?? 0);
        console.log(
          `  ${chalk.bold(String(f.external_id).padEnd(5))} ${lifecycleTag(state).padEnd(16)} ` +
          `${String(f.title ?? '').slice(0, 34).padEnd(34)} ` +
          `${chalk.dim(`${answered} answered`)} ${chalk.dim(String(f.provider))}`,
        );
      }
    } catch (e) { fail(s2, 'Failed to load forms', e); }
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
  .description('ADA reviews the questions — suggestions only, nothing changes')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const sp = ora('Looking it over...').start();
    try {
      const out = await callVerb('survey.optimize', { survey_id: Number(id) });
      if (isJsonOutput(opts)) { sp.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      sp.stop();
      const analysis = (out.analysis ?? {}) as Record<string, unknown>;
      const suggestions = (analysis.suggested_improvements ?? []) as Array<Record<string, unknown>>;
      if (!suggestions.length) { console.log(chalk.dim('  Nothing to change — it reads well.')); return; }
      console.log(chalk.dim('  Suggestions only — nothing changes until you change it.'));
      for (const sg of suggestions) {
        console.log(`  ${chalk.yellow('*')} ${sg.issue}`);
        if (sg.fix) console.log(`      ${chalk.dim('fix:')} ${sg.fix}`);
        if (sg.impact) console.log(`      ${chalk.dim('why:')} ${sg.impact}`);
      }
    } catch (e) { fail(sp, 'Failed to look it over', e); }
  });

formsCommand
  .command('analyze <id>')
  .description('What the answers add up to')
  .option('--json', 'Output as JSON')
  .action(async (id) => {
    requireAuth();
    const sp = ora('Analyzing...').start();
    try {
      const out = await callVerb('survey.analyze', { survey_id: Number(id) });
      sp.stop();
      console.log(JSON.stringify(out, null, 2));
    } catch (e) { fail(sp, 'Failed to analyze', e); }
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
  .description('Paste-ready embed for a live form — iframe, link, or button')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--as <kind>', 'iframe | link | button', 'iframe')
  .action(async (id, opts) => {
    requireAuth();
    // ⛔ THE DOOR, NOT THE LEGACY LINK. This read /api/v1/surveys/<id>/embed —
    // the pre-lifecycle system's public URL — so after the standing door shipped
    // (2026-08-20) `solid forms embed` was handing out the OLD address while
    // `solid forms link` handed out the new one. Two commands, two answers, one
    // of them wrong.
    const sp = ora('Building the embed...').start();
    let out: Record<string, unknown>;
    try {
      out = await callVerb('form.describe', { form_id: String(id), provider: opts.provider });
    } catch (e) { fail(sp, 'Failed to build the embed', e); return; }

    const url = out.public_url ?? out.public_path;
    if (!url) {
      sp.fail(chalk.yellow(`No public address — this form is ${String(out.lifecycle ?? 'not live')}.`));
      console.error(chalk.dim('  Only a live form can be embedded. Publish it first:'));
      console.error(chalk.dim(`    solid forms publish ${id}`));
      process.exitCode = 1;
      return;
    }
    sp.stop();
    const title = String(out.title ?? 'Form');
    const kind = String(opts.as).toLowerCase();
    if (kind === 'link') {
      console.log(`<a href="${url}">${title}</a>`);
    } else if (kind === 'button') {
      console.log(
        `<a href="${url}" style="display:inline-block;padding:12px 20px;border-radius:8px;` +
        `background:#0f5346;color:#fff;text-decoration:none;font-weight:600">${title}</a>`,
      );
    } else {
      console.log(
        `<!-- ${title} — answers land in your CRM -->\n` +
        `<iframe src="${url}" title="${title}" width="100%" height="640" ` +
        `style="border:0;border-radius:12px" loading="lazy"></iframe>`,
      );
    }
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


// ── moments: WHEN a form goes out ──────────────────────────────────────────
//
// The dashboard's most-prompted next step after publishing, and it had no CLI
// surface at all — so an AI could publish a form and then nothing could ever
// send it.
const momentsCmd = formsCommand.command('moments')
  .description('When a form goes out — the tenant\'s moments');

momentsCmd
  .command('list', { isDefault: true })
  .description('Every moment, and which form (if any) it sends')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const sp = ora('Loading moments...').start();
    try {
      const out = await callVerb('form.triggers');
      if (isJsonOutput(opts)) { sp.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      sp.stop();
      const rows = (out.triggers ?? []) as Array<Record<string, unknown>>;
      if (!rows.length) { console.log(chalk.dim('  No moments available.')); return; }
      for (const t of rows) {
        const on = t.configured ? chalk.green('on ') : chalk.dim('off');
        const what = t.configured && t.form_id
          ? `sends form ${t.form_id} ${t.stage === 'before' ? 'beforehand' : 'afterwards'}`
          : chalk.dim('nothing set');
        console.log(`  ${on}  ${String(t.event).padEnd(24)} ${what}`);
      }
      console.log(chalk.dim('\n  Wire one:  solid forms moments set <event> --form <id>'));
    } catch (e) { fail(sp, 'Failed to load moments', e); }
  });

momentsCmd
  .command('set <event>')
  .description('Send a form at this moment')
  .requiredOption('--form <id>', 'The form to send')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--stage <when>', 'before | after')
  .action(async (event, opts) => {
    requireAuth();
    const sp = ora(`Wiring ${event}...`).start();
    try {
      const out = await callVerbConfirmed('form.configure_trigger', {
        event, form_id: String(opts.form), provider: opts.provider,
        enabled: true, ...(opts.stage ? { stage: opts.stage } : {}),
      });
      if (out.status === 'invalid' || out.status === 'error') {
        sp.fail(chalk.red(String(out.summary ?? 'Could not wire it')));
        process.exitCode = 1;
        return;
      }
      sp.succeed(chalk.green(`${event} now sends form ${opts.form}`));
    } catch (e) { fail(sp, 'Failed to wire the moment', e); }
  });

momentsCmd
  .command('off <event>')
  .description('Stop sending anything at this moment')
  .action(async (event) => {
    requireAuth();
    const sp = ora(`Switching ${event} off...`).start();
    try {
      const out = await callVerbConfirmed('form.configure_trigger', { event, enabled: false });
      if (out.status === 'invalid' || out.status === 'error') {
        sp.fail(chalk.red(String(out.summary ?? 'Could not switch it off')));
        process.exitCode = 1;
        return;
      }
      sp.succeed(chalk.green(`${event} sends nothing now`));
    } catch (e) { fail(sp, 'Failed to switch it off', e); }
  });

// ── reviews: where a happy customer is sent ────────────────────────────────
const reviewsCmd = formsCommand.command('reviews')
  .description('Where happy customers are asked to leave a review');

reviewsCmd
  .command('list', { isDefault: true })
  .description('The review destinations this tenant has set')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const sp = ora('Loading destinations...').start();
    try {
      const out = await callVerb('review.destinations');
      if (isJsonOutput(opts)) { sp.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      sp.stop();
      const rows = (out.destinations ?? []) as Array<Record<string, unknown>>;
      if (!rows.length) {
        console.log(chalk.dim('  No review destinations yet.'));
        console.log(chalk.dim('  Set one:  solid forms reviews set google <url>'));
        return;
      }
      for (const d of rows) console.log(`  ${String(d.platform).padEnd(12)} ${d.url}`);
    } catch (e) { fail(sp, 'Failed to load destinations', e); }
  });

reviewsCmd
  .command('set <platform> <url>')
  .description('Point future review requests at this link')
  .action(async (platform, url) => {
    requireAuth();
    const sp = ora('Saving...').start();
    try {
      const out = await callVerbConfirmed('review.set_destination', { platform, url });
      if (out.status === 'invalid' || out.status === 'error') {
        sp.fail(chalk.red(String(out.summary ?? 'Could not save it')));
        process.exitCode = 1;
        return;
      }
      sp.succeed(chalk.green(`${platform} review link saved`));
    } catch (e) { fail(sp, 'Failed to save', e); }
  });

// ── build: a starter playbook, in THIS tenant's words ──────────────────────
formsCommand
  .command('build')
  .description("Draft a form for this business — in its own industry's words")
  .option('--intent <kind>', 'intake | feedback | lead_qualify | onboarding', 'intake')
  .option('--save', 'Save it as a draft (nothing is saved without this)')
  .option('--title <text>', 'Title to save it under')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const sp = ora('Drafting...').start();
    try {
      // ⛔ kb_sub_code IS NOT PASSED. The verb resolves THIS tenant's industry
      // from their own company row; sending one from the CLI would be guessing
      // at someone's business. See mcp/tools/form_session_verbs._tenant_kb_sub_code.
      const draft = await callVerb('playbook.suggest', { intent: opts.intent });
      if (draft.status === 'invalid' || draft.status === 'error') {
        sp.fail(chalk.red(String(draft.summary ?? 'Could not draft it')));
        process.exitCode = 1;
        return;
      }
      if (isJsonOutput(opts) && !opts.save) { sp.stop(); console.log(JSON.stringify(draft, null, 2)); return; }
      sp.stop();
      const preview = (draft.preview ?? draft.steps ?? []) as Array<Record<string, unknown>>;
      console.log(`  ${chalk.bold(String(draft.title ?? opts.intent))}  ${chalk.dim(`(${preview.length} steps)`)}`);
      preview.forEach((st, i) => {
        console.log(`    ${String(i + 1).padStart(2, '0')}  ${chalk.dim(String(st.kind ?? 'question').padEnd(8))} ${st.prompt ?? ''}`);
      });
      if (!opts.save) {
        console.log(chalk.dim('\n  Nothing saved. Add --save to keep it as a draft.'));
        return;
      }
      const sp2 = ora('Saving as a draft...').start();
      const saved = await callVerbConfirmed('playbook.save', {
        title: opts.title ?? String(draft.title ?? `${opts.intent} form`),
        steps: draft.steps ?? [],
        ...(draft.outcomes ? { outcomes: draft.outcomes } : {}),
      });
      if (saved.status === 'invalid' || saved.status === 'error') {
        sp2.fail(chalk.red(String(saved.summary ?? 'Could not save it')));
        process.exitCode = 1;
        return;
      }
      sp2.succeed(chalk.green(`Saved as a draft (${saved.playbook_id ?? saved.form_id ?? '?'})`));
      console.log(chalk.dim(`  Publish when it's ready:  solid forms publish ${saved.playbook_id ?? saved.form_id ?? '<id>'}`));
    } catch (e) { fail(sp, 'Failed to build', e); }
  });

// ── walk: answer a form from the terminal, exactly as an agent does ─────────
//
// The CLI equivalent of the Live Form bench: next_question → capture → submit,
// the same three verbs a voice agent uses mid-call. Scriptable on purpose, so
// an AI can drive it non-interactively.
formsCommand
  .command('walk <id>')
  .description('Answer a form the way an agent does — next question, capture, submit')
  .option('--provider <name>', 'Form provider', 'native')
  .option('--session <ref>', 'Continue an existing session')
  .option('--question <id>', 'The question being answered (with --answer)')
  .option('--answer <value>', 'Record an answer, then show what is next')
  .option('--submit', 'Finish and persist the response')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const base = { form_id: String(id), provider: opts.provider };
    const sp = ora('Working...').start();
    try {
      if (opts.submit) {
        const out = await callVerbConfirmed('form.submit', {
          ...base, ...(opts.session ? { session_ref: opts.session } : {}),
        });
        sp.stop();
        if (out.status === 'invalid') {
          console.error(chalk.yellow(String(out.summary)));
          process.exitCode = 1;
          return;
        }
        if (isJsonOutput(opts)) { console.log(JSON.stringify(out, null, 2)); return; }
        console.log(chalk.green(`  Submitted — response ${out.response_id ?? ''}`));
        if (out.contact_id) {
          console.log(`  ${chalk.dim('landed on contact')} ${out.contact_id}` +
            (out.contact_created ? chalk.dim(' (new lead)') : ''));
        }
        return;
      }

      let session = opts.session as string | undefined;
      if (opts.answer !== undefined) {
        if (!opts.question) {
          sp.fail(chalk.red('--answer needs --question <id>'));
          process.exitCode = 1;
          return;
        }
        const cap = await callVerbConfirmed('form.capture', {
          ...base, question_id: String(opts.question), value: opts.answer,
          channel: 'cli', ...(session ? { session_ref: session } : {}),
        });
        session = String(cap.session_ref ?? session ?? '');
      }

      const next = await callVerb('form.next_question', {
        ...base, ...(session ? { session_ref: session } : {}),
      });
      sp.stop();
      if (isJsonOutput(opts)) { console.log(JSON.stringify({ ...next, session_ref: session }, null, 2)); return; }
      if (session) console.log(`  ${chalk.dim('session')} ${session}`);
      if (next.complete) {
        console.log(chalk.green('  Every question answered.'));
        console.log(chalk.dim(`  Finish it:  solid forms walk ${id} --session ${session ?? ''} --submit`));
        return;
      }
      const q = (next.next_question ?? {}) as Record<string, unknown>;
      console.log(`  ${chalk.bold(String(q.prompt ?? ''))}`);
      console.log(`  ${chalk.dim(`${q.kind}${q.required ? ', required' : ''}`)}`);
      if (Array.isArray(q.choices) && q.choices.length) {
        console.log(`  ${chalk.dim('choices:')} ${(q.choices as string[]).join(' / ')}`);
      }
      console.log(chalk.dim(
        `\n  Answer it:  solid forms walk ${id} --question ${q.id}` +
        ` --answer "..."${session ? ` --session ${session}` : ''}`));
    } catch (e) { fail(sp, 'Failed', e); }
  });

// ── vocabulary: the nouns this tenant's customers actually use ──────────────
formsCommand
  .command('vocabulary')
  .alias('words')
  .description("This business's own words — what its customers are called, and its appointments")
  .option('--lang <code>', 'Language', 'en')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const sp = ora('Loading...').start();
    try {
      // kb_sub_code omitted deliberately — the verb resolves this tenant's own.
      const out = await callVerb('playbook.vocabulary', { lang: opts.lang });
      if (isJsonOutput(opts)) { sp.stop(); console.log(JSON.stringify(out, null, 2)); return; }
      sp.stop();
      const terms = (out.terms ?? {}) as Record<string, string>;
      console.log(`  ${chalk.dim('industry code')} ${out.kb_sub_code ?? chalk.dim('none set')}`);
      for (const [k, v] of Object.entries(terms)) {
        console.log(`  ${chalk.dim(k.padEnd(16))} ${v}`);
      }
    } catch (e) { fail(sp, 'Failed to load the vocabulary', e); }
  });

import { appendExamples as __appendExamplesForms } from '../lib/command-kit';
__appendExamplesForms(formsCommand, [
  { cmd: 'solid forms list', why: 'Every form with its lifecycle, across every provider' },
  { cmd: 'solid forms build --intent intake --save', why: "A starter in this industry's own words" },
  { cmd: 'solid forms publish <id>', why: 'A draft starts taking answers' },
  { cmd: 'solid forms link <id>', why: "The form's shareable URL, bare on stdout" },
  { cmd: 'solid forms moments set appointment_booked --form <id>', why: 'Make something actually send it' },
  { cmd: 'solid forms walk <id>', why: 'Answer it the way an agent does, from the terminal' },
  { cmd: 'solid forms responses <id>', why: 'What people actually answered' },
]);
