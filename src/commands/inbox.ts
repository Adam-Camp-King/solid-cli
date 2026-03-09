/**
 * Unified inbox commands for Solid CLI
 *
 * Manage messages, emails, and campaigns across all channels:
 *   - View unified inbox with recent messages
 *   - Send messages to contacts (auto-selects best channel)
 *   - Manage email (list, send, reply, threads)
 *   - Run and track email campaigns
 *
 * All operations are scoped to the authenticated company_id.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

// ── Helpers ──────────────────────────────────────────────────────────

function requireAuth(): boolean {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
  return true;
}

function truncate(text: string | null | undefined, len: number): string {
  if (!text) return '';
  const clean = text.replace(/\n/g, ' ').trim();
  return clean.length > len ? clean.substring(0, len) + '...' : clean;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return chalk.dim('—');
  const d = new Date(dateStr);
  return chalk.dim(d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
}

// ── Main Command ─────────────────────────────────────────────────────

export const inboxCommand = new Command('inbox')
  .description('Unified inbox — messages, email, and campaigns')
  .option('--limit <n>', 'Number of messages to show', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading inbox...').start();

    try {
      const response = await apiClient.get('/api/v1/communications/inbox', {
        params: { limit: parseInt(options.limit) },
      });

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const data = response.data as any;
      const messages = data?.items || data || [];
      spinner.succeed(chalk.green(`${messages.length} messages`));

      if (messages.length === 0) {
        console.log(chalk.dim('  Inbox is empty.'));
        return;
      }

      console.log('');
      for (const msg of messages as any[]) {
        const channel = msg.channel ? chalk.cyan(`[${msg.channel}]`) : '';
        const direction = msg.direction === 'inbound' ? chalk.yellow('←') : chalk.blue('→');
        const contact = msg.contact_name || msg.contact_id || 'Unknown';
        console.log(`  ${direction} ${channel} ${chalk.bold(contact)}  ${formatDate(msg.created_at)}`);
        console.log(chalk.dim(`    ${truncate(msg.message || msg.body || msg.subject, 80)}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load inbox'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Stats ────────────────────────────────────────────────────────────

inboxCommand
  .command('stats')
  .description('Inbox statistics and message counts')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading inbox stats...').start();

    try {
      const response = await apiClient.get('/api/v1/communications/inbox/counts');

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const counts = response.data || {};
      spinner.succeed(chalk.green('Inbox Statistics'));
      console.log('');

      for (const [key, value] of Object.entries(counts)) {
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(`  ${chalk.bold(label)}: ${chalk.cyan(String(value))}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load inbox stats'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Send Message ─────────────────────────────────────────────────────

inboxCommand
  .command('send <contact_id> <message>')
  .description('Send a message to a contact (auto-selects best channel)')
  .action(async (contactId: string, message: string) => {
    requireAuth();
    const spinner = ora('Sending message...').start();

    try {
      const response = await apiClient.post('/api/v1/communications/send', {
        contact_id: parseInt(contactId),
        message,
      });

      const result = response.data as any || {};
      const channel = result.channel || 'auto';
      spinner.succeed(chalk.green(`Message sent via ${channel}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to send message'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Email Subcommands ────────────────────────────────────────────────

const emailCmd = inboxCommand
  .command('email')
  .description('Email management');

emailCmd
  .command('list')
  .description('List emails')
  .option('--direction <dir>', 'Filter: inbound or outbound')
  .option('--limit <n>', 'Number of emails', '20')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading emails...').start();

    try {
      const params: Record<string, any> = { page: 1, page_size: parseInt(options.limit) };
      if (options.direction) params.direction = options.direction;

      const response = await apiClient.get('/api/v1/crm/emails', { params });

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const edata = response.data as any;
      const emails = edata?.items || edata || [];
      spinner.succeed(chalk.green(`${emails.length} emails`));

      if (emails.length === 0) {
        console.log(chalk.dim('  No emails found.'));
        return;
      }

      console.log('');
      for (const email of emails as any[]) {
        const dir = email.direction === 'inbound' ? chalk.yellow('←') : chalk.blue('→');
        const from = email.from_address || email.from || '';
        const to = email.to_address || email.to || '';
        const addr = email.direction === 'inbound' ? from : to;
        console.log(`  ${dir} ${chalk.bold(truncate(email.subject, 50))}  ${formatDate(email.created_at)}`);
        console.log(chalk.dim(`    ${addr}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load emails'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

emailCmd
  .command('get <id>')
  .description('Get email details')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    requireAuth();
    const spinner = ora('Loading email...').start();

    try {
      const response = await apiClient.get(`/api/v1/crm/emails/${id}`);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const email = response.data as any || {};
      spinner.succeed(chalk.green('Email loaded'));
      console.log('');
      console.log(`  ${chalk.bold('Subject:')} ${email.subject || '(no subject)'}`);
      console.log(`  ${chalk.bold('From:')}    ${email.from_address || email.from || '—'}`);
      console.log(`  ${chalk.bold('To:')}      ${email.to_address || email.to || '—'}`);
      console.log(`  ${chalk.bold('Date:')}    ${formatDate(email.created_at)}`);
      if (email.thread_id) {
        console.log(`  ${chalk.bold('Thread:')}  ${email.thread_id}`);
      }
      console.log('');
      console.log(email.body || email.text || chalk.dim('(empty body)'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to load email'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

emailCmd
  .command('send')
  .description('Send an email')
  .requiredOption('--to <address>', 'Recipient email address')
  .requiredOption('--subject <subject>', 'Email subject')
  .requiredOption('--body <body>', 'Email body')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Sending email...').start();

    try {
      await apiClient.post('/api/v1/crm/emails/send', {
        to: options.to,
        subject: options.subject,
        body: options.body,
      });

      spinner.succeed(chalk.green(`Email sent to ${options.to}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to send email'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

emailCmd
  .command('reply <id> <body>')
  .description('Reply to an email')
  .action(async (id: string, body: string) => {
    requireAuth();
    const spinner = ora('Sending reply...').start();

    try {
      await apiClient.post(`/api/v1/crm/emails/${id}/reply`, { body });
      spinner.succeed(chalk.green('Reply sent'));
    } catch (error) {
      spinner.fail(chalk.red('Failed to send reply'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

emailCmd
  .command('thread <thread_id>')
  .description('View an email thread')
  .option('--json', 'Output as JSON')
  .action(async (threadId: string, options) => {
    requireAuth();
    const spinner = ora('Loading thread...').start();

    try {
      const response = await apiClient.get(`/api/v1/crm/emails/threads/${threadId}`);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const tdata = response.data as any;
      const emails = tdata?.items || tdata || [];
      spinner.succeed(chalk.green(`Thread: ${emails.length} messages`));

      console.log('');
      for (const email of emails) {
        const dir = email.direction === 'inbound' ? chalk.yellow('← IN') : chalk.blue('→ OUT');
        console.log(`  ${dir}  ${formatDate(email.created_at)}`);
        console.log(`  ${chalk.bold(email.subject || '(no subject)')}`);
        console.log(chalk.dim(`  ${truncate(email.body || email.text, 120)}`));
        console.log('');
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load thread'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// ── Campaign Subcommands ─────────────────────────────────────────────

const campaignsCmd = inboxCommand
  .command('campaigns')
  .description('Email campaign management')
  .option('--status <status>', 'Filter by status')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Loading campaigns...').start();

    try {
      const params: Record<string, any> = {};
      if (options.status) params.status = options.status;

      const response = await apiClient.get('/api/v1/crm/campaigns', { params });

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const cdata = response.data as any;
      const campaigns = cdata?.items || cdata || [];
      spinner.succeed(chalk.green(`${campaigns.length} campaigns`));

      if (campaigns.length === 0) {
        console.log(chalk.dim('  No campaigns found.'));
        return;
      }

      console.log('');
      for (const c of campaigns) {
        const status = c.status === 'sent'
          ? chalk.green(c.status)
          : c.status === 'draft'
            ? chalk.yellow(c.status)
            : chalk.dim(c.status || 'unknown');
        console.log(`  ${chalk.bold(c.name || c.subject || `Campaign #${c.id}`)}  [${status}]  ${formatDate(c.created_at)}`);
        if (c.subject) console.log(chalk.dim(`    Subject: ${truncate(c.subject, 60)}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load campaigns'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

campaignsCmd
  .command('create')
  .description('Create a new campaign')
  .requiredOption('--name <name>', 'Campaign name')
  .requiredOption('--subject <subject>', 'Email subject line')
  .requiredOption('--body <body>', 'Email body content')
  .action(async (options) => {
    requireAuth();
    const spinner = ora('Creating campaign...').start();

    try {
      const response = await apiClient.post('/api/v1/crm/campaigns', {
        name: options.name,
        subject: options.subject,
        body: options.body,
      });

      const campaign = response.data as any || {};
      spinner.succeed(chalk.green(`Campaign created: ${campaign.id || campaign.name || 'OK'}`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to create campaign'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

campaignsCmd
  .command('send <id>')
  .description('Send a campaign')
  .action(async (id: string) => {
    requireAuth();
    const spinner = ora('Sending campaign...').start();

    try {
      await apiClient.post(`/api/v1/crm/campaigns/${id}/send`);
      spinner.succeed(chalk.green(`Campaign ${id} sent`));
    } catch (error) {
      spinner.fail(chalk.red('Failed to send campaign'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

campaignsCmd
  .command('stats <id>')
  .description('View campaign performance stats')
  .option('--json', 'Output as JSON')
  .action(async (id: string, options) => {
    requireAuth();
    const spinner = ora('Loading campaign stats...').start();

    try {
      const response = await apiClient.get(`/api/v1/crm/campaigns/${id}/stats`);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      const stats = response.data || {};
      spinner.succeed(chalk.green(`Campaign ${id} Stats`));
      console.log('');

      for (const [key, value] of Object.entries(stats)) {
        if (key === 'id' || key === 'campaign_id') continue;
        const label = key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
        console.log(`  ${chalk.bold(label)}: ${chalk.cyan(String(value))}`);
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to load campaign stats'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });
