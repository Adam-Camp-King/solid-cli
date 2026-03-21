/**
 * ================================================================================
 * solid design — Google Stitch Design Integration
 * ================================================================================
 *
 * Optional design layer powered by Google Stitch AI.
 * Generates UI designs from text prompts and converts them to
 * Solid# layout_json blocks — the same format used by Alex, Visual Builder,
 * and all CMS pages.
 *
 * This is a LAYER — if Stitch is unavailable, all other CMS tools work normally.
 *
 * Usage:
 *   solid design generate "modern plumbing homepage"    # Generate from prompt
 *   solid design import --file design.html              # Import HTML file
 *   solid design import --stdin                         # Import HTML from stdin
 *   solid design status                                 # Check Stitch availability
 *   solid design pull --project <id> --screen <id>      # Pull screen from Stitch
 * ================================================================================
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';

// ── API helpers ────────────────────────────────────────────────────

function getApiBase(): string {
  return process.env.SOLID_API_URL || 'https://api.solidnumber.com';
}

function getToken(): string | null {
  const configDir = path.join(
    process.env.HOME || process.env.USERPROFILE || '.',
    '.solid'
  );
  const tokenFile = path.join(configDir, 'token');
  if (fs.existsSync(tokenFile)) {
    return fs.readFileSync(tokenFile, 'utf-8').trim();
  }
  return null;
}

async function apiCall(
  method: string,
  endpoint: string,
  body?: any
): Promise<any> {
  const axios = (await import('axios')).default;
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const url = `${getApiBase()}/api/v1${endpoint}`;
  const response = await axios({
    method,
    url,
    data: body,
    headers,
    timeout: 60000,
  });
  return response.data;
}

// ── Commands ───────────────────────────────────────────────────────

export const designCommand = new Command('design')
  .description('Design with Stitch AI — generate UI from text prompts')
  .addHelpText(
    'after',
    `
${chalk.dim('  This is an optional layer powered by Google Stitch AI.')}
${chalk.dim('  If Stitch is not configured, all other CMS tools work normally.')}

${chalk.bold('Examples:')}
  ${chalk.cyan('solid design status')}                       Check if Stitch is available
  ${chalk.cyan('solid design generate "plumbing homepage"')} Generate design from prompt
  ${chalk.cyan('solid design import --file page.html')}      Import HTML to layout_json
  ${chalk.cyan('solid design pull --project abc --screen x')} Pull from Stitch project
`
  );

// ── solid design status ────────────────────────────────────────────

designCommand
  .command('status')
  .description('Check Stitch integration status')
  .action(async () => {
    const spinner = ora('Checking Stitch status...').start();
    try {
      const data = await apiCall('GET', '/stitch/status');
      spinner.stop();

      console.log('');
      console.log(chalk.bold('  Stitch Design Layer'));
      console.log(chalk.dim('  ─────────────────────'));
      console.log(
        `  Enabled:     ${data.enabled ? chalk.green('Yes') : chalk.red('No')}`
      );
      console.log(
        `  API Key:     ${data.api_configured ? chalk.green('Configured') : chalk.yellow('Not set')}`
      );
      if (data.connected !== undefined) {
        console.log(
          `  Connected:   ${data.connected ? chalk.green('Yes') : chalk.red('No')}`
        );
      }
      if (data.project_count !== undefined) {
        console.log(`  Projects:    ${chalk.cyan(data.project_count)}`);
      }
      if (data.error) {
        console.log(`  Error:       ${chalk.red(data.error)}`);
      }
      console.log('');

      if (!data.enabled) {
        console.log(
          chalk.dim(
            '  Set STITCH_API_KEY in your environment to enable Stitch design.'
          )
        );
        console.log(
          chalk.dim('  Get your key at: https://stitch.withgoogle.com')
        );
        console.log('');
      }
    } catch (err: any) {
      spinner.fail('Could not check Stitch status');
      if (err.response?.status === 401) {
        console.log(chalk.yellow('\n  Run `solid auth login` first.\n'));
      } else {
        console.log(chalk.red(`\n  ${err.message}\n`));
      }
    }
  });

// ── solid design generate ──────────────────────────────────────────

designCommand
  .command('generate')
  .description('Generate a page design from a text prompt')
  .argument('<prompt...>', 'Design description')
  .option('-d, --device <type>', 'Device type: DESKTOP, MOBILE, TABLET', 'DESKTOP')
  .option('-p, --project <id>', 'Stitch project ID', 'default')
  .option('-o, --output <file>', 'Save layout_json to file')
  .option('--page-id <id>', 'Apply to existing page ID')
  .action(async (promptParts: string[], options: any) => {
    const prompt = promptParts.join(' ');
    const spinner = ora(`Generating design: "${prompt.substring(0, 60)}..."`).start();

    try {
      const data = await apiCall('POST', '/stitch/generate', {
        project_id: options.project,
        prompt,
        device_type: options.device.toUpperCase(),
        page_id: options.pageId ? parseInt(options.pageId) : undefined,
      });

      spinner.succeed(
        `Generated ${chalk.cyan(data.sections.length)} sections`
      );

      // Display sections summary
      console.log('');
      for (const section of data.sections) {
        const label = section.type.replace(/_/g, ' ').replace(/-/g, ' ');
        console.log(
          `  ${chalk.blue('■')} ${chalk.bold(label.padEnd(20))} ${chalk.dim(section.title || '')}`
        );
      }
      console.log('');

      if (data.screen_id) {
        console.log(
          chalk.dim(`  Screen ID: ${data.screen_id}`)
        );
      }

      // Save to file if requested
      if (options.output) {
        const output = JSON.stringify(
          { sections: data.sections },
          null,
          2
        );
        fs.writeFileSync(options.output, output, 'utf-8');
        console.log(
          chalk.green(`  Saved to ${options.output}`)
        );
      }
      console.log('');
    } catch (err: any) {
      spinner.fail('Design generation failed');
      if (err.response?.status === 503) {
        console.log(
          chalk.yellow(
            '\n  Stitch is not configured. Run `solid design status` for details.\n'
          )
        );
      } else {
        console.log(chalk.red(`\n  ${err.response?.data?.detail || err.message}\n`));
      }
    }
  });

// ── solid design import ────────────────────────────────────────────

designCommand
  .command('import')
  .description('Import HTML and convert to layout_json blocks')
  .option('-f, --file <path>', 'HTML file to import')
  .option('--stdin', 'Read HTML from stdin')
  .option('-o, --output <file>', 'Save layout_json to file')
  .action(async (options: any) => {
    let html = '';

    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.log(chalk.red(`\n  File not found: ${filePath}\n`));
        process.exit(1);
      }
      html = fs.readFileSync(filePath, 'utf-8');
    } else if (options.stdin) {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      html = Buffer.concat(chunks).toString('utf-8');
    } else {
      console.log(
        chalk.yellow('\n  Specify --file <path> or --stdin\n')
      );
      process.exit(1);
    }

    const spinner = ora(
      `Importing HTML (${(html.length / 1024).toFixed(1)} KB)...`
    ).start();

    try {
      const data = await apiCall('POST', '/stitch/import-html', { html });
      spinner.succeed(
        `Converted to ${chalk.cyan(data.sections.length)} sections`
      );

      // Display sections summary
      console.log('');
      for (const section of data.sections) {
        const label = section.type.replace(/_/g, ' ').replace(/-/g, ' ');
        console.log(
          `  ${chalk.blue('■')} ${chalk.bold(label.padEnd(20))} ${chalk.dim(section.title || '')}`
        );
      }
      console.log('');

      // Save to file if requested
      if (options.output) {
        const output = JSON.stringify(
          { sections: data.sections },
          null,
          2
        );
        fs.writeFileSync(options.output, output, 'utf-8');
        console.log(
          chalk.green(`  Saved to ${options.output}`)
        );
      }
      console.log('');
    } catch (err: any) {
      spinner.fail('HTML import failed');
      console.log(chalk.red(`\n  ${err.response?.data?.detail || err.message}\n`));
    }
  });

// ── solid design pull ──────────────────────────────────────────────

designCommand
  .command('pull')
  .description('Pull a screen from a Stitch project')
  .requiredOption('-p, --project <id>', 'Stitch project ID')
  .requiredOption('-s, --screen <id>', 'Stitch screen ID')
  .option('-o, --output <file>', 'Save layout_json to file')
  .action(async (options: any) => {
    const spinner = ora(
      `Pulling screen ${options.screen} from project ${options.project}...`
    ).start();

    try {
      // Use the generate endpoint with the screen's current state
      // (effectively a re-import of an existing screen)
      const data = await apiCall('POST', '/stitch/edit', {
        project_id: options.project,
        screen_id: options.screen,
        prompt: 'Return the current design as-is',
      });

      spinner.succeed(
        `Pulled ${chalk.cyan(data.sections.length)} sections`
      );

      // Display sections summary
      console.log('');
      for (const section of data.sections) {
        const label = section.type.replace(/_/g, ' ').replace(/-/g, ' ');
        console.log(
          `  ${chalk.blue('■')} ${chalk.bold(label.padEnd(20))} ${chalk.dim(section.title || '')}`
        );
      }
      console.log('');

      // Save to file if requested
      if (options.output) {
        const output = JSON.stringify(
          { sections: data.sections },
          null,
          2
        );
        fs.writeFileSync(options.output, output, 'utf-8');
        console.log(chalk.green(`  Saved to ${options.output}`));
      }
      console.log('');
    } catch (err: any) {
      spinner.fail('Pull failed');
      if (err.response?.status === 503) {
        console.log(
          chalk.yellow(
            '\n  Stitch is not configured. Run `solid design status` for details.\n'
          )
        );
      } else {
        console.log(chalk.red(`\n  ${err.response?.data?.detail || err.message}\n`));
      }
    }
  });
