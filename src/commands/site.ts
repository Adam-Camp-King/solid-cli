/**
 * Site management commands for Solid CLI
 *
 * solid site list                              → List all sites
 * solid site create my-shop --template shop    → Create new site
 * solid site info 42                           → Site details
 * solid site delete 42                         → Delete site
 * solid site templates                         → Available templates + recommended
 * solid site guardrails 42                     → Show CMS guardrails for a site
 * solid site set-guardrails 42 --mode locked   → Set mode (locked|open|copy-only|custom)
 * solid site reset-guardrails 42               → Remove row, revert to default mode
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const siteCommand = new Command('site')
  .description('Website management');

// List sites
siteCommand
  .command('list')
  .description('List all sites for your company')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading sites...').start();

    try {
      const response = await apiClient.sitesList();

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const sites = (response.data as Record<string, any>).sites || [];
      spinner.succeed(chalk.green(`${sites.length} sites`));

      if (sites.length === 0) {
        console.log(chalk.dim('  No sites yet. Create one: solid site create my-site'));
        return;
      }

      console.log('');
      for (const site of sites) {
        const live = site.is_live ? chalk.green('● LIVE') : chalk.dim('○ draft');
        const template = site.template ? chalk.cyan(`[${site.template}]`) : '';
        console.log(`  ${chalk.bold(site.name || site.slug)} ${template} ${live}`);
        console.log(chalk.dim(`    ID: ${site.id}  Slug: ${site.slug}  Type: ${site.site_type || 'site'}`));
        if (site.url) {
          console.log(chalk.dim(`    URL: ${site.url}`));
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load sites'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Create site
siteCommand
  .command('create <slug>')
  .description('Create a new site')
  .option('-t, --template <template>', 'Site template (basecamp, fireside, shop, dexter, redsky)')
  .option('-n, --name <name>', 'Display name')
  .option('--live', 'Create as live (published) site')
  .action(async (slug: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora(`Creating site "${slug}"...`).start();

    try {
      const response = await apiClient.siteCreate(
        slug,
        options.template,
        options.name,
        options.live || false,
      );

      const data = response.data as Record<string, any>;
      const site = data.site || {};
      spinner.succeed(chalk.green(`Site created: ${site.name || slug}`));

      console.log('');
      console.log(ui.successBox('Site Created', [
        `ID:       ${site.id}`,
        `Slug:     ${site.slug}`,
        `Template: ${site.template || 'basecamp'}`,
        `Status:   ${site.is_live ? 'LIVE' : 'Draft'}`,
      ]));

      if (data.message) {
        console.log(chalk.dim(`  ${data.message}`));
      }

      console.log('');
      console.log(chalk.dim('  View pages:  ') + chalk.cyan('solid pages list'));
      console.log(chalk.dim('  Pull files:  ') + chalk.cyan('solid pull'));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to create site'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Site info
siteCommand
  .command('info <id>')
  .description('Show site details')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const siteId = parseInt(id, 10);
    if (isNaN(siteId)) {
      console.error(chalk.red('Invalid site ID.'));
      process.exit(1);
    }

    const spinner = ora(`Loading site #${siteId}...`).start();

    try {
      const response = await apiClient.siteGet(siteId);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const site = (response.data as Record<string, any>).site || {};
      spinner.succeed(chalk.green(site.name || site.slug));

      console.log('');
      console.log(`  ${chalk.bold('ID:')}        ${site.id}`);
      console.log(`  ${chalk.bold('Slug:')}      ${site.slug}`);
      console.log(`  ${chalk.bold('Name:')}      ${site.name || chalk.dim('(none)')}`);
      console.log(`  ${chalk.bold('Template:')}  ${site.template || chalk.dim('custom')}`);
      console.log(`  ${chalk.bold('Type:')}      ${site.site_type || 'site'}`);
      console.log(`  ${chalk.bold('Status:')}    ${site.is_live ? chalk.green('LIVE') : chalk.yellow('Draft')}`);
      console.log(`  ${chalk.bold('Published:')} ${site.is_published ? 'Yes' : 'No'}`);
      if (site.url) {
        console.log(`  ${chalk.bold('URL:')}       ${site.url}`);
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load site'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Delete site
siteCommand
  .command('delete <id>')
  .description('Delete a site')
  .action(async (id: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const siteId = parseInt(id, 10);
    if (isNaN(siteId)) {
      console.error(chalk.red('Invalid site ID.'));
      process.exit(1);
    }

    const spinner = ora(`Deleting site #${siteId}...`).start();

    try {
      await apiClient.siteDelete(siteId);
      spinner.succeed(chalk.green(`Site #${siteId} deleted`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to delete site'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// List available templates
siteCommand
  .command('templates')
  .description('Show available site templates')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading templates...').start();

    try {
      const response = await apiClient.siteTemplates();
      const data = response.data as Record<string, any>;
      const templates = data.templates || [];
      const recommended = data.recommended;

      spinner.succeed(chalk.green(`${templates.length} templates available`));

      console.log('');
      for (const t of templates) {
        const rec = t.template === recommended ? chalk.green(' ← recommended') : '';
        console.log(`  ${chalk.bold(t.template || t.name)}${rec}`);
        console.log(chalk.dim(`    ${t.description || ''}`));
      }

      console.log('');
      console.log(chalk.dim('  Create site: ') + chalk.cyan(`solid site create my-site --template ${recommended || 'basecamp'}`));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load templates'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── CMS Guardrails ──────────────────────────────────────────────────

siteCommand
  .command('guardrails <id>')
  .description('Show CMS edit guardrails for a site')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const siteId = parseInt(id, 10);
    if (isNaN(siteId)) {
      console.error(chalk.red('Invalid site ID.'));
      process.exit(1);
    }
    const spinner = options.json ? null : ora(`Loading guardrails for site #${siteId}...`).start();
    try {
      const res = await apiClient.get<Record<string, unknown>>(`/api/v1/cms/guardrails/sites/${siteId}`);
      const data = res.data as Record<string, unknown>;
      if (options.json) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      spinner?.succeed(chalk.green(`Guardrails for site #${siteId}`));
      console.log('');
      console.log(`  ${chalk.bold('Mode:')}       ${chalk.cyan(String(data.mode))}${data.is_default ? chalk.dim(' (default, no row)') : ''}`);
      const effFlags = (data.effective_flags || {}) as Record<string, boolean>;
      console.log(`  ${chalk.bold('Effective flags:')}`);
      for (const [k, v] of Object.entries(effFlags)) {
        console.log(`    ${v ? chalk.green('✓') : chalk.red('✗')} ${k}`);
      }
      if (Array.isArray(data.editable_fields) && (data.editable_fields as unknown[]).length > 0) {
        console.log(`  ${chalk.bold('Editable fields:')} ${(data.editable_fields as string[]).join(', ')}`);
      }
      console.log('');
    } catch (error) {
      spinner?.fail(chalk.red('Failed to load guardrails'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

siteCommand
  .command('set-guardrails <id>')
  .description('Set CMS edit guardrails for a site')
  .requiredOption('--mode <mode>', 'One of: locked, open, copy-only, custom')
  .option('--flags <json>', 'JSON object of custom flags (only used when --mode=custom)')
  .option('--editable-fields <json>', 'JSON array of field path strings (custom mode)')
  .action(async (id: string, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const siteId = parseInt(id, 10);
    if (isNaN(siteId)) {
      console.error(chalk.red('Invalid site ID.'));
      process.exit(1);
    }
    const validModes = new Set(['locked', 'open', 'copy-only', 'custom']);
    if (!validModes.has(options.mode)) {
      console.error(chalk.red(`Invalid mode: ${options.mode}. Must be one of: locked, open, copy-only, custom`));
      process.exit(1);
    }
    let flags: Record<string, boolean> | undefined;
    let editableFields: string[] | undefined;
    if (options.flags) {
      try {
        flags = JSON.parse(options.flags);
      } catch {
        console.error(chalk.red('Invalid JSON passed to --flags'));
        process.exit(1);
      }
    }
    if (options.editableFields) {
      try {
        editableFields = JSON.parse(options.editableFields);
      } catch {
        console.error(chalk.red('Invalid JSON passed to --editable-fields'));
        process.exit(1);
      }
    }
    const spinner = ora(`Setting guardrails for site #${siteId} → ${options.mode}...`).start();
    try {
      const res = await apiClient.put<Record<string, unknown>>(`/api/v1/cms/guardrails/sites/${siteId}`, {
        mode: options.mode,
        flags,
        editable_fields: editableFields,
      });
      const data = res.data as Record<string, unknown>;
      spinner.succeed(chalk.green(`Guardrails set: ${data.mode}`));
      const effFlags = (data.effective_flags || {}) as Record<string, boolean>;
      console.log('');
      console.log(`  ${chalk.bold('Effective flags:')}`);
      for (const [k, v] of Object.entries(effFlags)) {
        console.log(`    ${v ? chalk.green('✓') : chalk.red('✗')} ${k}`);
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to set guardrails'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

siteCommand
  .command('reset-guardrails <id>')
  .description('Remove guardrails row for a site, reverting to default mode (copy-only)')
  .action(async (id: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const siteId = parseInt(id, 10);
    if (isNaN(siteId)) {
      console.error(chalk.red('Invalid site ID.'));
      process.exit(1);
    }
    const spinner = ora(`Resetting guardrails for site #${siteId}...`).start();
    try {
      await apiClient.delete(`/api/v1/cms/guardrails/sites/${siteId}`);
      spinner.succeed(chalk.green(`Guardrails reset for site #${siteId} (now default: copy-only)`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to reset guardrails'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Regenerate website pages
siteCommand
  .command('regenerate')
  .description('Regenerate all non-customized pages with updated design preferences')
  .option('--style <preset>', 'Style preset (modern, bold, classic, warm)')
  .option('--color <hex>', 'Primary color (e.g., #6366f1)')
  .option('--cta <text>', 'CTA button text')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Regenerating website pages...').start();

    try {
      const body: Record<string, unknown> = {};
      if (options.style) body.style_preset = options.style;
      if (options.color) body.primary_color = options.color;
      if (options.cta) body.cta_text = options.cta;

      const response = await apiClient.post('/api/v1/cms/pages/regenerate-website', body);
      const data = response.data as Record<string, any>;
      spinner.succeed(chalk.green('Website regenerated'));

      console.log('');
      if (data.pages_regenerated) console.log(`  ${chalk.dim('Pages updated:')} ${data.pages_regenerated}`);
      if (data.pages_skipped) console.log(`  ${chalk.dim('Pages skipped (customized):')} ${data.pages_skipped}`);
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to regenerate'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
