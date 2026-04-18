/**
 * ================================================================================
 * solid visual — Open the Visual Canvas in the browser
 * ================================================================================
 *
 * Convenience command that opens /dashboard/cms/visual directly. Pair with
 * `solid login` (session) so the browser lands authenticated and the canvas
 * auto-selects the user's pages.
 *
 * Usage:
 *   solid visual                         # open the workspace
 *   solid visual --page 123              # deep-link to a specific page
 *   solid visual --host app.solidnumber.com  # override target host
 * ================================================================================
 */

import { exec } from 'child_process';

import chalk from 'chalk';
import { Command } from 'commander';

function getWebBase(host?: string): string {
  if (host) {
    return host.startsWith('http') ? host : `https://${host}`;
  }
  // Prefer SOLID_WEB_URL, fall back to SOLID_API_URL with api. stripped,
  // fall back to prod. Local dev users: SOLID_WEB_URL=http://localhost:3000
  const env =
    process.env.SOLID_WEB_URL ||
    (process.env.SOLID_API_URL ? process.env.SOLID_API_URL.replace('//api.', '//app.') : '');
  return env || 'https://app.solidnumber.com';
}

function openInBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === 'darwin' ? 'open' : platform === 'win32' ? 'start ""' : 'xdg-open';
  exec(`${cmd} "${url}"`, (err) => {
    if (err) {
      console.log(chalk.yellow(`\n  Couldn't open automatically. Open this URL manually:`));
      console.log(`  ${chalk.cyan(url)}\n`);
    }
  });
}

export const visualCommand = new Command('visual')
  .description('Open the Visual Canvas (Figma/Stitch-style page designer) in the browser')
  .option('-p, --page <id>', 'Deep-link to a specific page id')
  .option('--host <host>', 'Override target host (e.g. localhost:3000)')
  .option('--print', 'Print the URL instead of opening the browser')
  .addHelpText(
    'after',
    `
${chalk.dim('  The canvas lives at /dashboard/cms/visual and requires an authenticated session.')}
${chalk.dim('  Run `solid login` first, or use your browser login to Solid#.')}

${chalk.bold('Examples:')}
  ${chalk.cyan('solid visual')}                           Open the workspace
  ${chalk.cyan('solid visual --page 42')}                 Open and select page 42
  ${chalk.cyan('solid visual --host localhost:3000')}     Point at local dev
  ${chalk.cyan('solid visual --print')}                   Print the URL (for piping)
`,
  )
  .action((options: { page?: string; host?: string; print?: boolean }) => {
    const base = getWebBase(options.host);
    const params = options.page ? `?pageId=${encodeURIComponent(options.page)}` : '';
    const url = `${base.replace(/\/$/, '')}/dashboard/cms/visual${params}`;

    if (options.print) {
      console.log(url);
      return;
    }

    console.log('');
    console.log(`  ${chalk.bold('Opening Visual Canvas')}`);
    console.log(`  ${chalk.dim('─────────────────────')}`);
    console.log(`  ${chalk.cyan(url)}`);
    console.log('');
    openInBrowser(url);
  });
