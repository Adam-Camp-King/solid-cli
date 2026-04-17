/**
 * Forms / surveys commands.
 * Wraps controllers/surveys.py.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const formsCommand = new Command('forms')
  .alias('surveys')
  .description('Forms & surveys — CRUD, AI generate, export CSV/Excel/PDF');

formsCommand
  .command('list')
  .description('List forms/surveys')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get('/api/v1/surveys');
      const data = res.data as Record<string, any>;
      const items = data.surveys || data.items || data;
      const list = Array.isArray(items) ? items : (items.surveys || []);
      if (opts.json) { s.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      s.succeed(chalk.green(`${list.length} form(s)`));
      for (const f of list as Record<string, any>[]) {
        console.log(`  ${chalk.bold(f.id)}  ${f.title || f.name}  ${chalk.dim(f.created_at?.split('T')[0] || '')}`);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('get <id>')
  .description('Get a form/survey')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora(`Loading ${id}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Form ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('create')
  .description('Create a form (JSON file or basic title)')
  .option('--file <path>', 'JSON file with form definition')
  .option('--title <title>', 'Simple title-only form')
  .action(async (opts) => {
    requireAuth();
    const body = opts.file
      ? JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'))
      : opts.title ? { title: opts.title } : null;
    if (!body) { console.error(chalk.red('Provide --file or --title')); process.exit(1); }
    const s = ora('Creating form...').start();
    try {
      const res = await apiClient.post('/api/v1/surveys/create', body);
      s.succeed(chalk.green(`Form created: ${(res.data as any).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('update <id>')
  .description('Update a form')
  .requiredOption('--file <path>', 'JSON file with update')
  .action(async (id, opts) => {
    requireAuth();
    const body = JSON.parse((await import('fs')).readFileSync(opts.file, 'utf-8'));
    const s = ora('Updating...').start();
    try {
      await apiClient.put(`/api/v1/surveys/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('delete <id>')
  .description('Delete a form')
  .action(async (id) => {
    requireAuth();
    const s = ora('Deleting...').start();
    try {
      await apiClient.delete(`/api/v1/surveys/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('generate <prompt>')
  .description('Generate a form from an AI prompt')
  .action(async (prompt) => {
    requireAuth();
    const s = ora('Generating form...').start();
    try {
      const res = await apiClient.post('/api/v1/surveys/generate', { prompt });
      s.succeed(chalk.green(`Form generated: ${(res.data as any).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('optimize <id>')
  .description('AI-optimize an existing form (shorter, better copy)')
  .action(async (id) => {
    requireAuth();
    const s = ora('Optimizing...').start();
    try {
      await apiClient.post(`/api/v1/surveys/${id}/optimize`);
      s.succeed(chalk.green('Optimized'));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('analyze <id>')
  .description('AI analyze submissions for insights')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Analyzing...').start();
    try {
      const res = await apiClient.post(`/api/v1/surveys/${id}/analyze`);
      if (opts.json) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green('Analysis'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('followup <id>')
  .description('Generate AI follow-up messages for responses')
  .action(async (id) => {
    requireAuth();
    const s = ora('Generating follow-ups...').start();
    try {
      const res = await apiClient.post(`/api/v1/surveys/${id}/followup`);
      s.succeed(chalk.green('Follow-ups generated'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('embed <id>')
  .description('Get embed code / public link for a form')
  .action(async (id) => {
    requireAuth();
    const s = ora('Loading embed...').start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}/embed`);
      s.succeed(chalk.green('Embed'));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

formsCommand
  .command('export <id>')
  .description('Export submissions (csv, excel, pdf)')
  .option('-f, --format <fmt>', 'csv | excel | pdf', 'csv')
  .option('-o, --output <path>', 'Write to file (default: stdout)')
  .action(async (id, opts) => {
    requireAuth();
    const fmt = String(opts.format).toLowerCase();
    if (!['csv', 'excel', 'pdf'].includes(fmt)) {
      console.error(chalk.red('--format must be csv, excel, or pdf'));
      process.exit(1);
    }
    const s = ora(`Exporting ${fmt}...`).start();
    try {
      const res = await apiClient.get(`/api/v1/surveys/${id}/export/${fmt}`);
      const body = typeof res.data === 'string' ? res.data : JSON.stringify(res.data);
      if (opts.output) {
        (await import('fs')).writeFileSync(opts.output, body);
        s.succeed(chalk.green(`Saved to ${opts.output}`));
      } else {
        s.stop();
        process.stdout.write(body);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });
