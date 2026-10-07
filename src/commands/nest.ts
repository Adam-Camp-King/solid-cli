/**
 * solid nest — Nest as a first-class CLI verb.
 *
 * Conversational intake from the terminal. `solid nest <something>` auto-detects
 * URL / file path / clipboard / raw code, then threads destination intent
 * (page_type, site, subdomain, custom_domain, campaign, goal) into the same
 * AntService.execute pipeline the dashboard UI uses.
 *
 * Why this exists: designers want `solid nest anglebuild.com --type landing`
 * from muscle memory. Vertically-trained agents (a dentistry-vertical agent,
 * a contractor agent) want `solid nest <screenshot>` as a programmatic surface
 * to ship customer landing pages. Same service layer, three doors.
 *
 * See Owners-Manual/99-Active-Sprints/SPRINT-NEST-DESTINATION-WIRING.md
 */

import * as fs from 'fs';
import * as path from 'path';

import { Command } from 'commander';
import chalk from 'chalk';
import ora from '../lib/spinner';

import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

import {
  detectSource,
  normalizeUrl,
  flagsToDestination,
  flagsAsArgv,
  guessPageType,
  readFolder,
  nestOutcome,
  nestOutcomeLines,
  type NestFlags,
} from './nest-helpers';

/**
 * The build step. ⛔ `/api/v1/agent/nest/execute`, not `/api/v1/cli/ant/execute`:
 * both run the same build, but only this one answers with the fidelity score, the
 * one-line summary and the next step. The CLI called the bare route and so had
 * nothing to show for "was my design kept?" beyond a status.
 */
const NEST_EXECUTE = '/api/v1/agent/nest/execute';

// Re-export helpers so existing imports from this module keep working.
export {
  detectSource,
  normalizeUrl,
  flagsToDestination,
  flagsAsArgv,
  guessPageType,
} from './nest-helpers';
export type {
  NestPageType,
  NestMode,
  NestConversionGoal,
  NestDestination,
  NestFlags,
  SourceKind,
} from './nest-helpers';

/**
 * Read clipboard or stdin into a string. Separated so tests can stub it.
 * Currently stdin-only (no native clipboard dep); clipboard support is
 * a follow-up when we add clipboardy.
 */
async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    throw new Error(
      'No input piped. Use `cat file.html | solid nest -` or `solid nest <file>` or `solid nest <url>`.',
    );
  }
  return new Promise((resolve, reject) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => (data += chunk));
    process.stdin.on('end', () => resolve(data));
    process.stdin.on('error', reject);
  });
}

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

// ---------------------------------------------------------------------------
// Main: `solid nest <source>`
// ---------------------------------------------------------------------------

