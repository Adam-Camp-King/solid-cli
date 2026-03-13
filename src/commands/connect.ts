/**
 * Connect command — Import external data sources into Solid#
 *
 * Figma, Slack, Notion, WordPress, CSV, GitHub, Google Sheets, Google Docs
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const connectCommand = new Command('connect')
  .alias('conn')
  .description('Import external data into your Solid# business');

// Ensure logged in
function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────

function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleString();
}

function statusColor(status: string): (text: string) => string {
  switch (status) {
    case 'completed': return chalk.green;
    case 'running': case 'in_progress': return chalk.cyan;
    case 'queued': case 'pending': return chalk.yellow;
    case 'failed': return chalk.red;
    case 'cancelled': return chalk.dim;
    default: return chalk.white;
  }
}

function statusIcon(status: string): string {
  switch (status) {
    case 'completed': return chalk.green('✓');
    case 'running': case 'in_progress': return chalk.cyan('⟳');
    case 'queued': case 'pending': return chalk.yellow('○');
    case 'failed': return chalk.red('✗');
    case 'cancelled': return chalk.dim('—');
    default: return chalk.dim('?');
  }
}

function providerIcon(provider: string): string {
  const icons: Record<string, string> = {
    figma: '◆',
    slack: '#',
    notion: '▪',
    wordpress: 'W',
    csv: '▤',
    github: '⬡',
    sheets: '▦',
    docs: '▧',
  };
  return icons[provider] || '●';
}

function printImportSummary(data: {
  import_id: string;
  provider: string;
  status: string;
  items_imported?: number;
  items_skipped?: number;
  items_failed?: number;
  created_at?: string;
  completed_at?: string;
  details?: Record<string, unknown>;
}): void {
  console.log('');
  console.log(chalk.bold('  Import Summary'));
  console.log(chalk.dim('  ' + '─'.repeat(50)));
  console.log(chalk.dim('  Import ID:  ') + data.import_id);
  console.log(chalk.dim('  Provider:   ') + data.provider);
  console.log(chalk.dim('  Status:     ') + statusColor(data.status)(data.status));

  if (data.items_imported !== undefined) {
    console.log(chalk.dim('  Imported:   ') + chalk.green(data.items_imported.toString()));
  }
  if (data.items_skipped !== undefined && data.items_skipped > 0) {
    console.log(chalk.dim('  Skipped:    ') + chalk.yellow(data.items_skipped.toString()));
  }
  if (data.items_failed !== undefined && data.items_failed > 0) {
    console.log(chalk.dim('  Failed:     ') + chalk.red(data.items_failed.toString()));
  }
  if (data.created_at) {
    console.log(chalk.dim('  Started:    ') + formatDate(data.created_at));
  }
  if (data.completed_at) {
    console.log(chalk.dim('  Completed:  ') + formatDate(data.completed_at));
  }

  if (data.details) {
    console.log('');
    console.log(chalk.dim('  Details:'));
    for (const [key, value] of Object.entries(data.details)) {
      const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
      console.log(chalk.dim(`    ${label}: `) + String(value));
    }
  }
}

// ── Figma ─────────────────────────────────────────────────────────────

connectCommand
  .command('figma <url>')
  .description('Import Figma design → CMS pages + brand tokens')
  .option('--pages-only', 'Import page layouts only (skip brand tokens)')
  .option('--brand-only', 'Extract brand tokens only (skip page layouts)')
  .option('--preview', 'Dry run — show what would be imported without making changes')
  .action(async (url: string, options) => {
    requireAuth();

    let token = process.env.FIGMA_PAT;
    if (!token) {
      const answers = await (await import('inquirer')).default.prompt([{
        type: 'password',
        name: 'token',
        message: 'Figma Personal Access Token:',
        mask: '*',
        validate: (input: string) => input.length > 0 || 'Token is required',
      }]);
      token = answers.token;
    }
    if (!token) {
      console.error(chalk.red('Figma token required. Set FIGMA_PAT env var or enter when prompted.'));
      console.error(chalk.dim('  Get your token at: https://www.figma.com/developers/api#access-tokens'));
      process.exit(1);
    }

    const mode = options.pagesOnly ? 'pages' : options.brandOnly ? 'brand' : 'all';
    const label = options.preview ? 'Analyzing Figma design...' : `Importing Figma design (${mode})...`;
    const spinner = ora(label).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
        preview?: {
          pages: Array<{ name: string; type: string; components: number }>;
          brand_tokens: { colors: number; typography: number; spacing: number };
        };
      }>('/api/v1/connections/figma/import', {
        url,
        token,
        mode,
        preview: options.preview || false,
      });

      if (options.preview) {
        spinner.succeed('Figma design analyzed (dry run)');
        const preview = response.data.preview;
        if (preview) {
          console.log('');
          if (preview.pages && preview.pages.length > 0) {
            console.log(chalk.bold('  Pages found:'));
            for (const page of preview.pages) {
              console.log(`    ${chalk.cyan(providerIcon('figma'))} ${page.name} ${chalk.dim(`(${page.type}, ${page.components} components)`)}`);
            }
          }
          if (preview.brand_tokens) {
            console.log('');
            console.log(chalk.bold('  Brand tokens:'));
            console.log(chalk.dim(`    Colors: ${preview.brand_tokens.colors}`));
            console.log(chalk.dim(`    Typography: ${preview.brand_tokens.typography}`));
            console.log(chalk.dim(`    Spacing: ${preview.brand_tokens.spacing}`));
          }
          console.log('');
          console.log(chalk.dim('  Run without --preview to import.'));
        }
      } else {
        spinner.succeed(chalk.green('Figma import complete'));
        printImportSummary(response.data);
      }
    } catch (error) {
      spinner.fail(chalk.red('Figma import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Slack ─────────────────────────────────────────────────────────────

connectCommand
  .command('slack <channel>')
  .description('Import Slack channel messages → KB articles')
  .option('--faq', 'Extract FAQ-style question/answer pairs')
  .option('--train', 'Import as AI training data')
  .option('--all', 'Import all messages (not just highlighted/pinned)')
  .option('--since <date>', 'Import messages since date (YYYY-MM-DD)')
  .option('--until <date>', 'Import messages until date (YYYY-MM-DD)')
  .option('--anonymize', 'Strip usernames and personal info from imported content')
  .action(async (channel: string, options) => {
    requireAuth();

    const importMode = options.faq ? 'faq' : options.train ? 'training' : 'kb';
    const spinner = ora(`Importing Slack channel #${channel} as ${importMode}...`).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/slack/import', {
        channel,
        mode: importMode,
        include_all: options.all || false,
        since: options.since,
        until: options.until,
        anonymize: options.anonymize || false,
      });

      spinner.succeed(chalk.green(`Slack #${channel} import complete`));
      printImportSummary(response.data);

      if (importMode === 'faq') {
        console.log('');
        console.log(chalk.dim('  FAQ pairs are available in your KB. Run `solid kb list` to view.'));
      } else if (importMode === 'training') {
        console.log('');
        console.log(chalk.dim('  Training data queued. Run `solid train status` to check progress.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('Slack import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Notion ────────────────────────────────────────────────────────────

connectCommand
  .command('notion <url>')
  .description('Import Notion page or database → KB or entity data')
  .option('--as <entity>', 'Import as entity type: kb, contacts, services, inventory', 'kb')
  .action(async (url: string, options) => {
    requireAuth();

    const entity = options.as;
    const validEntities = ['kb', 'contacts', 'services', 'inventory'];
    if (!validEntities.includes(entity)) {
      console.error(chalk.red(`Invalid entity type: ${entity}`));
      console.error(chalk.dim(`  Valid types: ${validEntities.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora(`Importing Notion content as ${entity}...`).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/notion/import', {
        url,
        entity_type: entity,
      });

      spinner.succeed(chalk.green('Notion import complete'));
      printImportSummary(response.data);

      if (entity === 'kb') {
        console.log('');
        console.log(chalk.dim('  KB articles created. Run `solid kb list` to view.'));
      } else {
        console.log('');
        console.log(chalk.dim(`  ${entity} records created. Run \`solid ${entity === 'contacts' ? 'crm contacts' : entity} list\` to view.`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Notion import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── WordPress ─────────────────────────────────────────────────────────

connectCommand
  .command('wordpress <url>')
  .description('Import WordPress site → CMS pages')
  .option('--pages-only', 'Import pages only (skip blog posts)')
  .option('--blog-only', 'Import blog posts only (skip pages)')
  .option('--media', 'Also import media/images')
  .action(async (url: string, options) => {
    requireAuth();

    const mode = options.pagesOnly ? 'pages' : options.blogOnly ? 'blog' : 'all';
    const spinner = ora(`Importing WordPress site (${mode})...`).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/wordpress/import', {
        url,
        mode,
        include_media: options.media || false,
      });

      spinner.succeed(chalk.green('WordPress import complete'));
      printImportSummary(response.data);

      console.log('');
      if (mode === 'blog' || mode === 'all') {
        console.log(chalk.dim('  Blog posts created. Run `solid blog list` to view.'));
      }
      if (mode === 'pages' || mode === 'all') {
        console.log(chalk.dim('  CMS pages created. Run `solid pages list` to view.'));
      }
    } catch (error) {
      spinner.fail(chalk.red('WordPress import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── CSV ───────────────────────────────────────────────────────────────

connectCommand
  .command('csv <file>')
  .description('Import CSV/Excel file → entity data')
  .option('--entity <type>', 'Entity type: contacts, services, inventory, products', 'contacts')
  .option('--preview', 'Preview column mapping without importing')
  .action(async (file: string, options) => {
    requireAuth();

    const entity = options.entity;
    const validEntities = ['contacts', 'services', 'inventory', 'products'];
    if (!validEntities.includes(entity)) {
      console.error(chalk.red(`Invalid entity type: ${entity}`));
      console.error(chalk.dim(`  Valid types: ${validEntities.join(', ')}`));
      process.exit(1);
    }

    const label = options.preview ? 'Analyzing CSV structure...' : `Importing CSV as ${entity}...`;
    const spinner = ora(label).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
        preview?: {
          columns: Array<{ source: string; mapped_to: string; sample_values: string[] }>;
          total_rows: number;
          valid_rows: number;
          invalid_rows: number;
        };
      }>('/api/v1/connections/csv/import', {
        file_path: file,
        entity_type: entity,
        preview: options.preview || false,
      });

      if (options.preview) {
        spinner.succeed('CSV structure analyzed (dry run)');
        const preview = response.data.preview;
        if (preview) {
          console.log('');
          console.log(chalk.bold('  Column Mapping:'));
          console.log('');
          console.log(
            chalk.bold('  SOURCE'.padEnd(24)) +
            chalk.bold('MAPPED TO'.padEnd(24)) +
            chalk.bold('SAMPLE')
          );
          console.log(chalk.dim('  ' + '─'.repeat(65)));

          for (const col of preview.columns) {
            const mapped = col.mapped_to === 'unmapped' ? chalk.yellow('unmapped') : chalk.green(col.mapped_to);
            const sample = col.sample_values.slice(0, 2).join(', ');
            console.log(
              `  ${col.source.padEnd(24)}` +
              `${mapped}`.padEnd(24 + (col.mapped_to === 'unmapped' ? 10 : 0)) +
              chalk.dim(sample.slice(0, 30))
            );
          }

          console.log('');
          console.log(chalk.dim(`  Total rows: ${preview.total_rows}  |  Valid: ${chalk.green(String(preview.valid_rows))}  |  Invalid: ${preview.invalid_rows > 0 ? chalk.red(String(preview.invalid_rows)) : chalk.dim('0')}`));
          console.log('');
          console.log(chalk.dim('  Run without --preview to import.'));
        }
      } else {
        spinner.succeed(chalk.green('CSV import complete'));
        printImportSummary(response.data);
      }
    } catch (error) {
      spinner.fail(chalk.red('CSV import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── GitHub ────────────────────────────────────────────────────────────

connectCommand
  .command('github <url>')
  .description('Import GitHub repo documentation → developer KB')
  .option('--docs-only', 'Import only /docs directory')
  .option('--readme', 'Import README.md only')
  .action(async (url: string, options) => {
    requireAuth();

    const mode = options.docsOnly ? 'docs' : options.readme ? 'readme' : 'all';
    const spinner = ora(`Importing GitHub repo documentation (${mode})...`).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/github/import', {
        url,
        mode,
      });

      spinner.succeed(chalk.green('GitHub import complete'));
      printImportSummary(response.data);

      console.log('');
      console.log(chalk.dim('  Documentation added to KB. Run `solid kb list` to view.'));
    } catch (error) {
      spinner.fail(chalk.red('GitHub import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Google Sheets ─────────────────────────────────────────────────────

connectCommand
  .command('sheets <id>')
  .description('Transform Google Sheet → entity data (uses existing Google OAuth)')
  .option('--as <entity>', 'Import as entity type: contacts, services, inventory, products', 'contacts')
  .action(async (id: string, options) => {
    requireAuth();

    const entity = options.as;
    const validEntities = ['contacts', 'services', 'inventory', 'products'];
    if (!validEntities.includes(entity)) {
      console.error(chalk.red(`Invalid entity type: ${entity}`));
      console.error(chalk.dim(`  Valid types: ${validEntities.join(', ')}`));
      process.exit(1);
    }

    const spinner = ora(`Importing Google Sheet as ${entity}...`).start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/sheets/import', {
        sheet_id: id,
        entity_type: entity,
      });

      spinner.succeed(chalk.green('Google Sheets import complete'));
      printImportSummary(response.data);

      console.log('');
      console.log(chalk.dim(`  ${entity} records created. Run \`solid ${entity === 'contacts' ? 'crm contacts' : entity} list\` to view.`));
    } catch (error) {
      spinner.fail(chalk.red('Google Sheets import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));

      if (apiError.status === 403) {
        console.error('');
        console.error(chalk.dim('  Google OAuth may not be connected. Check your Google integration in the dashboard.'));
      }
    }
  });

// ── Google Docs ───────────────────────────────────────────────────────

connectCommand
  .command('docs <id>')
  .description('Transform Google Doc → KB article (uses existing Google OAuth)')
  .action(async (id: string) => {
    requireAuth();

    const spinner = ora('Importing Google Doc as KB article...').start();

    try {
      const response = await apiClient.post<{
        import_id: string;
        provider: string;
        status: string;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string;
        details: Record<string, unknown>;
      }>('/api/v1/connections/docs/import', {
        doc_id: id,
      });

      spinner.succeed(chalk.green('Google Doc import complete'));
      printImportSummary(response.data);

      console.log('');
      console.log(chalk.dim('  KB article created. Run `solid kb list` to view.'));
    } catch (error) {
      spinner.fail(chalk.red('Google Doc import failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));

      if (apiError.status === 403) {
        console.error('');
        console.error(chalk.dim('  Google OAuth may not be connected. Check your Google integration in the dashboard.'));
      }
    }
  });

// ── List ──────────────────────────────────────────────────────────────

connectCommand
  .command('list')
  .alias('ls')
  .description('Show active connections + recent import history')
  .action(async () => {
    requireAuth();

    const spinner = ora('Fetching connections...').start();

    try {
      const response = await apiClient.get<{
        connections: Array<{
          provider: string;
          status: string;
          connected_at: string;
          last_import_at: string | null;
          total_imports: number;
        }>;
        recent_imports: Array<{
          import_id: string;
          provider: string;
          status: string;
          items_imported: number;
          created_at: string;
        }>;
      }>('/api/v1/connections/history', { params: { limit: 10 } });

      spinner.succeed('Connections loaded');
      console.log('');

      // Active connections
      const connections = response.data.connections;
      if (connections && connections.length > 0) {
        console.log(chalk.bold('  Active Connections'));
        console.log(chalk.dim('  ' + '─'.repeat(60)));

        for (const conn of connections) {
          const icon = conn.status === 'active' ? chalk.green('●') : chalk.dim('○');
          const lastImport = conn.last_import_at ? formatDate(conn.last_import_at) : 'never';
          console.log(
            `  ${icon} ${chalk.cyan(providerIcon(conn.provider))} ${conn.provider.padEnd(14)}` +
            chalk.dim(`${conn.total_imports} imports  |  last: ${lastImport}`)
          );
        }
      } else {
        console.log(chalk.dim('  No active connections.'));
        console.log(chalk.dim('  Connect a source: solid connect figma|slack|notion|wordpress|csv|github|sheets|docs'));
      }

      // Recent imports
      const imports = response.data.recent_imports;
      if (imports && imports.length > 0) {
        console.log('');
        console.log(chalk.bold('  Recent Imports'));
        console.log(chalk.dim('  ' + '─'.repeat(60)));

        console.log(
          chalk.bold('  ').padEnd(4) +
          chalk.bold('ID'.padEnd(14)) +
          chalk.bold('PROVIDER'.padEnd(14)) +
          chalk.bold('ITEMS'.padEnd(10)) +
          chalk.bold('STATUS'.padEnd(14)) +
          chalk.bold('DATE')
        );

        for (const imp of imports) {
          console.log(
            `  ${statusIcon(imp.status)} ` +
            `${imp.import_id.slice(0, 12).padEnd(14)}` +
            `${imp.provider.padEnd(14)}` +
            `${String(imp.items_imported).padEnd(10)}` +
            `${statusColor(imp.status)(imp.status).padEnd(14)}` +
            chalk.dim(formatDate(imp.created_at))
          );
        }
      }

      console.log('');
      console.log(chalk.dim('  Full history: solid connect history'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch connections'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── History ───────────────────────────────────────────────────────────

connectCommand
  .command('history')
  .description('Full import history')
  .option('-n, --limit <number>', 'Number of entries to show', '25')
  .option('-p, --provider <provider>', 'Filter by provider (figma, slack, notion, etc.)')
  .option('-s, --status <status>', 'Filter by status (completed, failed, running)')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Fetching import history...').start();

    try {
      const params: Record<string, unknown> = { limit: parseInt(options.limit) };
      if (options.provider) params.provider = options.provider;
      if (options.status) params.status = options.status;

      const response = await apiClient.get<{
        imports: Array<{
          import_id: string;
          provider: string;
          status: string;
          items_imported: number;
          items_skipped: number;
          items_failed: number;
          created_at: string;
          completed_at: string | null;
          entity_type: string | null;
        }>;
        total: number;
      }>('/api/v1/connections/history', { params });

      const imports = response.data.imports;
      spinner.succeed(`${response.data.total} total imports`);

      if (!imports || imports.length === 0) {
        console.log('');
        console.log(chalk.dim('  No import history found.'));
        return;
      }

      console.log('');
      console.log(
        chalk.bold('  ').padEnd(4) +
        chalk.bold('ID'.padEnd(14)) +
        chalk.bold('PROVIDER'.padEnd(12)) +
        chalk.bold('ENTITY'.padEnd(12)) +
        chalk.bold('ITEMS'.padEnd(8)) +
        chalk.bold('SKIP'.padEnd(7)) +
        chalk.bold('FAIL'.padEnd(7)) +
        chalk.bold('STATUS'.padEnd(12)) +
        chalk.bold('DATE')
      );
      console.log(chalk.dim('  ' + '─'.repeat(90)));

      for (const imp of imports) {
        const failStr = imp.items_failed > 0 ? chalk.red(String(imp.items_failed)) : chalk.dim('0');
        const skipStr = imp.items_skipped > 0 ? chalk.yellow(String(imp.items_skipped)) : chalk.dim('0');

        console.log(
          `  ${statusIcon(imp.status)} ` +
          `${imp.import_id.slice(0, 12).padEnd(14)}` +
          `${imp.provider.padEnd(12)}` +
          `${(imp.entity_type || '—').padEnd(12)}` +
          `${chalk.green(String(imp.items_imported)).padEnd(8)}` +
          `${skipStr.padEnd(7)}` +
          `${failStr.padEnd(7)}` +
          `${statusColor(imp.status)(imp.status).padEnd(12)}` +
          chalk.dim(formatDate(imp.created_at))
        );
      }

      if (response.data.total > imports.length) {
        console.log('');
        console.log(chalk.dim(`  Showing ${imports.length} of ${response.data.total}. Use --limit to see more.`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch history'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Status ────────────────────────────────────────────────────────────

connectCommand
  .command('status <id>')
  .description('Check import progress')
  .action(async (id: string) => {
    requireAuth();

    const spinner = ora('Checking import status...').start();

    try {
      const response = await apiClient.get<{
        import_id: string;
        provider: string;
        status: string;
        progress: number;
        items_imported: number;
        items_skipped: number;
        items_failed: number;
        created_at: string;
        completed_at: string | null;
        details: Record<string, unknown>;
        errors: Array<{ item: string; message: string }>;
      }>(`/api/v1/connections/${id}/status`);

      const data = response.data;

      if (data.status === 'completed') {
        spinner.succeed(chalk.green('Import completed'));
      } else if (data.status === 'failed') {
        spinner.fail(chalk.red('Import failed'));
      } else if (data.status === 'running' || data.status === 'in_progress') {
        spinner.info(chalk.cyan(`Import in progress (${data.progress}%)`));
      } else {
        spinner.info(`Import status: ${data.status}`);
      }

      printImportSummary({
        import_id: data.import_id,
        provider: data.provider,
        status: data.status,
        items_imported: data.items_imported,
        items_skipped: data.items_skipped,
        items_failed: data.items_failed,
        created_at: data.created_at,
        completed_at: data.completed_at || undefined,
        details: data.details,
      });

      // Progress bar for in-progress imports
      if (data.status === 'running' || data.status === 'in_progress') {
        console.log('');
        const barWidth = 40;
        const filled = Math.round((data.progress / 100) * barWidth);
        const empty = barWidth - filled;
        const bar = chalk.cyan('█'.repeat(filled)) + chalk.dim('░'.repeat(empty));
        console.log(`  [${bar}] ${data.progress}%`);
      }

      // Show errors if any
      if (data.errors && data.errors.length > 0) {
        console.log('');
        console.log(chalk.red('  Errors:'));
        for (const err of data.errors.slice(0, 10)) {
          console.log(chalk.red(`    ✗ ${err.item}: ${err.message}`));
        }
        if (data.errors.length > 10) {
          console.log(chalk.dim(`    ... and ${data.errors.length - 10} more errors`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to check status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
