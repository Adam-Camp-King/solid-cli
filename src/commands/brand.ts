/**
 * Brand Engine — brand identity management for Solid CLI
 *
 * View, create, update, export, and audit your brand identity.
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const brandCommand = new Command('brand')
  .description('Brand Engine — brand identity management');

// Get brand
brandCommand
  .command('get')
  .description('View your brand identity')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading brand...').start();
    try {
      const response = await apiClient.get('/api/v1/cli/brand');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      spinner.succeed('Brand loaded');
      console.log(ui.header(data.name || 'Brand Identity'));

      if (data.name) {
        console.log(ui.label('Name', data.name));
      }

      if (data.design) {
        console.log('');
        console.log(ui.divider('Design'));
        const design = data.design;
        if (design.primary_color) {
          console.log(ui.label('Primary', chalk.hex(design.primary_color)(`${design.primary_color} ██`)));
        }
        if (design.secondary_color) {
          console.log(ui.label('Secondary', chalk.hex(design.secondary_color)(`${design.secondary_color} ██`)));
        }
        if (design.font_heading) {
          console.log(ui.label('Heading Font', design.font_heading));
        }
        if (design.font_body) {
          console.log(ui.label('Body Font', design.font_body));
        }
      }

      if (data.voice) {
        console.log('');
        console.log(ui.divider('Voice'));
        const voice = data.voice;
        if (voice.tone) console.log(ui.label('Tone', voice.tone));
        if (voice.style) console.log(ui.label('Style', voice.style));
        if (voice.personality) console.log(ui.label('Personality', voice.personality));
      }

      if (data.rules && data.rules.length > 0) {
        console.log('');
        console.log(ui.divider('Rules'));
        for (const rule of data.rules) {
          console.log(chalk.dim(`  - ${rule}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load brand'));
      const apiError = handleApiError(error);
      if (apiError.status === 404) {
        console.log(chalk.dim('  No brand configured. Run `solid brand create` to get started.'));
      } else {
        console.error(chalk.red(`  ${apiError.message}`));
      }
    }
  });

// Create brand (interactive)
brandCommand
  .command('create')
  .description('Create your brand identity')
  .action(async () => {
    requireAuth();

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'name',
        message: 'Brand name:',
        validate: (input) => input.length > 0 || 'Brand name is required',
      },
      {
        type: 'input',
        name: 'primary_color',
        message: 'Primary color (hex, e.g. #4f46e5):',
        default: '#4f46e5',
        validate: (input) => /^#[0-9a-fA-F]{6}$/.test(input) || 'Must be a valid hex color (#RRGGBB)',
      },
      {
        type: 'input',
        name: 'secondary_color',
        message: 'Secondary color (hex):',
        default: '#818cf8',
        validate: (input) => /^#[0-9a-fA-F]{6}$/.test(input) || 'Must be a valid hex color (#RRGGBB)',
      },
      {
        type: 'list',
        name: 'tone',
        message: 'Brand voice tone:',
        choices: ['professional', 'friendly', 'casual', 'authoritative', 'playful', 'technical'],
      },
      {
        type: 'input',
        name: 'font_heading',
        message: 'Heading font (optional):',
        default: '',
      },
    ]);

    const spinner = ora('Creating brand...').start();
    try {
      const body: Record<string, unknown> = {
        name: answers.name,
        design: {
          primary_color: answers.primary_color,
          secondary_color: answers.secondary_color,
          ...(answers.font_heading ? { font_heading: answers.font_heading } : {}),
        },
        voice: {
          tone: answers.tone,
        },
      };

      const response = await apiClient.post('/api/v1/cli/brand', body);
      const data = response.data as Record<string, any>;

      spinner.succeed(chalk.green('Brand created'));
      console.log('');
      console.log(ui.successBox('Brand Identity', [
        `${chalk.bold('Name:')}  ${answers.name}`,
        `${chalk.bold('Primary:')}  ${chalk.hex(answers.primary_color)(`${answers.primary_color} ██`)}`,
        `${chalk.bold('Tone:')}  ${answers.tone}`,
      ]));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create brand'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Update brand
brandCommand
  .command('update')
  .description('Update brand identity')
  .option('--name <name>', 'Brand name')
  .option('--primary <color>', 'Primary color (hex)')
  .option('--secondary <color>', 'Secondary color (hex)')
  .option('--tone <tone>', 'Voice tone')
  .option('--font-heading <font>', 'Heading font')
  .option('--font-body <font>', 'Body font')
  .action(async (options) => {
    requireAuth();

    const body: Record<string, unknown> = {};

    if (options.name) body.name = options.name;

    const design: Record<string, string> = {};
    if (options.primary) design.primary_color = options.primary;
    if (options.secondary) design.secondary_color = options.secondary;
    if (options.fontHeading) design.font_heading = options.fontHeading;
    if (options.fontBody) design.font_body = options.fontBody;
    if (Object.keys(design).length > 0) body.design = design;

    const voice: Record<string, string> = {};
    if (options.tone) voice.tone = options.tone;
    if (Object.keys(voice).length > 0) body.voice = voice;

    if (Object.keys(body).length === 0) {
      console.error(chalk.red('No update fields provided. Use --name, --primary, --secondary, --tone, etc.'));
      process.exit(1);
    }

    const spinner = ora('Updating brand...').start();
    try {
      await apiClient.patch('/api/v1/cli/brand', body);
      spinner.succeed(chalk.green('Brand updated'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to update brand'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Set — white-label power command
brandCommand
  .command('set')
  .description('Set brand properties (white-label: logo, domain, email, colors)')
  .option('--logo <path>', 'Logo image path (uploads to CDN)')
  .option('--domain <domain>', 'Custom domain (e.g., joesplumbing.com)')
  .option('--colors <hex,hex>', 'Primary,secondary colors (e.g., "#1a1a2e,#e94560")')
  .option('--email-from <email>', 'Sender email for notifications')
  .option('--company-name <name>', 'Display name (overrides company name in UI)')
  .option('--favicon <path>', 'Favicon path')
  .action(async (options) => {
    requireAuth();

    const hasOpts = options.logo || options.domain || options.colors || options.emailFrom || options.companyName || options.favicon;
    if (!hasOpts) {
      console.error(chalk.red('No options provided.'));
      console.log(chalk.dim('  Usage: solid brand set --logo ./logo.png --domain example.com --colors "#1a1a2e,#e94560"'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const updates: string[] = [];

    // Handle domain
    if (options.domain) {
      const spinner = ora(`Configuring domain: ${options.domain}...`).start();
      try {
        await apiClient.post('/api/v1/domains/add', { domain: options.domain });
        spinner.succeed(chalk.green(`Domain: ${options.domain}`));
        updates.push('domain');
      } catch (error) {
        spinner.fail(chalk.red(`Domain failed: ${handleApiError(error).message}`));
      }
    }

    // Handle colors + name via brand update
    if (options.colors || options.companyName || options.emailFrom) {
      const spinner = ora('Updating brand...').start();
      try {
        const body: Record<string, unknown> = {};
        if (options.companyName) body.name = options.companyName;
        if (options.emailFrom) body.email_from = options.emailFrom;
        if (options.colors) {
          const [primary, secondary] = options.colors.split(',').map((c: string) => c.trim());
          body.design = {
            ...(primary ? { primary_color: primary } : {}),
            ...(secondary ? { secondary_color: secondary } : {}),
          };
        }
        await apiClient.patch('/api/v1/cli/brand', body);
        spinner.succeed(chalk.green('Brand updated'));
        if (options.colors) updates.push('colors');
        if (options.companyName) updates.push('name');
        if (options.emailFrom) updates.push('email');
      } catch (error) {
        spinner.fail(chalk.red(`Brand update failed: ${handleApiError(error).message}`));
      }
    }

    // Handle logo upload — REAL multipart now (T4). The path is a local
    // file; we stream its bytes to the backend, which stores via the
    // multi-tenant asset engine and returns a CDN URL.
    if (options.logo) {
      const spinner = ora(`Uploading logo: ${options.logo}...`).start();
      try {
        const fs = await import('fs');
        const path = await import('path');
        const FormData = (await import('form-data')).default;
        const localPath = path.resolve(options.logo);
        if (!fs.existsSync(localPath)) {
          spinner.fail(chalk.red(`File not found: ${localPath}`));
        } else {
          const form = new FormData();
          form.append('file', fs.createReadStream(localPath));
          const res = await apiClient.post('/api/v1/companies/me/logo', form);
          const r = res.data as Record<string, any>;
          spinner.succeed(chalk.green('Logo uploaded'));
          if (r.logo_url) console.log(chalk.dim(`    ${r.logo_url}`));
          updates.push('logo');
        }
      } catch (error) {
        spinner.fail(chalk.red(`Logo failed: ${handleApiError(error).message}`));
      }
    }

    // Handle favicon upload (T4 — same pipeline, smaller cap)
    if (options.favicon) {
      const spinner = ora(`Uploading favicon: ${options.favicon}...`).start();
      try {
        const fs = await import('fs');
        const path = await import('path');
        const FormData = (await import('form-data')).default;
        const localPath = path.resolve(options.favicon);
        if (!fs.existsSync(localPath)) {
          spinner.fail(chalk.red(`File not found: ${localPath}`));
        } else {
          const form = new FormData();
          form.append('file', fs.createReadStream(localPath));
          const res = await apiClient.post('/api/v1/companies/me/favicon', form);
          const r = res.data as Record<string, any>;
          spinner.succeed(chalk.green('Favicon uploaded'));
          if (r.favicon_url) console.log(chalk.dim(`    ${r.favicon_url}`));
          updates.push('favicon');
        }
      } catch (error) {
        spinner.fail(chalk.red(`Favicon failed: ${handleApiError(error).message}`));
      }
    }

    console.log('');
    if (updates.length > 0) {
      console.log(chalk.green(`  ✓ Updated: ${updates.join(', ')}`));
      console.log(chalk.dim('  Preview: solid brand get'));
    }
    console.log('');
  });

// Export brand
brandCommand
  .command('export')
  .description('Export brand tokens')
  .option('-f, --format <format>', 'Export format (css, tailwind, json)', 'json')
  .action(async (options) => {
    requireAuth();

    const spinner = ora(`Exporting brand as ${options.format}...`).start();
    try {
      const response = await apiClient.get('/api/v1/cli/brand/export', {
        params: { format: options.format },
      });
      const data = response.data as Record<string, any>;

      spinner.succeed(`Brand exported as ${options.format}`);
      console.log('');

      if (typeof data.output === 'string') {
        console.log(data.output);
      } else if (data.tokens || data.variables) {
        console.log(JSON.stringify(data.tokens || data.variables || data, null, 2));
      } else {
        console.log(JSON.stringify(data, null, 2));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to export brand'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Audit brand
brandCommand
  .command('audit')
  .description('Audit brand consistency across your site')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();

    const spinner = ora('Auditing brand consistency...').start();
    try {
      const response = await apiClient.get('/api/v1/cli/brand/audit');
      const data = response.data as Record<string, any>;

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const score = data.score || data.consistency_score;
      const scoreColor = score >= 90 ? chalk.green : score >= 70 ? chalk.yellow : chalk.red;

      spinner.succeed(`Audit complete — ${scoreColor(`${score}% consistent`)}`);
      console.log(ui.header('Brand Audit'));

      if (data.checks) {
        const headers = ['Check', 'Status', 'Details'];
        const rows = data.checks.map((c: any) => [
          c.name || c.check,
          c.passed ? chalk.green('pass') : chalk.red('fail'),
          c.message || c.details || '-',
        ]);
        console.log(ui.table(headers, rows));
      }

      if (data.issues && data.issues.length > 0) {
        console.log('');
        console.log(ui.divider('Issues'));
        for (const issue of data.issues) {
          const icon = issue.severity === 'high' ? chalk.red('!') : chalk.yellow('!');
          console.log(`  ${icon} ${issue.message || issue}`);
        }
      }

      if (data.recommendations && data.recommendations.length > 0) {
        console.log('');
        console.log(ui.divider('Recommendations'));
        for (const rec of data.recommendations) {
          console.log(chalk.dim(`  - ${rec}`));
        }
      }
    } catch (error) {
      spinner.fail(chalk.red('Audit failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
