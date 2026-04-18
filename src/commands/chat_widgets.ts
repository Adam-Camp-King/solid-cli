/**
 * Chat widgets — CRUD + embed code.
 * Wraps controllers/chat_widgets.py at /api/v1/cms/chat-widgets/*.
 *
 * NOTE: distinct from `solid widgets` which hits the internal `/api/v1/cli/widgets`
 * surface. This command targets the public-facing chat widget model.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}
function fail(s: ReturnType<typeof ora>, m: string, e: unknown) { s.fail(chalk.red(m)); console.error(chalk.red(`  ${handleApiError(e).message}`)); }

export const chatWidgetsCommand = new Command('chat-widgets')
  .description('Chat widgets for external sites (CRUD + embed code)');

chatWidgetsCommand
  .command('list')
  .description('List chat widgets')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const s = ora('Loading widgets...').start();
    try {
      const res = await apiClient.get('/api/v1/cms/chat-widgets');
      const data = res.data as Record<string, any>;
      const items = data.widgets || data.items || data;
      const list = Array.isArray(items) ? items : (items.widgets || []);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      s.succeed(chalk.green(`${list.length} widget(s)`));
      for (const w of list as Record<string, any>[]) {
        console.log(`  ${chalk.bold(w.id)}  ${w.name || w.title || '—'}  ${chalk.dim(w.chat_id || '')}`);
      }
    } catch (e) { fail(s, 'Failed', e); }
  });

chatWidgetsCommand
  .command('get <id>')
  .description('Get a widget')
  .option('--json', 'Output as JSON')
  .action(async (id, opts) => {
    requireAuth();
    const s = ora('Loading...').start();
    try {
      const res = await apiClient.get(`/api/v1/cms/chat-widgets/${id}`);
      if (isJsonOutput(opts)) { s.stop(); console.log(JSON.stringify(res.data, null, 2)); return; }
      s.succeed(chalk.green(`Widget ${id}`));
      console.log(JSON.stringify(res.data, null, 2));
    } catch (e) { fail(s, 'Failed', e); }
  });

chatWidgetsCommand
  .command('create')
  .description('Create a chat widget')
  .requiredOption('--name <name>', 'Widget name')
  .option('--agent <type>', 'Agent to back the widget (e.g. sarah)')
  .option('--greeting <text>', 'Greeting message')
  .action(async (opts) => {
    requireAuth();
    const body: Record<string, unknown> = { name: opts.name };
    if (opts.agent) body.agent_type = opts.agent;
    if (opts.greeting) body.greeting = opts.greeting;
    const s = ora('Creating widget...').start();
    try {
      const res = await apiClient.post('/api/v1/cms/chat-widgets', body);
      s.succeed(chalk.green(`Widget created: ${(res.data as any).id}`));
    } catch (e) { fail(s, 'Failed', e); }
  });

chatWidgetsCommand
  .command('update <id>')
  .description('Update a widget')
  .option('--name <name>')
  .option('--greeting <text>')
  .option('--active <bool>', 'true|false')
  .action(async (id, opts) => {
    requireAuth();
    const body: Record<string, unknown> = {};
    if (opts.name) body.name = opts.name;
    if (opts.greeting) body.greeting = opts.greeting;
    if (opts.active !== undefined) body.is_active = opts.active === 'true';
    if (Object.keys(body).length === 0) { console.error(chalk.red('Nothing to update')); process.exit(1); }
    const s = ora('Updating...').start();
    try {
      await apiClient.patch(`/api/v1/cms/chat-widgets/${id}`, body);
      s.succeed(chalk.green('Updated'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chatWidgetsCommand
  .command('delete <id>')
  .description('Delete a widget (prompts by default)')
  .option('-y, --yes', 'Skip confirmation prompt')
  .action(async (id: string, opts: { yes?: boolean }) => {
    requireAuth();
    const { confirm } = await import('../lib/command-kit');
    const ok = await confirm(`Delete chat widget ${id}?`, { autoConfirm: Boolean(opts.yes) });
    if (!ok) { console.error(chalk.dim('  Cancelled.')); process.exit(1); }
    const s = ora({ text: 'Deleting...', stream: process.stderr }).start();
    try {
      await apiClient.delete(`/api/v1/cms/chat-widgets/${id}`);
      s.succeed(chalk.green('Deleted'));
    } catch (e) { fail(s, 'Failed', e); }
  });

chatWidgetsCommand
  .command('embed <id>')
  .description('Get the JS snippet to embed this widget in an external site')
  .action(async (id) => {
    requireAuth();
    const s = ora('Loading embed code...').start();
    try {
      const res = await apiClient.get(`/api/v1/cms/chat-widgets/${id}/embed`);
      s.succeed(chalk.green('Embed code'));
      const r = res.data as Record<string, any>;
      if (r.embed_code) {
        console.log('');
        console.log(r.embed_code);
      } else {
        console.log(JSON.stringify(r, null, 2));
      }
    } catch (e) { fail(s, 'Failed', e); }
  });