export const nestCommand = new Command('nest')
  .description('Bring a page in — a URL, a file or a whole folder → your private Sandbox (add --live to place it on a site as a draft). Says whether your design was kept or converted, and how close it is.')
  .argument('[source]', 'URL, file path, folder, "-" for stdin, or raw code')
  .option('--type <type>', 'home | website | landing | email_landing | blog | product | booking | component')
  .option('--site <id>', 'destination Site id (numeric)')
  .option('--subdomain <sub>', 'hint for promote (e.g. "promo" → promo.solidnumber.com)')
  .option('--custom-domain <domain>', 'custom domain (e.g. anglebuild.com)')
  .option('--sandbox', 'save privately to the sandbox shelf (default)')
  .option('--live', 'skip sandbox — place immediately on a site as a draft')
  .option('--campaign <id>', 'campaign_id for outcome tracking')
  .option('--goal <goal>', 'form_submit | checkout | booking | chat_start | click')
  .option('--entry <file>', 'folder: which HTML file is the home page (asked for when unclear)')
  .option('--single', 'folder: import only the entry page, not the whole site')
  .option('--json', 'machine-readable output')
  .action(async (source: string | undefined, flags: NestFlags) => {
    requireAuth();
    const json = isJsonOutput(flags);
    const sourceKind = detectSource(source);

    if (sourceKind === 'folder') {
      await nestFolder(source!, flags, json);
      return;
    }

    // Build destination payload
    const destination = flagsToDestination(flags);
    if (!destination.page_type) {
      const guessed = guessPageType(sourceKind, source);
      if (guessed) destination.page_type = guessed;
    }

    // Load source bytes
    let importResponse: { data: Record<string, unknown> };
    const spinner = json ? null : ora('Nesting…').start();

    try {
      if (sourceKind === 'url') {
        const url = normalizeUrl(source!);
        if (spinner) spinner.text = `Fetching ${url}…`;
        importResponse = await apiClient.post('/api/v1/cli/ant/import-url', { url });
      } else {
        let code: string;
        let formatHint: string | undefined;
        let sourceHint: string | undefined;

        if (sourceKind === 'stdin') {
          if (spinner) spinner.stop();
          code = await readStdin();
          if (spinner) spinner.start('Nesting…');
          sourceHint = 'stdin';
        } else if (sourceKind === 'file') {
          const filePath = path.resolve(source!);
          code = fs.readFileSync(filePath, 'utf8');
          const ext = path.extname(filePath).slice(1).toLowerCase();
          formatHint = ext || undefined;
          sourceHint = `file:${path.basename(filePath)}`;
        } else {
          code = source!;
          sourceHint = 'paste';
        }

        const body: Record<string, unknown> = { code };
        if (formatHint) body.format_hint = formatHint;
        if (sourceHint) body.source_hint = sourceHint;

        importResponse = await apiClient.post('/api/v1/cli/ant/import', body);
      }
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Nest intake failed'));
      const apiError = handleApiError(error);
      if (json) {
        console.log(JSON.stringify({ error: apiError.message }));
      } else {
        console.error(chalk.red(`  ${apiError.message}`));
      }
      process.exit(1);
    }

    const preview = importResponse.data as Record<string, unknown>;
    const importId = (preview.import_id as string) || (preview.id as string);
    if (!importId) {
      if (spinner) spinner.fail(chalk.red('Nest intake returned no import_id'));
      process.exit(1);
    }

    // Execute with destination attached as modifications.destination
    if (spinner) spinner.text = 'Wiring…';
    let executeResponse: { data: Record<string, unknown> };
    try {
      executeResponse = await apiClient.post(NEST_EXECUTE, {
        import_id: importId,
        modifications: { destination },
      });
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Nest build failed'));
      const apiError = handleApiError(error);
      if (json) {
        console.log(JSON.stringify({ error: apiError.message, import_id: importId }));
      } else {
        console.error(chalk.red(`  ${apiError.message}`));
      }
      process.exit(1);
    }

    const result = executeResponse.data as Record<string, any>;
    // Everything the backend said, in one shape for both outputs (nest-helpers.ts).
    const outcome = nestOutcome(result, { importId, mode: destination.mode, pageType: destination.page_type });

    if (json) {
      console.log(JSON.stringify({ ...outcome, created: result.created }));
      return;
    }

    if (spinner) {
      spinner.succeed(
        destination.mode === 'sandbox'
          ? chalk.green('Nested to Sandbox')
          : chalk.green('Nested and placed'),
      );
    }
    console.log('');
    console.log(ui.label('Import', importId));
    console.log(ui.label('Status', String(outcome.status ?? '—')));
    console.log(ui.label('Mode', outcome.mode));
    if (destination.page_type) console.log(ui.label('Type', destination.page_type));
    if (outcome.url) console.log(ui.label('Page', String(outcome.url)));
    if (outcome.page_id != null) console.log(ui.label('Page ID', String(outcome.page_id)));

    console.log('');
    for (const line of nestOutcomeLines(outcome)) console.log(line ? `  ${line}` : '');
    if (outcome.errors?.length) {
      console.log('');
      for (const e of outcome.errors) console.log(chalk.yellow(`  ! ${e}`));
    }
    console.log('');
    console.log(chalk.dim(outcome.mode === 'sandbox'
      ? '  It is in your Sandbox (the Design Library) — private until you promote and publish it.'
      : '  It is a draft on your site — nobody can see it until you publish.'));
  });

// ---------------------------------------------------------------------------
// Folder: the site a designer handed over, every page of it
// ---------------------------------------------------------------------------

