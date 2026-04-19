/**
 * LLMs command for Solid CLI
 *
 * Manage and preview the llms.txt AI discovery file for your company.
 * This file tells AI shopping agents (ChatGPT, Alexa, Perplexity, Claude)
 * what your business sells, current prices, and how to book/purchase.
 *
 * Every Solid# company gets llms.txt at {slug}.solidnumber.com/llms.txt
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const llmsCommand = new Command('llms')
  .description('AI discovery — manage your llms.txt for AI shopping agents')
  .action(async () => {
    llmsCommand.outputHelp();
  });

llmsCommand
  .command('preview')
  .description('Preview your llms.txt (what AI agents see)')
  .option('--json', 'Output the raw data instead of llms.txt')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Fetching llms.txt...').start();

    try {
      const response = await apiClient.get(`/api/v1/cms/pages/public/llms.txt`, {
        params: { company_id: companyId },
      });
      spinner.stop();

      if (isJsonOutput(options)) {
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);

      console.log('');
      console.log(ui.header('llms.txt Preview'));
      console.log(chalk.dim('  This is what AI agents see when they crawl your site.'));
      console.log('');
      console.log(chalk.dim('  ─'.repeat(36)));
      console.log('');

      // Print with indentation
      for (const line of content.split('\n')) {
        if (line.startsWith('# ')) {
          console.log(chalk.bold.hex('#818cf8')(`  ${line}`));
        } else if (line.startsWith('## ')) {
          console.log(chalk.bold(`  ${line}`));
        } else if (line.startsWith('- ')) {
          console.log(`  ${line}`);
        } else {
          console.log(chalk.dim(`  ${line}`));
        }
      }

      console.log('');
      console.log(chalk.dim('  ─'.repeat(36)));
      console.log('');

      // Show the URL
      const infoRes = await apiClient.companyInfo();
      const company = (infoRes.data as Record<string, any>).company;
      const slug = company?.slug;
      if (slug) {
        console.log(ui.label('Live URL', chalk.cyan(`https://${slug}.solidnumber.com/llms.txt`)));
      }
      console.log(ui.label('Backend', chalk.dim(`/api/v1/cms/pages/public/llms.txt?company_id=${companyId}`)));
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch llms.txt'));
      console.error(handleApiError(error).message);
    }
  });

llmsCommand
  .command('check')
  .description('Check what AI crawlers can see — products, services, actions')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Checking AI discoverability...').start();

    try {
      // Fetch products, services, and company info in parallel
      const [prodRes, svcRes, infoRes] = await Promise.allSettled([
        apiClient.productsList(),
        apiClient.servicesList(),
        apiClient.companyInfo(),
      ]);

      spinner.stop();

      const products = prodRes.status === 'fulfilled' ? ((prodRes.value.data as Record<string, any>).items || []) : [];
      const services = svcRes.status === 'fulfilled' ? ((svcRes.value.data as Record<string, any>).items || []) : [];
      const company = infoRes.status === 'fulfilled' ? (infoRes.value.data as Record<string, any>).company : null;

      console.log('');
      console.log(ui.header('AI Commerce Readiness'));

      // Company basics
      const hasPhone = !!company?.contact_phone;
      const hasEmail = !!company?.contact_email;
      const hasAddress = !!company?.location;
      const hasHours = !!company?.business_hours;
      const hasSlug = !!company?.slug;

      console.log(ui.label('Phone', hasPhone ? chalk.green('✓') : chalk.red('✗ Missing — AI can\'t tell users how to call')));
      console.log(ui.label('Email', hasEmail ? chalk.green('✓') : chalk.yellow('○ Optional')));
      console.log(ui.label('Address', hasAddress ? chalk.green('✓') : chalk.red('✗ Missing — AI can\'t show location')));
      console.log(ui.label('Hours', hasHours ? chalk.green('✓') : chalk.yellow('○ Optional')));
      console.log(ui.label('Website Slug', hasSlug ? chalk.green(`✓ ${company.slug}.solidnumber.com`) : chalk.red('✗ Missing — no llms.txt URL')));

      // Products
      console.log('');
      console.log(ui.header('Products'));
      if (products.length === 0) {
        console.log(chalk.yellow('  ○ No products — AI shopping agents have nothing to recommend'));
      } else {
        const withPrice = products.filter((p: Record<string, any>) => p.price).length;
        const withDesc = products.filter((p: Record<string, any>) => p.description).length;
        console.log(ui.label('Total', chalk.green(String(products.length))));
        console.log(ui.label('With Price', withPrice === products.length ? chalk.green(`${withPrice}/${products.length}`) : chalk.yellow(`${withPrice}/${products.length}`)));
        console.log(ui.label('With Desc', withDesc === products.length ? chalk.green(`${withDesc}/${products.length}`) : chalk.yellow(`${withDesc}/${products.length}`)));
      }

      // Services
      console.log('');
      console.log(ui.header('Services'));
      if (services.length === 0) {
        console.log(chalk.yellow('  ○ No services — AI can\'t tell users what you offer'));
      } else {
        const withPrice = services.filter((s: Record<string, any>) => s.price).length;
        console.log(ui.label('Total', chalk.green(String(services.length))));
        console.log(ui.label('With Price', withPrice === services.length ? chalk.green(`${withPrice}/${services.length}`) : chalk.yellow(`${withPrice}/${services.length}`)));
      }

      // Score
      let score = 0;
      if (hasPhone) score += 15;
      if (hasAddress) score += 15;
      if (hasSlug) score += 10;
      if (hasHours) score += 5;
      if (hasEmail) score += 5;
      if (products.length > 0) score += 20;
      if (services.length > 0) score += 20;
      if (products.filter((p: Record<string, any>) => p.price).length === products.length && products.length > 0) score += 10;

      console.log('');
      const scoreColor = score >= 80 ? chalk.green : score >= 50 ? chalk.yellow : chalk.red;
      console.log(ui.label('AI Readiness', scoreColor(`${score}/100`)));

      if (score < 80) {
        console.log('');
        console.log(chalk.dim('  Improve your score:'));
        if (!hasPhone) console.log(chalk.dim('    • Add a phone number (solid.config.json)'));
        if (!hasAddress) console.log(chalk.dim('    • Add your address'));
        if (products.length === 0) console.log(chalk.dim('    • Add products so AI can recommend them'));
        if (services.length === 0) console.log(chalk.dim('    • Add services so AI knows what you offer'));
      }

      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to check discoverability'));
      console.error(handleApiError(error).message);
    }
  });

import { appendExamples as __ae_llms } from '../lib/command-kit';
__ae_llms(llmsCommand, [
  { cmd: 'solid llms preview',   why: 'What AI shopping agents see at /llms.txt' },
  { cmd: 'solid llms check',     why: 'AI-commerce readiness score' },
]);
