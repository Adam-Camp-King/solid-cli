/**
 * Pull command for Solid CLI
 *
 * Downloads all business data as local files:
 *   ./pages/*.json       — CMS page layouts
 *   ./kb/*.md             — Knowledge base entries (frontmatter + content)
 *   ./services/*.json     — Service catalog
 *   ./products/*.json     — Product catalog
 *   ./solid.config.json   — Website settings + company info
 *   ./.solid/manifest.json — Sync metadata (do not edit)
 *
 * All data is scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

interface PullManifest {
  company_id: number;
  company_name: string;
  pulled_at: string;
  api_url: string;
  pages: Record<string, { id: number; slug: string; updated_at: string }>;
  kb: Record<string, { id: number; title: string }>;
  services: Record<string, { id: number; slug: string }>;
  products: Record<string, { id: number; name: string }>;
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

export const pullCommand = new Command('pull')
  .description('Download your business data as local files')
  .option('-d, --dir <directory>', 'Output directory', '.')
  .option('--pages-only', 'Only pull pages')
  .option('--kb-only', 'Only pull knowledge base')
  .option('--force', 'Overwrite existing files without prompting')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company_id set. Run `solid auth login` first.'));
      process.exit(1);
    }

    const baseDir = path.resolve(options.dir);

    // Check if directory has existing solid project
    const manifestPath = path.join(baseDir, '.solid', 'manifest.json');
    if (fs.existsSync(manifestPath) && !options.force) {
      const existing: PullManifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (existing.company_id !== companyId) {
        console.error(chalk.red(`This directory belongs to company ${existing.company_id} (${existing.company_name}).`));
        console.error(chalk.red(`You are logged in as company ${companyId}.`));
        console.error(chalk.dim('Use --force to overwrite, or switch to a different directory.'));
        process.exit(1);
      }
    }

    const manifest: PullManifest = {
      company_id: companyId,
      company_name: '',
      pulled_at: new Date().toISOString(),
      api_url: config.apiUrl,
      pages: {},
      kb: {},
      services: {},
      products: {},
    };

    let totalFiles = 0;

    // ── Company info + settings ──────────────────────────────────────
    const infoSpinner = ora('Pulling company info...').start();
    try {
      const infoRes = await apiClient.companyInfo();
      const company = (infoRes.data as any).company;
      manifest.company_name = company?.name || '';

      const configData = {
        name: company.name,
        slug: company.slug,
        industry: company.industry,
        tier: company.tier,
        phone: company.contact_phone,
        email: company.contact_email,
        address: company.location,
        hours: company.business_hours,
        website_settings: company.website_settings || {},
      };

      fs.writeFileSync(
        path.join(baseDir, 'solid.config.json'),
        JSON.stringify(configData, null, 2) + '\n'
      );
      totalFiles++;
      infoSpinner.succeed(chalk.green(`${company.name} — solid.config.json`));
    } catch (error) {
      infoSpinner.fail(chalk.red('Failed to pull company info'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }

    // ── Pages ────────────────────────────────────────────────────────
    if (!options.kbOnly) {
      const pagesSpinner = ora('Pulling pages...').start();
      try {
        const pagesRes = await apiClient.pagesList();
        const pages = (pagesRes.data as any).pages || [];

        if (pages.length > 0) {
          const pagesDir = path.join(baseDir, 'pages');
          ensureDir(pagesDir);

          for (const page of pages) {
            // Fetch full page with layout_json
            try {
              const fullPage = await apiClient.pageGet(page.id);
              const pageData = fullPage.data as any;

              const filename = `${pageData.slug || slugify(pageData.title)}.json`;
              const fileContent = {
                _id: pageData.id,
                title: pageData.title,
                slug: pageData.slug,
                page_type: pageData.page_type || 'website',
                is_published: pageData.is_published,
                is_landing_page: pageData.is_landing_page || false,
                meta_title: pageData.meta_title,
                meta_description: pageData.meta_description,
                layout_json: pageData.layout_json,
              };

              fs.writeFileSync(
                path.join(pagesDir, filename),
                JSON.stringify(fileContent, null, 2) + '\n'
              );

              manifest.pages[filename] = {
                id: pageData.id,
                slug: pageData.slug,
                updated_at: pageData.updated_at || new Date().toISOString(),
              };
              totalFiles++;
            } catch {
              // Skip pages that fail to load individually
            }
          }

          pagesSpinner.succeed(chalk.green(`${pages.length} pages → ./pages/`));
        } else {
          pagesSpinner.succeed(chalk.dim('No pages yet'));
        }
      } catch (error) {
        pagesSpinner.fail(chalk.red('Failed to pull pages'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }

    // ── Knowledge Base ───────────────────────────────────────────────
    if (!options.pagesOnly) {
      const kbSpinner = ora('Pulling knowledge base...').start();
      try {
        const kbRes = await apiClient.kbSearch('*', 100);
        const entries = (kbRes.data as any).results || [];

        if (entries.length > 0) {
          const kbDir = path.join(baseDir, 'kb');
          ensureDir(kbDir);

          for (const entry of entries) {
            const filename = `${slugify(entry.title || `entry-${entry.id}`)}.md`;

            // Write as markdown with YAML frontmatter
            const lines = [
              '---',
              `id: ${entry.id}`,
              `title: "${(entry.title || '').replace(/"/g, '\\"')}"`,
              `category: ${entry.category || 'general'}`,
              '---',
              '',
              entry.content || '',
              '',
            ];

            fs.writeFileSync(path.join(kbDir, filename), lines.join('\n'));

            manifest.kb[filename] = {
              id: entry.id,
              title: entry.title || '',
            };
            totalFiles++;
          }

          kbSpinner.succeed(chalk.green(`${entries.length} KB entries → ./kb/`));
        } else {
          kbSpinner.succeed(chalk.dim('No KB entries yet'));
        }
      } catch (error) {
        kbSpinner.fail(chalk.red('Failed to pull KB'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }

    // ── Services ─────────────────────────────────────────────────────
    if (!options.pagesOnly && !options.kbOnly) {
      const svcSpinner = ora('Pulling services...').start();
      try {
        const svcRes = await apiClient.servicesList();
        const items = (svcRes.data as any).items || [];

        if (items.length > 0) {
          const svcDir = path.join(baseDir, 'services');
          ensureDir(svcDir);

          for (const svc of items) {
            const filename = `${svc.slug || slugify(svc.title)}.json`;
            const fileContent = {
              _id: svc.id,
              title: svc.title,
              slug: svc.slug,
              subtitle: svc.subtitle,
              description: svc.description,
              category: svc.category,
              subcategory: svc.subcategory,
              price: svc.price,
              currency: svc.currency || 'USD',
              duration_minutes: svc.duration_minutes,
              requires_on_site: svc.requires_on_site,
            };

            fs.writeFileSync(
              path.join(svcDir, filename),
              JSON.stringify(fileContent, null, 2) + '\n'
            );

            manifest.services[filename] = {
              id: svc.id,
              slug: svc.slug,
            };
            totalFiles++;
          }

          svcSpinner.succeed(chalk.green(`${items.length} services → ./services/`));
        } else {
          svcSpinner.succeed(chalk.dim('No services yet'));
        }
      } catch (error) {
        svcSpinner.fail(chalk.red('Failed to pull services'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }

    // ── Products ─────────────────────────────────────────────────────
    if (!options.pagesOnly && !options.kbOnly) {
      const prodSpinner = ora('Pulling products...').start();
      try {
        const prodRes = await apiClient.productsList();
        const items = (prodRes.data as any).items || [];

        if (items.length > 0) {
          const prodDir = path.join(baseDir, 'products');
          ensureDir(prodDir);

          for (const prod of items) {
            const filename = `${slugify(prod.name)}.json`;
            const fileContent = {
              _id: prod.id,
              name: prod.name,
              description: prod.description,
              category: prod.category,
              product_type: prod.product_type,
              price: prod.price,
              image_url: prod.image_url,
              is_featured: prod.is_featured,
              in_stock: prod.in_stock,
              tags: prod.tags,
            };

            fs.writeFileSync(
              path.join(prodDir, filename),
              JSON.stringify(fileContent, null, 2) + '\n'
            );

            manifest.products[filename] = {
              id: prod.id,
              name: prod.name,
            };
            totalFiles++;
          }

          prodSpinner.succeed(chalk.green(`${items.length} products → ./products/`));
        } else {
          prodSpinner.succeed(chalk.dim('No products yet'));
        }
      } catch (error) {
        prodSpinner.fail(chalk.red('Failed to pull products'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }

    // ── Write manifest ───────────────────────────────────────────────
    ensureDir(path.join(baseDir, '.solid'));
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

    // ── Write .gitignore for .solid ──────────────────────────────────
    const gitignorePath = path.join(baseDir, '.gitignore');
    if (!fs.existsSync(gitignorePath)) {
      fs.writeFileSync(gitignorePath, '.solid/\nnode_modules/\n');
    }

    console.log('');
    console.log(ui.successBox(`Pulled ${totalFiles} files`, [
      `${chalk.dim('Company:')}   ${manifest.company_name}`,
      `${chalk.dim('ID:')}        ${companyId}`,
      `${chalk.dim('Directory:')} ${baseDir}`,
      '',
      `${chalk.dim('Next steps:')}`,
      `  ${chalk.cyan('1.')} Edit files with your editor`,
      `  ${chalk.cyan('2.')} ${chalk.cyan('solid push')} to deploy changes`,
      `  ${chalk.cyan('3.')} ${chalk.cyan('solid train chat')} to test your AI`,
    ]));
    console.log('');
  });
