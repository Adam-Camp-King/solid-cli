/**
 * solid render — A.1 of SPRINT-CLI-AGENT-CAN-SHIP.md
 *
 * Headless screenshot of any page on the tenant's site. Returns a
 * path the agent can attach to its reasoning. Closes the
 * "Claude can't see what it built" gap.
 *
 * Usage
 * -----
 *   solid render home                              # PNG at default desktop viewport
 *   solid render home --png --breakpoint mobile    # 375x667 viewport
 *   solid render home --png --breakpoint mobile,tablet,desktop --json
 *   solid render home --viewport 1280x720          # custom viewport
 *   solid render home --url https://acme.com       # explicit base URL
 *   solid render --install                         # download Chromium (~150MB once)
 *
 * Output paths default to `/tmp/solid-render/<slug>-<WxH>.png`. Override
 * with `--out <dir>`. JSON mode returns the full structured result.
 *
 * Exit codes
 * ----------
 *   0 — success
 *   1 — page 404, browser launch failed, output write failed
 *   2 — usage error (unknown breakpoint, malformed --viewport)
 */
import { Command } from 'commander';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import chalk from 'chalk';
import ora from 'ora';

import { isJsonOutput } from '../lib/json-output';
import {
  ensureChromium,
  findChromiumExecutable,
  uninstallCachedBrowsers,
} from '../lib/browser-install';
import {
  Viewport,
  buildRenderUrl,
  outputPath,
  parseViewport,
  resolveBreakpoints,
} from '../lib/render-utils';


// ---------------------------------------------------------------------------
// Command
// ---------------------------------------------------------------------------

