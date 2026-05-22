/**
 * solid sites — Multi-tenant site picker (Phase 8 TO.2).
 *
 * An operator with access to multiple companies (their own + partner
 * companies via user_company_access) can list every site they can
 * touch and switch the working directory's .solid/manifest.json
 * binding without knowing slugs ahead of time.
 *
 * Commands:
 *   solid sites list [--json]
 *      List every (company_id, slug, role, is_primary) bound to the
 *      current principal.
 *   solid sites switch <slug>
 *      Re-bind the current directory's .solid/manifest.json to the
 *      named site. Validates the user has access via the backend.
 */
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError, failApi } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

interface SiteEntry {
  company_id: number;
  name: string | null;
  slug: string | null;
  role: string | null;
  is_primary: boolean;
}

interface SitesResponse {
  schema: string;
  count: number;
  primary_company_id: number | null;
  sites: SiteEntry[];
}

function requireLogin(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const sitesCommand = new Command('sites')
  .description('List + switch between every Solid# site you have access to');

sitesCommand
  .command('list')
  .description('List every site the current principal can access')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireLogin();
    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora('Listing sites...').start();
    try {
      const res = await apiClient.get('/api/v1/cli/sites');
      spinner?.stop();
      const data = res.data as SitesResponse;
      if (wantsJson) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log(chalk.cyan(`${data.count} site(s)`));
      for (const s of data.sites) {
        const marker = s.is_primary ? chalk.green('*') : ' ';
        const name = s.name || `Company ${s.company_id}`;
        const slug = s.slug || `co-${s.company_id}`;
        const role = s.role ? chalk.dim(`(${s.role})`) : '';
        console.log(`  ${marker} ${slug.padEnd(28)} ${chalk.gray(`#${s.company_id}`)}  ${name} ${role}`);
      }
      console.log('');
      console.log(chalk.dim(`use 'solid sites switch <slug>' to re-bind the working directory`));
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });

sitesCommand
  .command('switch <slug>')
  .description('Re-bind the working directory to a different site')
  .option('--json', 'Output as JSON')
  .action(async (slug, options) => {
    requireLogin();
    const wantsJson = options.json || isJsonOutput();
    const spinner = wantsJson ? null : ora(`Switching to ${slug}...`).start();
    try {
      const res = await apiClient.get('/api/v1/cli/sites');
      const data = res.data as SitesResponse;
      const target = data.sites.find((s) => s.slug === slug);
      if (!target) {
        spinner?.fail(chalk.red(`No site with slug '${slug}' in your account`));
        process.exit(1);
      }

      // Write .solid/manifest.json in the current working directory.
      const manifestDir = path.join(process.cwd(), '.solid');
      if (!fs.existsSync(manifestDir)) {
        fs.mkdirSync(manifestDir, { recursive: true });
      }
      const manifestPath = path.join(manifestDir, 'manifest.json');
      const manifest = {
        company_id: target.company_id,
        slug: target.slug,
        name: target.name,
        bound_at: new Date().toISOString(),
        bound_by: 'solid sites switch',
      };
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      spinner?.stop();

      if (wantsJson) {
        console.log(JSON.stringify({ success: true, ...manifest }, null, 2));
        return;
      }
      console.log(chalk.green(`✓ Bound to ${target.slug || `co-${target.company_id}`} (#${target.company_id})`));
      console.log(chalk.dim(`  manifest: ${manifestPath}`));
    } catch (e) {
      spinner?.stop();
      failApi(e);
    }
  });
