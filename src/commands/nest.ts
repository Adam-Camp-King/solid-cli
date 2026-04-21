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
import ora from 'ora';

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
  type NestFlags,
} from './nest-helpers';

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
  .description('Nest — drop anything, we make it real. (paste/url/file → live page)')
  .argument('[source]', 'URL, file path, "-" for stdin, or raw code')
  .option('--type <type>', 'home | website | landing | email_landing | blog | product | booking | component')
  .option('--site <id>', 'destination Site id (numeric)')
  .option('--subdomain <sub>', 'hint for promote (e.g. "promo" → promo.solidnumber.com)')
  .option('--custom-domain <domain>', 'custom domain (e.g. anglebuild.com)')
  .option('--sandbox', 'save privately to the sandbox shelf (default)')
  .option('--live', 'skip sandbox — place immediately on a site as a draft')
  .option('--campaign <id>', 'campaign_id for outcome tracking')
  .option('--goal <goal>', 'form_submit | checkout | booking | chat_start | click')
  .option('--json', 'machine-readable output')
  .action(async (source: string | undefined, flags: NestFlags) => {
    requireAuth();
    const json = isJsonOutput(flags);
    const sourceKind = detectSource(source);

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
      executeResponse = await apiClient.post('/api/v1/cli/ant/execute', {
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

    if (json) {
      console.log(
        JSON.stringify({
          import_id: importId,
          status: result.status,
          mode: destination.mode,
          page_type: destination.page_type,
          created: result.created,
        }),
      );
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
    console.log(ui.label('Status', String(result.status ?? '—')));
    console.log(ui.label('Mode', destination.mode ?? 'sandbox'));
    if (destination.page_type) console.log(ui.label('Type', destination.page_type));
    const page = (result.created?.page ?? null) as Record<string, unknown> | null;
    if (page?.url) console.log(ui.label('Page', String(page.url)));
    if (page?.id) console.log(ui.label('Page ID', String(page.id)));

    console.log('');
    if (destination.mode === 'sandbox') {
      console.log(chalk.dim('  Find it in the Design Library. `solid nest promote <id>` to place it live.'));
    } else {
      console.log(chalk.dim('  It\'s a draft on your site. Publish when ready.'));
    }
  });

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
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
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

import { appendExamples as __ae_nest } from '../lib/command-kit';
__ae_nest(nestCommand, [
  { cmd: 'solid nest anglebuild.com', why: 'Fetch a URL, classify, save to Sandbox' },
  { cmd: 'solid nest page.html --type landing --live', why: 'Nest a local file, place live as a landing page' },
  { cmd: 'cat design.jsx | solid nest - --type home', why: 'Pipe code in; land as a home page' },
  { cmd: 'solid nest <url> --type landing --site 5 --subdomain promo --campaign q2', why: 'Agent-native shape' },
  { cmd: 'solid nest list', why: 'See recent Nest drops (Design Library)' },
]);
