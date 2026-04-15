/**
 * Webhook listener for local development
 *
 * solid webhooks listen                    → Forward production webhooks to localhost:3000
 * solid webhooks listen --port 8080        → Custom port
 * solid webhooks listen --events payment   → Filter by event type
 *
 * Similar to `stripe listen` — bridges production events to local dev.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

export function addWebhookListenCommand(webhooksCommand: Command): void {
  webhooksCommand
    .command('listen')
    .description('Forward production webhooks to localhost for development')
    .option('-p, --port <port>', 'Local port to forward to', '3000')
    .option('-e, --events <types>', 'Filter events (comma-separated)')
    .option('--path <path>', 'Local endpoint path', '/webhook')
    .action(async (options) => {
      if (!config.isLoggedIn()) {
        console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
        process.exit(1);
      }

      const localUrl = `http://localhost:${options.port}${options.path}`;
      const eventFilter = options.events ? options.events.split(',').map((e: string) => e.trim()) : null;

      console.log('');
      console.log(ui.header('Webhook Listener'));
      console.log('');
      console.log(`  ${chalk.bold('Forwarding to:')}  ${chalk.cyan(localUrl)}`);
      if (eventFilter) {
        console.log(`  ${chalk.bold('Events:')}         ${eventFilter.join(', ')}`);
      } else {
        console.log(`  ${chalk.bold('Events:')}         ${chalk.dim('all')}`);
      }
      console.log(`  ${chalk.bold('Company:')}        ${config.companyId}`);
      console.log('');
      console.log(chalk.dim('  Listening for webhooks... (Ctrl+C to stop)'));
      console.log('');

      // Register a temporary webhook endpoint on the backend
      const ora = (await import('ora')).default;
      const spinner = ora('Registering listener...').start();

      try {
        const res = await apiClient.post('/api/v1/developer/webhooks', {
          url: `cli-listen://${config.companyId}`,
          events: eventFilter || ['*'],
          description: `CLI listener → ${localUrl}`,
          is_cli_listener: true,
        });

        const webhookId = (res.data as Record<string, any>).id || (res.data as Record<string, any>).webhook_id;
        spinner.succeed(chalk.green('Listener registered'));

        // Poll for events
        let eventCount = 0;
        const poll = async () => {
          try {
            const events = await apiClient.get('/api/v1/developer/webhooks/events', {
              params: { webhook_id: webhookId, since: Date.now() - 5000 },
            });
            const items = (events.data as Record<string, any>).events || [];

            for (const event of items) {
              eventCount++;
              const timestamp = new Date().toLocaleTimeString();
              const eventType = event.type || event.event || 'unknown';
              console.log(`  ${chalk.dim(timestamp)} ${chalk.cyan(eventType)} → ${chalk.green('forwarded')}`);

              // Forward to local server
              try {
                const http = await import('http');
                const postData = JSON.stringify(event);
                const url = new URL(localUrl);

                const req = http.request({
                  hostname: url.hostname,
                  port: url.port,
                  path: url.pathname,
                  method: 'POST',
                  headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(postData),
                    'X-Solid-Event': eventType,
                    'X-Solid-Webhook-Id': webhookId,
                  },
                }, (res) => {
                  const statusColor = res.statusCode && res.statusCode < 400 ? chalk.green : chalk.red;
                  console.log(`    ${chalk.dim('→')} ${statusColor(String(res.statusCode))}`);
                });

                req.on('error', () => {
                  console.log(`    ${chalk.dim('→')} ${chalk.red('connection refused')} ${chalk.dim('(is your server running?)')}`);
                });

                req.write(postData);
                req.end();
              } catch {
                console.log(`    ${chalk.dim('→')} ${chalk.red('forward failed')}`);
              }
            }
          } catch {
            // Silent poll failure — will retry
          }
        };

        // Poll every 2 seconds
        const interval = setInterval(poll, 2000);

        // Clean up on exit
        process.on('SIGINT', async () => {
          clearInterval(interval);
          console.log('');
          console.log(chalk.dim(`  ${eventCount} events forwarded. Cleaning up...`));

          try {
            await apiClient.delete(`/api/v1/developer/webhooks/${webhookId}`);
            console.log(chalk.dim('  Listener removed.'));
          } catch {
            // Best-effort cleanup
          }

          process.exit(0);
        });

      } catch (error) {
        spinner.fail(chalk.red('Failed to register listener'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
        console.log('');
        console.log(chalk.dim('  The webhook listener endpoint may not be available yet.'));
        console.log(chalk.dim('  You can still create webhooks manually: solid webhooks create'));
      }
    });

  webhooksCommand
    .command('test <event>')
    .description('Send a test webhook event (e.g., payment.completed)')
    .option('-p, --port <port>', 'Target port', '3000')
    .option('--path <path>', 'Target path', '/webhook')
    .action(async (event, options) => {
      const url = `http://localhost:${options.port}${options.path}`;

      const testPayload = {
        type: event,
        data: {
          id: 'test_' + Date.now(),
          company_id: config.companyId || 1,
          timestamp: new Date().toISOString(),
          test: true,
        },
      };

      console.log('');
      console.log(`  ${chalk.bold('Event:')}  ${chalk.cyan(event)}`);
      console.log(`  ${chalk.bold('Target:')} ${url}`);
      console.log('');

      try {
        const http = await import('http');
        const postData = JSON.stringify(testPayload);
        const parsedUrl = new URL(url);

        const req = http.request({
          hostname: parsedUrl.hostname,
          port: parsedUrl.port,
          path: parsedUrl.pathname,
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(postData),
            'X-Solid-Event': event,
            'X-Solid-Test': 'true',
          },
        }, (res) => {
          const statusColor = res.statusCode && res.statusCode < 400 ? chalk.green : chalk.red;
          console.log(`  ${statusColor('→')} ${statusColor(String(res.statusCode))} ${chalk.dim('response received')}`);
        });

        req.on('error', () => {
          console.log(`  ${chalk.red('→')} ${chalk.red('connection refused')} ${chalk.dim(`(nothing listening on port ${options.port})`)}`);
        });

        req.write(postData);
        req.end();
      } catch {
        console.error(chalk.red('  Failed to send test event'));
      }
    });
}
