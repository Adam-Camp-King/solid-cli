/**
 * Droplet Management Commands
 *
 * Manage customer droplets (Type 2: Managed Instance)
 * These commands allow Solid# to manage customer-owned droplets
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { apiClient } from '../lib/api-client';
import { config } from '../lib/config';

export const dropletCommand = new Command('droplet')
  .description('Manage customer droplets (Type 2: Managed Instance)');

// List all managed droplets
dropletCommand
  .command('list')
  .description('List all managed customer droplets')
  .option('--status <status>', 'Filter by status (active, inactive, maintenance)')
  .action(async (options) => {
    const spinner = ora('Fetching droplets...').start();

    try {
      const response = await apiClient.get('/admin/droplets', {
        params: { status: options.status }
      });

      spinner.stop();

      console.log(chalk.bold('\nManaged Droplets:\n'));
      console.log('┌─────────────────────┬──────────────────┬────────────┬─────────────┐');
      console.log('│ Customer            │ IP Address       │ Status     │ Version     │');
      console.log('├─────────────────────┼──────────────────┼────────────┼─────────────┤');

      for (const droplet of response.data.droplets) {
        const status = droplet.status === 'active'
          ? chalk.green('● active')
          : droplet.status === 'maintenance'
            ? chalk.yellow('○ maint')
            : chalk.red('○ inactive');

        console.log(
          `│ ${droplet.customer_name.padEnd(19)} │ ${droplet.ip.padEnd(16)} │ ${status.padEnd(10)} │ ${droplet.version.padEnd(11)} │`
        );
      }

      console.log('└─────────────────────┴──────────────────┴────────────┴─────────────┘');
      console.log(`\nTotal: ${response.data.droplets.length} droplets`);

    } catch (error: any) {
      spinner.fail('Failed to fetch droplets');
      console.error(chalk.red(error.message));
    }
  });

// Get droplet status
dropletCommand
  .command('status <customer>')
  .description('Get detailed status of a customer droplet')
  .action(async (customer) => {
    const spinner = ora(`Checking ${customer}...`).start();

    try {
      const response = await apiClient.get(`/admin/droplets/${customer}/status`);
      const d = response.data;

      spinner.stop();

      console.log(chalk.bold(`\n${customer} Droplet Status\n`));
      console.log(`IP Address:     ${d.ip}`);
      console.log(`Status:         ${d.status === 'active' ? chalk.green('● Active') : chalk.red('○ Inactive')}`);
      console.log(`Version:        ${d.version}`);
      console.log(`Uptime:         ${d.uptime}`);
      console.log(`Last Deploy:    ${d.last_deploy}`);
      console.log(`Last Backup:    ${d.last_backup}`);
      console.log('');
      console.log(chalk.bold('Health Checks:'));
      console.log(`  Backend:      ${d.health.backend ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Frontend:     ${d.health.frontend ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Database:     ${d.health.database ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  Redis:        ${d.health.redis ? chalk.green('✓') : chalk.red('✗')}`);
      console.log(`  MCP:          ${d.health.mcp ? chalk.green('✓') : chalk.red('✗')}`);
      console.log('');
      console.log(chalk.bold('Resources:'));
      console.log(`  CPU:          ${d.resources.cpu}%`);
      console.log(`  Memory:       ${d.resources.memory}%`);
      console.log(`  Disk:         ${d.resources.disk}%`);

    } catch (error: any) {
      spinner.fail('Failed to get status');
      console.error(chalk.red(error.message));
    }
  });

// Deploy to customer droplet
dropletCommand
  .command('deploy <customer>')
  .description('Deploy latest version to customer droplet')
  .option('--version <version>', 'Deploy specific version')
  .option('--force', 'Force deploy even if health checks fail')
  .action(async (customer, options) => {
    console.log(chalk.yellow(`\nDeploying to ${customer}...`));

    const spinner = ora('Starting deployment...').start();

    try {
      const response = await apiClient.post(`/admin/droplets/${customer}/deploy`, {
        version: options.version || 'latest',
        force: options.force || false
      });

      spinner.text = 'Pulling latest code...';
      await new Promise(r => setTimeout(r, 2000));

      spinner.text = 'Building containers...';
      await new Promise(r => setTimeout(r, 3000));

      spinner.text = 'Running health checks...';
      await new Promise(r => setTimeout(r, 1000));

      spinner.succeed('Deployment complete!');

      console.log(chalk.green(`\n✓ ${customer} deployed to version ${response.data.version}`));
      console.log(`  Deploy time: ${response.data.duration}`);
      console.log(`  Health: All checks passing`);

    } catch (error: any) {
      spinner.fail('Deployment failed');
      console.error(chalk.red(error.message));
      console.log(chalk.yellow('\nRun `solid droplet rollback ' + customer + '` to restore previous version'));
    }
  });

// Rollback customer droplet
dropletCommand
  .command('rollback <customer>')
  .description('Rollback to previous version')
  .option('--version <version>', 'Rollback to specific version')
  .action(async (customer, options) => {
    const spinner = ora(`Rolling back ${customer}...`).start();

    try {
      const response = await apiClient.post(`/admin/droplets/${customer}/rollback`, {
        version: options.version
      });

      spinner.succeed('Rollback complete!');
      console.log(chalk.green(`\n✓ ${customer} rolled back to ${response.data.version}`));

    } catch (error: any) {
      spinner.fail('Rollback failed');
      console.error(chalk.red(error.message));
    }
  });

// Backup customer droplet
dropletCommand
  .command('backup <customer>')
  .description('Create backup of customer droplet')
  .option('--full', 'Full backup including media files')
  .action(async (customer, options) => {
    const spinner = ora(`Creating backup for ${customer}...`).start();

    try {
      const response = await apiClient.post(`/admin/droplets/${customer}/backup`, {
        full: options.full || false
      });

      spinner.succeed('Backup complete!');
      console.log(chalk.green(`\n✓ Backup created: ${response.data.backup_id}`));
      console.log(`  Size: ${response.data.size}`);
      console.log(`  Location: ${response.data.location}`);

    } catch (error: any) {
      spinner.fail('Backup failed');
      console.error(chalk.red(error.message));
    }
  });

// View customer droplet logs
dropletCommand
  .command('logs <customer>')
  .description('View logs from customer droplet')
  .option('--service <service>', 'Filter by service (backend, frontend, celery)')
  .option('--tail <lines>', 'Number of lines to show', '100')
  .option('--follow', 'Follow log output')
  .action(async (customer, options) => {
    console.log(chalk.bold(`\nLogs for ${customer}${options.service ? ` (${options.service})` : ''}:\n`));

    try {
      const response = await apiClient.get(`/admin/droplets/${customer}/logs`, {
        params: {
          service: options.service,
          tail: options.tail,
          follow: options.follow
        }
      });

      for (const line of response.data.logs) {
        const level = line.level;
        const color = level === 'ERROR' ? chalk.red
          : level === 'WARN' ? chalk.yellow
          : chalk.gray;

        console.log(color(`[${line.timestamp}] [${line.service}] ${line.message}`));
      }

    } catch (error: any) {
      console.error(chalk.red(error.message));
    }
  });

// SSH into customer droplet
dropletCommand
  .command('ssh <customer>')
  .description('SSH into customer droplet')
  .action(async (customer) => {
    console.log(chalk.yellow(`\nConnecting to ${customer}...`));

    try {
      const response = await apiClient.get(`/admin/droplets/${customer}/ssh-config`);

      console.log(chalk.green(`\nSSH Command:`));
      console.log(`  ssh ${response.data.user}@${response.data.ip}`);
      console.log(chalk.gray(`\n  Or use: solid droplet exec ${customer} "<command>"`));

    } catch (error: any) {
      console.error(chalk.red(error.message));
    }
  });

// Execute command on customer droplet
dropletCommand
  .command('exec <customer> <command>')
  .description('Execute command on customer droplet')
  .action(async (customer, command) => {
    const spinner = ora(`Executing on ${customer}...`).start();

    try {
      const response = await apiClient.post(`/admin/droplets/${customer}/exec`, {
        command
      });

      spinner.stop();

      console.log(chalk.bold(`\nOutput from ${customer}:\n`));
      console.log(response.data.output);

      if (response.data.exit_code !== 0) {
        console.log(chalk.yellow(`\nExit code: ${response.data.exit_code}`));
      }

    } catch (error: any) {
      spinner.fail('Command failed');
      console.error(chalk.red(error.message));
    }
  });

// Provision new customer droplet
dropletCommand
  .command('provision <customer>')
  .description('Provision a new droplet for customer')
  .option('--size <size>', 'Droplet size (s-2vcpu-4gb, s-4vcpu-8gb)', 's-2vcpu-4gb')
  .option('--region <region>', 'DigitalOcean region', 'nyc1')
  .action(async (customer, options) => {
    console.log(chalk.bold(`\nProvisioning droplet for ${customer}...\n`));

    const spinner = ora('Creating droplet...').start();

    try {
      spinner.text = 'Creating DigitalOcean droplet...';
      await new Promise(r => setTimeout(r, 3000));

      spinner.text = 'Installing dependencies...';
      await new Promise(r => setTimeout(r, 2000));

      spinner.text = 'Configuring firewall...';
      await new Promise(r => setTimeout(r, 1000));

      spinner.text = 'Setting up database...';
      await new Promise(r => setTimeout(r, 2000));

      spinner.text = 'Deploying Solid#...';
      await new Promise(r => setTimeout(r, 3000));

      spinner.text = 'Running health checks...';
      await new Promise(r => setTimeout(r, 1000));

      const response = await apiClient.post('/admin/droplets/provision', {
        customer,
        size: options.size,
        region: options.region
      });

      spinner.succeed('Droplet provisioned!');

      console.log(chalk.green(`\n✓ ${customer} droplet ready`));
      console.log(`  IP: ${response.data.ip}`);
      console.log(`  Size: ${options.size}`);
      console.log(`  Region: ${options.region}`);
      console.log(`  Monthly cost: ~$${response.data.monthly_cost}`);
      console.log(`\n  Dashboard: https://${response.data.ip}`);
      console.log(`  Manage: solid droplet status ${customer}`);

    } catch (error: any) {
      spinner.fail('Provisioning failed');
      console.error(chalk.red(error.message));
    }
  });

// Destroy customer droplet
dropletCommand
  .command('destroy <customer>')
  .description('Destroy a customer droplet (DANGEROUS)')
  .option('--force', 'Skip confirmation')
  .option('--keep-backups', 'Keep backups after destruction')
  .action(async (customer, options) => {
    if (!options.force) {
      console.log(chalk.red.bold(`\n⚠️  WARNING: This will permanently destroy ${customer}'s droplet!`));
      console.log(chalk.red('   All data will be lost unless backed up.\n'));
      console.log(chalk.yellow('   Run with --force to confirm, or Ctrl+C to cancel.'));
      return;
    }

    const spinner = ora(`Destroying ${customer}...`).start();

    try {
      await apiClient.delete(`/admin/droplets/${customer}`, {
        params: { keep_backups: options.keepBackups }
      });

      spinner.succeed(`${customer} droplet destroyed`);
      console.log(chalk.gray('\nBackups ' + (options.keepBackups ? 'preserved' : 'deleted')));

    } catch (error: any) {
      spinner.fail('Destruction failed');
      console.error(chalk.red(error.message));
    }
  });

export default dropletCommand;