async function nestFolder(dir: string, flags: NestFlags, json: boolean): Promise<void> {
  const fail = (message: string, extra: Record<string, unknown> = {}): never => {
    if (json) console.log(JSON.stringify({ error: message, ...extra }));
    else console.error(chalk.red(`  ${message}`));
    process.exit(1);
  };

  const read = readFolder(path.resolve(dir));
  if (!read.htmlFiles.length) fail('That folder has no .html file — nothing to import.', { skipped: read.skipped });

  const spinner = json ? null : ora(`Nesting ${read.files.length} file(s), ${read.htmlFiles.length} page(s)…`).start();
  const allPages = !flags.single && read.htmlFiles.length > 1;
  let imported: Record<string, any>;
  try {
    const res = await apiClient.post('/api/v1/agent/nest/import', {
      files: read.files, all_pages: allPages, ...(flags.entry && { entry: flags.entry }),
      source_hint: `folder:${path.basename(path.resolve(dir))}`,
    });
    imported = res.data as Record<string, any>;
  } catch (error) {
    if (spinner) spinner.fail(chalk.red('Nest intake failed'));
    return fail(handleApiError(error).message);
  }

  if (imported.status === 'needs_choice') {
    if (spinner) spinner.stop();
    return fail(`${imported.summary} Re-run with --entry <file>.`, { html_files: imported.html_files });
  }
  if (imported.ok === false) {
    if (spinner) spinner.stop();
    return fail(String(imported.summary || imported.error || 'Nest refused the folder'), imported);
  }

  // One import per page (all_pages) or one for the entry page. Each page keeps
  // the slug and home/page type it was imported with — so page_type is NOT
  // sent here; only where it lands (mode, site, domain) is.
  const { page_type: _ignored, ...where } = flagsToDestination(flags);
  const pages: Array<Record<string, any>> = imported.pages
    ?? [{ file: imported.entry || read.htmlFiles[0], import_id: imported.import_id, ok: !!imported.import_id }];

  const built: Array<Record<string, unknown>> = [];
  for (const page of pages) {
    if (!page.ok || !page.import_id) {
      built.push({ file: page.file, ok: false, error: page.error || 'not imported' });
      continue;
    }
    if (spinner) spinner.text = `Building ${page.file}…`;
    try {
      const res = await apiClient.post(NEST_EXECUTE, {
        import_id: page.import_id, modifications: { destination: where },
      });
      const out = res.data as Record<string, any>;
      // The same shape a single page gets: kept or converted, why, the score, what next.
      const o = nestOutcome(out, { importId: page.import_id, mode: where.mode });
      built.push({ file: page.file, ok: true, ...o, url: o.url ?? page.url ?? null });
    } catch (error) {
      built.push({ file: page.file, import_id: page.import_id, ok: false, error: handleApiError(error).message });
    }
  }

  const ok = built.filter((b) => b.ok).length;
  if (json) {
    console.log(JSON.stringify({ pages: built, imported: ok, total: built.length,
      skipped: read.skipped, mode: where.mode ?? 'sandbox' }));
    if (ok < built.length) process.exitCode = 1;
    return;
  }
  if (spinner) {
    const verb = (where.mode ?? 'sandbox') === 'sandbox' ? 'to Sandbox' : 'and placed';
    (ok === built.length ? spinner.succeed(chalk.green(`Nested ${ok} page(s) ${verb}`))
      : spinner.warn(chalk.yellow(`Nested ${ok} of ${built.length} page(s) ${verb}`)));
  }
  console.log('');
  for (const b of built) {
    const design = b.import_mode === 'keep' ? 'design kept' : b.import_mode === 'convert' ? 'converted to blocks' : '';
    const score = (b.fidelity as { overall?: number } | null)?.overall;
    const said = [design, typeof score === 'number' ? `${score}/100` : ''].filter(Boolean).join(', ');
    console.log(`  ${b.ok ? chalk.green('✓') : chalk.red('✗')} ${String(b.file)}`
      + (said ? `  ${said}` : '')
      + (b.url ? chalk.dim(`  → ${b.url}`) : '') + (b.error ? chalk.red(`  ${b.error}`) : ''));
  }
  // The home page (or the only page) speaks for the import: its summary, preview and next step.
  const lead = built.find((b) => b.ok) as (Record<string, unknown> | undefined);
  if (lead) {
    console.log('');
    for (const line of nestOutcomeLines(lead as never)) console.log(line ? `  ${line}` : '');
  }
  if (read.skipped.length) {
    console.log(chalk.dim(`\n  Skipped ${read.skipped.length} item(s): `
      + read.skipped.slice(0, 5).map((x) => `${x.path} (${x.why})`).join(', ')));
  }
  if (ok < built.length) process.exitCode = 1;
  console.log('');
}

// ---------------------------------------------------------------------------
// Subcommands — explicit disambiguation for scripts and agent callers
// ---------------------------------------------------------------------------