export const renderCommand = new Command('render')
  .description('Screenshot any page (A.1 — visible-gap close for AI agents)')
  .argument('[slug]', "Page slug to render (e.g. 'home', 'about', 'pricing'). Omit with --install.")
  .option('--png', 'Emit PNG (default; explicit form)')
  .option('--breakpoint <names>', 'Comma-separated viewports: mobile, tablet, desktop, full', 'full')
  .option('--viewport <WxH>', 'Custom viewport, overrides --breakpoint (e.g. 1280x720)')
  .option('--url <baseUrl>', 'Override the base URL. Defaults to https://app.solidnumber.com.')
  .option('--out <dir>', 'Output directory', path.join(os.tmpdir(), 'solid-render'))
  .option('--full-page', 'Capture full scrollable page, not just viewport')
  .option('--wait <ms>', 'Wait this long after load before screenshot (helps with motion blocks)', '500')
  .option('--install', 'Download Chromium (~150MB once) into ~/.solid/chromium/. Skips render.')
  .option('--force', 'With --install: nuke the cached browser dir before downloading')
  .action(async (slug: string | undefined, opts: {
    png?: boolean;
    breakpoint?: string;
    viewport?: string;
    url?: string;
    out: string;
    fullPage?: boolean;
    wait?: string;
    install?: boolean;
    force?: boolean;
    json?: boolean;
  }) => {
    // --install: download Chromium, exit. No slug needed.
    if (opts.install) {
      if (opts.force) uninstallCachedBrowsers();
      const spinner = ora({ text: 'Downloading Chromium…', stream: process.stderr }).start();
      try {
        const result = await ensureChromium((dl, total) => {
          if (total > 0) {
            const pct = Math.round((dl / total) * 100);
            spinner.text = `Downloading Chromium… ${pct}% (${(dl / 1e6).toFixed(1)}MB / ${(total / 1e6).toFixed(1)}MB)`;
          }
        });
        spinner.succeed(
          result.downloaded
            ? chalk.green(`Chromium installed at ${result.executablePath}`)
            : chalk.green(`Chromium already available at ${result.executablePath}`),
        );
      } catch (err) {
        spinner.fail(chalk.red(`Install failed: ${(err as Error).message}`));
        process.exit(1);
      }
      return;
    }

    // From here on we need a slug.
    if (!slug) {
      console.error(chalk.red('Missing required <slug> argument. Try: solid render home'));
      console.error(chalk.dim('  Or: solid render --install   # one-time browser download'));
      process.exit(2);
    }

    // Resolve viewports — --viewport wins over --breakpoint.
    let viewports: Viewport[];
    try {
      if (opts.viewport) {
        viewports = [parseViewport(opts.viewport)];
      } else {
        viewports = resolveBreakpoints(opts.breakpoint);
      }
    } catch (err) {
      console.error(chalk.red((err as Error).message));
      process.exit(2);
    }

    // Make sure we have a browser. If not installed AND non-interactive,
    // surface an actionable error rather than hanging on a prompt that
    // never gets answered.
    let executablePath: string | null = await findChromiumExecutable();
    if (!executablePath) {
      const auto = process.env.SOLID_AUTO_INSTALL && /^(1|true|yes|on)$/i.test(process.env.SOLID_AUTO_INSTALL);
      const interactive = process.stdout.isTTY && process.stdin.isTTY;
      if (!auto && !interactive) {
        const msg = 'Chromium not installed. Run `solid render --install` (one-time, ~150MB).';
        if (isJsonOutput(opts)) {
          process.stdout.write(JSON.stringify({ ok: false, error: 'NO_BROWSER', message: msg }, null, 2) + '\n');
        } else {
          console.error(chalk.red(msg));
          console.error(chalk.dim('  Or set SOLID_AUTO_INSTALL=1 to download on first use.'));
        }
        process.exit(1);
      }
      const spinner = ora({ text: 'First-time setup — downloading Chromium…', stream: process.stderr }).start();
      try {
        const result = await ensureChromium((dl, total) => {
          if (total > 0) {
            const pct = Math.round((dl / total) * 100);
            spinner.text = `Downloading Chromium… ${pct}%`;
          }
        });
        executablePath = result.executablePath;
        spinner.succeed('Chromium ready.');
      } catch (err) {
        spinner.fail(chalk.red(`Install failed: ${(err as Error).message}`));
        process.exit(1);
      }
    }

    // Lazy-import puppeteer-core only after we know the browser is here.
    // This keeps the cold-start of every other CLI command unaffected
    // by puppeteer's load time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const puppeteer = require('puppeteer-core');

    const baseUrl = opts.url || process.env.SOLID_RENDER_BASE || 'https://app.solidnumber.com';
    const fullUrl = buildRenderUrl(baseUrl, slug);
    const waitMs = parseInt(opts.wait ?? '500', 10) || 500;

    fs.mkdirSync(opts.out, { recursive: true });

    const renders: Array<{ viewport: string; path: string; url: string }> = [];
    const spinner = ora({ text: `Rendering ${fullUrl}…`, stream: process.stderr }).start();
    let browser;
    try {
      browser = await puppeteer.launch({
        executablePath,
        headless: true,
        // Sandbox flags so this works in CI / Docker / agent runtimes
        // without the user needing to know about them.
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      for (const vp of viewports) {
        spinner.text = `Rendering ${vp.name}…`;
        const page = await browser.newPage();
        await page.setViewport({ width: vp.width, height: vp.height });
        const response = await page.goto(fullUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        if (response && response.status() === 404) {
          await page.close();
          throw new Error(`Page not found: ${fullUrl}`);
        }
        if (waitMs > 0) await new Promise((r) => setTimeout(r, waitMs));
        const out = outputPath(opts.out, slug, vp);
        await page.screenshot({ path: out, fullPage: Boolean(opts.fullPage) });
        await page.close();
        renders.push({ viewport: vp.name, path: out, url: fullUrl });
      }
      spinner.succeed(chalk.green(`Rendered ${renders.length} screenshot${renders.length === 1 ? '' : 's'}`));
    } catch (err) {
      spinner.fail(chalk.red(`Render failed: ${(err as Error).message}`));
      try { if (browser) await browser.close(); } catch { /* swallow */ }
      if (isJsonOutput(opts)) {
        process.stdout.write(JSON.stringify({ ok: false, error: (err as Error).message }, null, 2) + '\n');
      }
      process.exit(1);
    } finally {
      try { if (browser) await browser.close(); } catch { /* swallow */ }
    }

    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify({ ok: true, slug, base_url: baseUrl, renders }, null, 2) + '\n');
      return;
    }
    for (const r of renders) {
      console.log(chalk.dim(`  ${r.viewport.padEnd(10)}`) + ' ' + chalk.cyan(r.path));
    }
  });

renderCommand.addHelpText('after', `
Examples:
  $ solid render home                        # full HD screenshot
  $ solid render home --breakpoint mobile    # 375x667 mobile viewport
  $ solid render home --breakpoint mobile,tablet,desktop --json
  $ solid render about --viewport 1280x720
  $ solid render --install                   # one-time browser setup

The first run downloads Chromium (~150MB) into ~/.solid/chromium/.
Subsequent runs are instant. Set SOLID_AUTO_INSTALL=1 in CI / agent
environments to bypass the install prompt.
`);
