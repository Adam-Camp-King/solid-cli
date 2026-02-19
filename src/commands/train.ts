/**
 * Train command for Solid CLI
 *
 * Train your company's AI agents by:
 *   - Adding KB entries from local files
 *   - Bulk importing KB from a directory
 *   - Chatting with agents to refine their behavior
 *   - Setting agent personality + context
 *
 * The developer trains via CLI (structured data, bulk import).
 * The business owner trains via Vibe (natural language).
 * Both feed the same KB → same agents → compound intelligence.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

function parseKbMarkdown(content: string): { title: string; category: string; content: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { title: 'Untitled', category: 'general', content: content.trim() };
  }

  const frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();

  let title = 'Untitled';
  let category = 'general';

  for (const line of frontmatter.split('\n')) {
    const [key, ...valueParts] = line.split(':');
    const value = valueParts.join(':').trim();
    if (key.trim() === 'title') title = value.replace(/^["']|["']$/g, '');
    if (key.trim() === 'category') category = value;
  }

  return { title, category, content: body };
}

export const trainCommand = new Command('train')
  .description('Train your AI agents with knowledge and context');

// ── Bulk import KB from directory ────────────────────────────────────
trainCommand
  .command('import <directory>')
  .description('Bulk import .md files as KB entries')
  .option('--category <category>', 'Override category for all entries')
  .option('--dry-run', 'Show what would be imported')
  .action(async (directory, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const dir = path.resolve(directory);
    if (!fs.existsSync(dir)) {
      console.error(chalk.red(`Directory not found: ${dir}`));
      process.exit(1);
    }

    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
    if (files.length === 0) {
      console.log(chalk.yellow('No .md files found in directory.'));
      return;
    }

    console.log(chalk.bold(`\n  Found ${files.length} markdown files:\n`));

    const entries: { file: string; title: string; category: string; content: string }[] = [];

    for (const file of files) {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const parsed = parseKbMarkdown(raw);
      if (options.category) parsed.category = options.category;

      entries.push({ file, ...parsed });
      const preview = parsed.content.substring(0, 50).replace(/\n/g, ' ');
      console.log(`    ${chalk.green('+')} ${parsed.title} ${chalk.dim(`[${parsed.category}]`)}`);
      console.log(chalk.dim(`      ${preview}...`));
    }

    if (options.dryRun) {
      console.log(chalk.dim('\n  Dry run — no changes made.\n'));
      return;
    }

    console.log('');
    const spinner = ora(`Importing ${entries.length} KB entries...`).start();
    let created = 0;
    let errors = 0;

    for (const entry of entries) {
      try {
        await apiClient.kbCreate({
          title: entry.title,
          content: entry.content,
          category: entry.category,
        });
        created++;
        spinner.text = `Importing KB entries... ${created}/${entries.length}`;
      } catch (error) {
        errors++;
        const apiError = handleApiError(error);
        spinner.stop();
        console.error(chalk.red(`    Failed: ${entry.file} — ${apiError.message}`));
        spinner.start();
      }
    }

    if (errors === 0) {
      spinner.succeed(chalk.green(`${created} KB entries imported`));
    } else {
      spinner.warn(chalk.yellow(`${created} imported, ${errors} failed`));
    }

    console.log(chalk.dim('  Your AI agents now have this knowledge.\n'));
  });

// ── Chat with an agent (interactive training) ───────────────────────
trainCommand
  .command('chat [agent]')
  .description('Chat with an AI agent to test and refine its knowledge')
  .action(async (agentName = 'sarah') => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    console.log('');
    console.log(chalk.bold(`  Chatting with ${chalk.cyan(agentName)} (your AI agent)`));
    console.log(chalk.dim('  Test how your agent responds to customer questions.'));
    console.log(chalk.dim('  Type "quit" to exit. Type "/kb" to see related KB entries.\n'));

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: chalk.cyan('  you > '),
    });

    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim();

      if (!input) {
        rl.prompt();
        return;
      }

      if (input.toLowerCase() === 'quit' || input.toLowerCase() === 'exit') {
        console.log(chalk.dim('\n  Session ended.\n'));
        rl.close();
        return;
      }

      if (input === '/kb') {
        const spinner = ora('Searching KB...').start();
        try {
          const kbRes = await apiClient.kbSearch('*', 10);
          const results = (kbRes.data as any).results || [];
          spinner.stop();

          console.log(chalk.bold(`\n  ${results.length} KB entries:`));
          for (const entry of results) {
            console.log(`    ${chalk.dim(`#${entry.id}`)} ${entry.title} ${chalk.dim(`[${entry.category}]`)}`);
          }
          console.log('');
        } catch {
          spinner.fail('Failed to load KB');
        }
        rl.prompt();
        return;
      }

      const spinner = ora(chalk.dim(`  ${agentName} is thinking...`)).start();

      try {
        const response = await apiClient.agentChat(input, agentName);
        const reply = (response.data as any).response || (response.data as any).message || 'No response';
        spinner.stop();

        console.log(`  ${chalk.green(agentName)} > ${reply}`);
        console.log('');
      } catch (error) {
        spinner.stop();
        const apiError = handleApiError(error);
        console.error(chalk.red(`  Error: ${apiError.message}`));
        console.log('');
      }

      rl.prompt();
    });

    rl.on('close', () => {
      process.exit(0);
    });
  });

// ── Quick KB add from stdin or argument ─────────────────────────────
trainCommand
  .command('add')
  .description('Quick-add a KB entry')
  .requiredOption('-t, --title <title>', 'Entry title')
  .option('-c, --category <category>', 'Category', 'general')
  .option('--content <content>', 'Content (or pipe from stdin)')
  .option('-f, --file <file>', 'Read content from file')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    let content = options.content || '';

    // Read from file if specified
    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      content = fs.readFileSync(filePath, 'utf-8');
    }

    // Read from stdin if no content yet
    if (!content && !process.stdin.isTTY) {
      content = await new Promise<string>((resolve) => {
        let data = '';
        process.stdin.setEncoding('utf-8');
        process.stdin.on('data', (chunk) => (data += chunk));
        process.stdin.on('end', () => resolve(data));
      });
    }

    if (!content) {
      console.error(chalk.red('No content provided. Use --content, --file, or pipe from stdin.'));
      process.exit(1);
    }

    const spinner = ora('Adding KB entry...').start();

    try {
      const result = await apiClient.kbCreate({
        title: options.title,
        content,
        category: options.category,
      });

      const entry = result.data as any;
      spinner.succeed(chalk.green(`KB entry created: "${options.title}" [${options.category}]`));
      if (entry.id) {
        console.log(chalk.dim(`  ID: ${entry.id}`));
      }
      console.log(chalk.dim('  Your AI agents now have this knowledge.\n'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to add KB entry'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Show training status ────────────────────────────────────────────
trainCommand
  .command('status')
  .description('Show your AI training status — KB coverage and gaps')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading training status...').start();

    try {
      const kbRes = await apiClient.kbSearch('*', 100);
      const entries = (kbRes.data as any).results || [];

      spinner.stop();

      // Count by category
      const categories: Record<string, number> = {};
      for (const entry of entries) {
        const cat = entry.category || 'general';
        categories[cat] = (categories[cat] || 0) + 1;
      }

      // Calculate coverage score
      const recommended = ['services', 'faq', 'policies', 'about', 'hours', 'products'];
      const covered = recommended.filter((r) => categories[r]);
      const missing = recommended.filter((r) => !categories[r]);
      const score = Math.round((covered.length / recommended.length) * 100);

      // Score color
      const scoreColor = score >= 80 ? '#22c55e' : score >= 50 ? '#eab308' : '#ef4444';
      const scoreBar = chalk.hex(scoreColor)('█'.repeat(Math.round(score / 5))) +
        chalk.dim('░'.repeat(20 - Math.round(score / 5)));

      console.log('');
      console.log(ui.infoBox('AI Training Status', [
        `${chalk.bold('KB Entries:')}  ${chalk.hex('#818cf8')(entries.length.toString())}`,
        `${chalk.bold('Coverage:')}    ${scoreBar} ${chalk.hex(scoreColor)(`${score}%`)}`,
        '',
        ...Object.entries(categories)
          .sort((a, b) => b[1] - a[1])
          .map(([cat, count]) => {
            const bar = chalk.hex('#818cf8')('■'.repeat(Math.min(count, 15)));
            return `  ${cat.padEnd(14)} ${bar} ${chalk.dim(count.toString())}`;
          }),
      ]));

      if (missing.length > 0) {
        console.log('');
        console.log(ui.header('Suggested Categories'));
        for (const cat of missing) {
          console.log(`  ${chalk.yellow('+')} ${cat} ${chalk.dim('— add entries to improve AI accuracy')}`);
        }
      }

      console.log('');
      console.log(ui.divider('Next Steps'));
      console.log('');
      console.log(ui.commandHelp([
        { cmd: 'solid train add -t "FAQ" -c faq -f faq.md', desc: 'Add from file' },
        { cmd: 'solid train import ./kb/', desc: 'Bulk import directory' },
        { cmd: 'solid train chat sarah', desc: 'Test agent knowledge' },
      ]));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load training status'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
