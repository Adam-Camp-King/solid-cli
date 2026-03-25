/**
 * SEO command for Solid CLI
 *
 * Local SEO audit, rank tracking, and citation management.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export const seoCommand = new Command('seo')
  .description('Local SEO — audit, rankings, citations')
  .action(async () => {
    seoCommand.outputHelp();
  });

seoCommand
  .command('audit')
  .description('Run a full local SEO audit')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Running SEO audit...').start();

    try {
      const response = await apiClient.post('/api/v1/local-seo/audit');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as any;
      console.log('');
      console.log(ui.header('Local SEO Audit'));

      if (d.overall_score !== undefined) {
        const score = d.overall_score;
        const color = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
        console.log(ui.label('Overall Score', color(`${score}/100`)));
      }
      if (d.title_score !== undefined) console.log(ui.label('Title', `${d.title_score}/100`));
      if (d.meta_score !== undefined) console.log(ui.label('Meta Desc', `${d.meta_score}/100`));
      if (d.headings_score !== undefined) console.log(ui.label('Headings', `${d.headings_score}/100`));
      if (d.schema_score !== undefined) console.log(ui.label('Schema', `${d.schema_score}/100`));
      if (d.mobile_score !== undefined) console.log(ui.label('Mobile', `${d.mobile_score}/100`));

      if (d.issues && d.issues.length > 0) {
        console.log('');
        console.log(ui.header('Issues'));
        for (const issue of d.issues.slice(0, 10)) {
          const severity = issue.severity === 'critical' ? chalk.red('●') : issue.severity === 'warning' ? chalk.yellow('●') : chalk.dim('●');
          console.log(`  ${severity} ${issue.message || issue.title}`);
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to run SEO audit'));
      console.error(handleApiError(error).message);
    }
  });

seoCommand
  .command('rank')
  .description('View current search rankings')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading rankings...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/rank-map');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as any;
      console.log('');
      console.log(ui.header('Search Rankings'));

      const rankings = d.rankings || d.results || [];
      if (rankings.length === 0) {
        console.log(chalk.dim('  No ranking data yet. Run `solid seo audit` first.'));
      } else {
        for (const r of rankings.slice(0, 20)) {
          const pos = r.position || r.rank || '?';
          const keyword = r.keyword || r.query || '';
          console.log(`  ${chalk.bold(String(pos).padStart(3))}  ${keyword}`);
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load rankings'));
      console.error(handleApiError(error).message);
    }
  });

seoCommand
  .command('citations')
  .description('View citation report')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading citations...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/citations');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as any;
      console.log('');
      console.log(ui.header('Citations'));

      const citations = d.citations || [];
      if (citations.length === 0) {
        console.log(chalk.dim('  No citation data yet.'));
      } else {
        for (const c of citations) {
          const status = c.status === 'active' ? chalk.green('●') : c.status === 'pending' ? chalk.yellow('●') : chalk.red('●');
          console.log(`  ${status} ${c.source || c.name} — ${c.status}`);
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load citations'));
      console.error(handleApiError(error).message);
    }
  });

seoCommand
  .command('gaps')
  .description('View open SEO gaps')
  .option('--json', 'JSON output')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading SEO gaps...').start();

    try {
      const response = await apiClient.get('/api/v1/local-seo/gaps');
      spinner.stop();

      if (options.json) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const d = response.data as any;
      const gaps = d.gaps || [];
      console.log('');
      console.log(ui.header(`SEO Gaps (${gaps.length})`));

      if (gaps.length === 0) {
        console.log(chalk.green('  No open gaps — looking good!'));
      } else {
        for (const g of gaps) {
          console.log(`  ${chalk.yellow('○')} ${g.title || g.description || g.gap}`);
        }
      }
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load SEO gaps'));
      console.error(handleApiError(error).message);
    }
  });