nestCommand
  .command('list')
  .alias('ls')
  .description('List recent Nest drops (Design Library contents)')
  .option('--json', 'machine-readable output')
  .action(async (flags: { json?: boolean }) => {
    requireAuth();
    const spinner = flags.json ? null : ora('Loading…').start();
    try {
      const res = await apiClient.get('/api/v1/cli/ant/imports');
      const data = res.data as Record<string, any>;
      const imports = (data.imports ?? []) as Record<string, any>[];

      if (flags.json) {
        console.log(JSON.stringify(imports));
        return;
      }

      if (spinner) spinner.succeed(`${imports.length} drops`);
      if (imports.length === 0) {
        console.log(chalk.dim('  Nothing nested yet. Try `solid nest <url>`.'));
        return;
      }
      console.log('');
      const headers = ['ID', 'Type', 'Mode', 'Status', 'Created'];
      const rows = imports.map((imp) => [
        String(imp.import_id ?? imp.id).substring(0, 14),
        String(imp.page_type ?? '—'),
        String(imp.mode ?? 'sandbox'),
        String(imp.status ?? '—'),
        imp.created_at ? new Date(imp.created_at).toLocaleDateString() : '—',
      ]);
      console.log(ui.table(headers, rows));
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Failed to load drops'));
      emitErrorAndExit(error);
    }
  });

nestCommand
  .command('outcomes')
  .description('Which of my Nest drops converted — the feedback loop')
  .option('--campaign <id>', 'filter to one campaign')
  .option('--since <iso>', 'ISO datetime cutoff (e.g. 2026-04-01)')
  .option('--limit <n>', 'max rows', '50')
  .option('--json', 'machine-readable output')
  .action(async (flags: { campaign?: string; since?: string; limit?: string; json?: boolean }) => {
    requireAuth();
    const spinner = flags.json ? null : ora('Querying outcomes…').start();
    try {
      const qs = new URLSearchParams();
      if (flags.campaign) qs.set('campaign_id', flags.campaign);
      if (flags.since) qs.set('since', flags.since);
      qs.set('limit', flags.limit ?? '50');
      const res = await apiClient.get(`/api/v1/cli/ant/outcomes?${qs.toString()}`);
      const data = res.data as Record<string, any>;

      if (flags.json) {
        console.log(JSON.stringify(data));
        return;
      }

      const outcomes = (data.outcomes ?? []) as Record<string, any>[];
      const byCampaign = (data.by_campaign ?? []) as Record<string, any>[];

      if (spinner) spinner.succeed(`${outcomes.length} drops, ${byCampaign.length} campaigns`);

      if (outcomes.length === 0) {
        console.log(chalk.dim('  No tracked drops yet. `solid nest <...> --campaign <id> --live` to start measuring.'));
        return;
      }

      if (byCampaign.length > 0) {
        console.log('');
        console.log(ui.header('By campaign'));
        const campHeaders = ['Campaign', 'Drops', 'Views'];
        const campRows = byCampaign
          .slice()
          .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
          .map((b) => [
            String(b.campaign_id ?? '(untagged)'),
            String(b.drops ?? 0),
            String(b.views ?? 0),
          ]);
        console.log(ui.table(campHeaders, campRows));
      }

      console.log('');
      console.log(ui.header('Drops (ranked by views)'));
      const dropHeaders = ['ID', 'Type', 'Campaign', 'Goal', 'Views', 'URL'];
      const dropRows = outcomes
        .slice()
        .sort((a, b) => (b.page_views ?? 0) - (a.page_views ?? 0))
        .map((o) => [
          String(o.import_id ?? '').substring(0, 14),
          String(o.page_type ?? '—'),
          String(o.campaign_id ?? '—'),
          String(o.conversion_goal ?? '—'),
          String(o.page_views ?? 0),
          String(o.page_url ?? '—'),
        ]);
      console.log(ui.table(dropHeaders, dropRows));
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Failed to query outcomes'));
      emitErrorAndExit(error);
    }
  });

