/**
 * Work notes — cross-session, cross-model AI memory
 *
 * When Claude builds half a website and the user switches to Grok,
 * Grok calls `solid notes context` and picks up where Claude left off.
 *
 * All notes scoped to the authenticated company_id.
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

export const notesCommand = new Command('notes')
  .description('Work notes — cross-session, cross-model AI memory');

// ── Add ─────────────────────────────────────────────────────────────

notesCommand
  .command('add <content...>')
  .description('Add a work note')
  .option('-t, --type <type>', 'Note type: finding, plan, decision, preference, status, todo, context', 'context')
  .option('--title <title>', 'Short title')
  .option('--tag <tags...>', 'Tags for filtering')
  .option('--entity <type:id>', 'Related entity (e.g., page:42)')
  .option('--importance <n>', 'Importance 1-10', '5')
  .option('--pin', 'Pin this note (always surfaces first)')
  .option('--source <source>', 'Source identifier (claude, grok, gpt, human)', 'agent')
  .option('--json', 'Output as JSON')
  .action(async (contentParts: string[], opts: any) => {
    requireAuth();
    const content = contentParts.join(' ');
    const spinner = ora('Adding note...').start();
    try {
      const body: Record<string, any> = {
        content,
        note_type: opts.type,
        source: opts.source,
        importance: parseInt(opts.importance),
        is_pinned: !!opts.pin,
      };
      if (opts.title) body.title = opts.title;
      if (opts.tag) body.tags = opts.tag;
      if (opts.entity) {
        const [etype, eid] = opts.entity.split(':');
        body.related_entity_type = etype;
        body.related_entity_id = parseInt(eid);
      }
      const res = await apiClient.post('/api/v1/agent/notes/add', body);
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`Note #${data.note_id} added (${data.note_type})`));
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Search ──────────────────────────────────────────────────────────

notesCommand
  .command('search <query...>')
  .description('Semantic search across work notes')
  .option('-l, --limit <n>', 'Max results', '10')
  .option('--json', 'Output as JSON')
  .action(async (queryParts: string[], opts: any) => {
    requireAuth();
    const query = queryParts.join(' ');
    const spinner = ora('Searching notes...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/notes/search', { query, limit: parseInt(opts.limit) });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const results = data.results || [];
      spinner.succeed(chalk.green(`${results.length} result(s) via ${data.method}`));
      if (results.length === 0) { console.log(chalk.dim('  No matching notes.')); return; }
      console.log('');
      for (const n of results as Record<string, any>[]) {
        const pin = n.is_pinned ? chalk.yellow('📌 ') : '';
        const type = chalk.cyan(`[${n.note_type}]`);
        const imp = n.importance >= 7 ? chalk.yellow(`⭐${n.importance}`) : chalk.dim(`${n.importance}`);
        console.log(`  ${pin}#${n.id} ${type} ${imp} ${chalk.bold(n.title || n.content?.substring(0, 60))}`);
        if (n.content && n.content.length > 60) {
          console.log(chalk.dim(`    ${n.content.substring(0, 120)}...`));
        }
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── List ────────────────────────────────────────────────────────────

notesCommand
  .command('list')
  .alias('ls')
  .description('List work notes (pinned first, then by importance)')
  .option('-t, --type <type>', 'Filter by note type')
  .option('-l, --limit <n>', 'Max results', '30')
  .option('--json', 'Output as JSON')
  .action(async (opts: any) => {
    requireAuth();
    const spinner = ora('Loading notes...').start();
    try {
      const body: Record<string, any> = { limit: parseInt(opts.limit) };
      if (opts.type) body.note_type = opts.type;
      const res = await apiClient.post('/api/v1/agent/notes/list', body);
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      const notes = data.notes || [];
      spinner.succeed(chalk.green(`${notes.length} note(s)`));
      if (notes.length === 0) { console.log(chalk.dim('  No notes yet. Use `solid notes add` to create one.')); return; }
      console.log('');
      for (const n of notes as Record<string, any>[]) {
        const pin = n.is_pinned ? chalk.yellow('📌 ') : '';
        const type = chalk.cyan(`[${n.note_type}]`);
        const imp = n.importance >= 7 ? chalk.yellow(`⭐${n.importance}`) : chalk.dim(`${n.importance}`);
        const date = n.created_at ? chalk.dim(new Date(n.created_at).toLocaleDateString()) : '';
        console.log(`  ${pin}#${n.id} ${type} ${imp} ${chalk.bold(n.title || n.content?.substring(0, 50))}  ${date}`);
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Context (session bootstrapping) ─────────────────────────────────

notesCommand
  .command('context')
  .description('Get structured work context for a new session — call this FIRST')
  .option('-l, --limit <n>', 'Max notes per category', '20')
  .option('--json', 'Output as JSON')
  .action(async (opts: any) => {
    requireAuth();
    const spinner = ora('Loading work context...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/notes/context', { limit: parseInt(opts.limit) });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(data.summary || 'Work context loaded'));
      console.log('');

      const pinned = data.pinned || [];
      const high = data.high_importance || [];
      const recent = data.recent || [];

      if (pinned.length > 0) {
        console.log(chalk.yellow.bold('  📌 PINNED'));
        for (const n of pinned) {
          console.log(`    [${n.note_type}] ${n.title || n.content?.substring(0, 80)}`);
        }
        console.log('');
      }
      if (high.length > 0) {
        console.log(chalk.yellow.bold('  ⭐ HIGH IMPORTANCE'));
        for (const n of high) {
          console.log(`    [${n.note_type}] ${n.title || n.content?.substring(0, 80)}`);
        }
        console.log('');
      }
      if (recent.length > 0) {
        console.log(chalk.bold('  📝 RECENT'));
        for (const n of recent) {
          console.log(`    [${n.note_type}] ${n.title || n.content?.substring(0, 80)}`);
        }
        console.log('');
      }
      if (pinned.length === 0 && high.length === 0 && recent.length === 0) {
        console.log(chalk.dim('  No work context yet. Notes will appear here as you work.'));
      }
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

// ── Archive ─────────────────────────────────────────────────────────

notesCommand
  .command('archive <id>')
  .description('Archive a work note')
  .option('--json', 'Output as JSON')
  .action(async (id: string, opts: any) => {
    requireAuth();
    const spinner = ora('Archiving note...').start();
    try {
      const res = await apiClient.post('/api/v1/agent/notes/archive', { note_id: parseInt(id) });
      const data = res.data as Record<string, any>;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`Note #${id} archived`));
    } catch (error) { spinner.fail(chalk.red('Failed')); console.error(chalk.red(`  ${handleApiError(error).message}`)); }
  });

import { appendExamples as __ae_notes } from '../lib/command-kit';
__ae_notes(notesCommand, [
  { cmd: 'solid notes add "Hero section done, client prefers blue"',     why: 'Add a work note' },
  { cmd: 'solid notes add --type todo "Build services page next"',       why: 'Add a todo' },
  { cmd: 'solid notes add --type preference --pin "Blue theme only"',    why: 'Pin a preference' },
  { cmd: 'solid notes search "website design"',                          why: 'Semantic search' },
  { cmd: 'solid notes context',                                          why: 'Session bootstrapping — call FIRST' },
  { cmd: 'solid notes list --type todo',                                 why: 'List todos' },
]);
