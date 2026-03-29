/**
 * Open command for Solid CLI
 *
 * Opens the web dashboard for a specific page, site, or section.
 * Bridge between local CLI workflow and the web WYSIWYG builder.
 *
 * solid open home                     → Open page builder for "home" page
 * solid open home --preview           → Open public preview
 * solid open home --editor            → Open code editor view
 * solid open --dashboard              → Open CMS dashboard
 * solid open --sites                  → Open sites manager
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

// Cross-platform browser open
async function openBrowser(url: string): Promise<void> {
  const { exec } = await import('child_process');
  const platform = process.platform;
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open';
  exec(`${cmd} "${url}"`);
}

export const openCommand = new Command('open')
  .description('Open pages, sites, or dashboard in the web builder')
  .argument('[slug]', 'Page slug to open (e.g., "home", "pricing")')
  .option('--preview', 'Open the public preview URL')
  .option('--editor', 'Open the code editor (not drag-drop builder)')
  .option('--dashboard', 'Open the CMS dashboard')
  .option('--sites', 'Open sites manager')
  .option('--settings', 'Open CMS settings')
  .option('--analytics', 'Open CMS analytics')
  .action(async (slug, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const apiUrl = config.apiUrl;
    // Derive app URL from API URL
    const appUrl = apiUrl.replace('api.', 'app.').replace('/api/v1', '').replace(':8090', ':3000');

    // Dashboard shortcuts (no slug needed)
    if (options.dashboard) {
      const url = `${appUrl}/dashboard/cms`;
      console.log(chalk.dim(`Opening: ${url}`));
      await openBrowser(url);
      return;
    }
    if (options.sites) {
      const url = `${appUrl}/dashboard/cms/builder`;
      console.log(chalk.dim(`Opening: ${url}`));
      await openBrowser(url);
      return;
    }
    if (options.settings) {
      const url = `${appUrl}/dashboard/cms/settings`;
      console.log(chalk.dim(`Opening: ${url}`));
      await openBrowser(url);
      return;
    }
    if (options.analytics) {
      const url = `${appUrl}/dashboard/cms/analytics`;
      console.log(chalk.dim(`Opening: ${url}`));
      await openBrowser(url);
      return;
    }

    if (!slug) {
      console.error(chalk.red('Provide a page slug or use --dashboard, --sites, --settings, --analytics'));
      console.log(chalk.dim('  solid open home            Open page builder'));
      console.log(chalk.dim('  solid open home --preview   Open public preview'));
      console.log(chalk.dim('  solid open --dashboard      Open CMS dashboard'));
      process.exit(1);
    }

    // Find page ID from slug — check local manifest first, then API
    let pageId: number | null = null;

    // Try local manifest
    const manifestPath = path.join(process.cwd(), '.solid', 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
        const fileName = `${slug}.json`;
        if (manifest.pages?.[fileName]) {
          pageId = manifest.pages[fileName].id;
        }
      } catch { /* ignore */ }
    }

    // Fallback: search local pages/ directory
    if (!pageId) {
      const pagesDir = path.join(process.cwd(), 'pages');
      if (fs.existsSync(pagesDir)) {
        const pageFile = path.join(pagesDir, `${slug}.json`);
        if (fs.existsSync(pageFile)) {
          try {
            const page = JSON.parse(fs.readFileSync(pageFile, 'utf-8'));
            pageId = page._id || page.id;
          } catch { /* ignore */ }
        }
      }
    }

    // Fallback: query API by slug
    if (!pageId) {
      try {
        const response = await apiClient.pagesList();
        const pages = (response.data as any)?.pages || [];
        const match = pages.find((p: any) => p.slug === slug);
        if (match) {
          pageId = match.id;
        }
      } catch (error) {
        const err = handleApiError(error);
        console.error(chalk.red(`API error: ${err.message}`));
        process.exit(1);
      }
    }

    if (!pageId) {
      console.error(chalk.red(`Page "${slug}" not found. Run \`solid pages list\` to see available pages.`));
      process.exit(1);
    }

    // Build URL based on mode
    let url: string;
    if (options.preview) {
      // Public preview — tenant site
      url = `${appUrl.replace('app.', '')}/${slug}`;
    } else if (options.editor) {
      url = `${appUrl}/dashboard/cms/pages/edit/${pageId}`;
    } else {
      // Default: visual builder
      url = `${appUrl}/dashboard/cms/builder/${pageId}`;
    }

    console.log(chalk.green(`Opening ${options.preview ? 'preview' : options.editor ? 'editor' : 'builder'} for "${slug}"`));
    console.log(chalk.dim(url));
    await openBrowser(url);
  });