nestCommand
  .command('promote <import_id>')
  .description('Move a sandbox Nest drop onto a real site (still a draft — publish separately)')
  .option('--site <id>', 'destination Site id (numeric). Omit to use company default.')
  .option('--subdomain <sub>', 'subdomain hint (e.g. "promo"). Stored as intent; no DNS auto-creation.')
  .option('--custom-domain <domain>', 'custom domain (e.g. anglebuild.com)')
  .option('--json', 'machine-readable output')
  .action(async (importId: string, flags: { site?: string; subdomain?: string; customDomain?: string; json?: boolean }) => {
    requireAuth();
    const spinner = flags.json ? null : ora(`Promoting ${importId}…`).start();
    try {
      const destination: Record<string, unknown> = {};
      if (flags.site && /^\d+$/.test(flags.site)) destination.site_id = Number(flags.site);
      if (flags.subdomain?.trim()) destination.subdomain = flags.subdomain.trim();
      if (flags.customDomain?.trim()) destination.custom_domain = flags.customDomain.trim();

      const res = await apiClient.post(`/api/v1/cli/ant/imports/${importId}/promote`, { destination });
      const data = res.data as Record<string, any>;

      if (flags.json) {
        console.log(JSON.stringify(data));
        return;
      }

      if (spinner) spinner.succeed(chalk.green('Promoted'));
      console.log('');
      console.log(ui.label('Import', importId));
      console.log(ui.label('Page', String(data.page_id ?? '—')));
      console.log(ui.label('URL', String(data.page_url ?? '—')));
      console.log(ui.label('Site', String(data.site_id ?? '—')));
      if (data.custom_domain) console.log(ui.label('Custom domain', String(data.custom_domain)));
      console.log(ui.label('Mode', String(data.mode ?? '—')));
      console.log('');
      console.log(chalk.dim("  It's a draft on your site. Publish when ready."));
    } catch (error) {
      if (spinner) spinner.fail(chalk.red('Promote failed'));
      // fail() emits the standard error envelope under --json and the red
      // prose otherwise, so the hand-rolled {error} shape is no longer needed.
      emitErrorAndExit(error);
    }
  });

nestCommand
  .command('from-url <url>')
  .description('Nest from a URL (explicit; equivalent to `solid nest <url>`)')
  .option('--type <type>')
  .option('--site <id>')
  .option('--subdomain <sub>')
  .option('--custom-domain <domain>')
  .option('--live')
  .option('--campaign <id>')
  .option('--goal <goal>')
  .option('--json')
  .action(async (url: string, flags: NestFlags) => {
    // Delegate by invoking parent action
    await nestCommand.parseAsync(['node', 'nest', url, ...flagsAsArgv(flags)]);
  });

nestCommand
  .command('from-file <path>')
  .description('Nest from a local file (html/jsx/png/...)')
  .option('--type <type>')
  .option('--site <id>')
  .option('--subdomain <sub>')
  .option('--custom-domain <domain>')
  .option('--live')
  .option('--campaign <id>')
  .option('--goal <goal>')
  .option('--json')
  .action(async (filePath: string, flags: NestFlags) => {
    await nestCommand.parseAsync(['node', 'nest', filePath, ...flagsAsArgv(flags)]);
  });

// ---------------------------------------------------------------------------
// Examples
// ---------------------------------------------------------------------------

import { appendExamples as __ae_nest, emitErrorAndExit } from '../lib/command-kit';
__ae_nest(nestCommand, [
  { cmd: 'solid nest anglebuild.com', why: 'Fetch a URL, classify, save to Sandbox' },
  { cmd: 'solid nest ./my-site', why: 'A folder a designer handed over: every .html page in it, with its CSS, images and scripts' },
  { cmd: 'solid nest ./my-site --entry index.html --single', why: 'A folder, but only the one page' },
  { cmd: 'solid nest page.html --type landing --live', why: 'Nest a local file, place live as a landing page' },
  { cmd: 'cat design.jsx | solid nest - --type home', why: 'Pipe code in; land as a home page' },
  { cmd: 'solid nest <url> --type landing --site 5 --subdomain promo --campaign q2', why: 'Agent-native shape' },
  { cmd: 'solid nest list', why: 'See recent Nest drops (Design Library)' },
]);

nestCommand.addHelpText('after', `
What you get back (also in --json):
  import_mode   keep     your page as you wrote it — your markup, your CSS, your form. It is one
                         stored design: the owner changes the spots marked data-editable, not blocks.
                convert  rebuilt from our editable blocks — every section can be edited and it
                         follows the brand, but hand-built CSS and controls may not survive.
                The platform tries both and builds the one that scores higher. import_mode_why says why.
  fidelity      the score out of 100 against the original, and the score a publish needs.
                A page under that score is refused at publish; see: solid publish --help
  preview       the command for a private link to show the owner
  next          the next command, in order: promote → publish → domain

The journey, start to finish:
  solid bring <folder>                 what is this, and which command?
  solid nest <file|folder|url>         import it — lands in your Sandbox, private
  solid drafts preview <page_id>       a private link to look at it (or: solid render <slug>)
  solid nest promote <import_id>       put it on your site, still a draft
  solid publish <page_id>              make it live
  solid domains                        your own domain
  solid leads test                     send a labelled TEST lead through the live form

Where it lands: the Sandbox by default. Nothing is on a real site, and nothing is live, until
you promote and publish. --live skips the Sandbox and places a draft on the site at once.
`);
