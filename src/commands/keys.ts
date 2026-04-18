/**
 * API key management commands.
 * Wraps controllers/cli_api_keys.py at /api/v1/cli/api-keys/*.
 *
 * Critical for agencies — issue scoped keys per client, share with CI, rotate.
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

function fail(spinner: ReturnType<typeof ora>, msg: string, err: unknown) {
  spinner.fail(chalk.red(msg));
  console.error(chalk.red(`  ${handleApiError(err).message}`));
}

export const keysCommand = new Command('keys')
  .alias('api-keys')
  .description('Issue and manage scoped API keys (agencies use this for client access)');

keysCommand
  .command('list')
  .description('List API keys for the current company')
  .option('--json', 'Output as JSON')
  .action(async (opts) => {
    requireAuth();
    const spinner = ora('Loading API keys...').start();
    try {
      const res = await apiClient.apiKeyList();
      const data = res.data;
      if (isJsonOutput(opts)) { spinner.stop(); console.log(JSON.stringify(data, null, 2)); return; }
      spinner.succeed(chalk.green(`${data.api_keys.length} key(s)`));
      console.log('');
      for (const k of data.api_keys) {
        const dot = k.is_active ? chalk.green('●') : chalk.dim('○');
        const used = k.last_used_at ? chalk.dim(`(last used ${k.last_used_at.split('T')[0]})`) : chalk.dim('(never used)');
        console.log(`  ${dot} ${chalk.bold(k.id)}  ${k.name}  ${chalk.cyan(k.key_prefix + '...')}  ${used}`);
        if (k.scopes?.length) console.log(`    ${chalk.dim('scopes:')} ${k.scopes.join(', ')}`);
      }
      console.log('');
      console.log(chalk.dim(`  Available scopes: ${data.available_scopes.join(', ')}`));
    } catch (e) { fail(spinner, 'Failed to list keys', e); }
  });

keysCommand
  .command('create')
  .description('Create a new scoped API key (full key shown ONCE; copy it now)')
  .requiredOption('--name <name>', 'Human-readable name')
  .requiredOption('--scopes <list>', 'Comma-separated scopes (e.g. brand:read,kb:write)')
  .option('--expires <days>', 'Expire in N days (omit for no expiration)')
  .action(async (opts) => {
    requireAuth();
    const scopes = String(opts.scopes).split(',').map((s: string) => s.trim()).filter(Boolean);
    if (!scopes.length) {
      console.error(chalk.red('Provide at least one scope via --scopes.'));
      process.exit(1);
    }
    const expires = opts.expires ? parseInt(opts.expires, 10) : undefined;
    const spinner = ora(`Creating key "${opts.name}"...`).start();
    try {
      const res = await apiClient.apiKeyCreate(opts.name, scopes, expires);
      const data = res.data;
      spinner.succeed(chalk.green(`Key created: ${data.api_key.id}`));
      console.log('');
      console.log(`  ${chalk.bold('Name:')}    ${data.api_key.name}`);
      console.log(`  ${chalk.bold('Scopes:')}  ${data.api_key.scopes.join(', ')}`);
      console.log('');
      console.log(chalk.yellow('  ⚠ Copy this key NOW — it will not be shown again:'));
      console.log('');
      console.log(`  ${chalk.cyan(data.key)}`);
      console.log('');
      console.log(chalk.dim('  Use it via: export SOLID_API_KEY=<key>'));
      if (data.warning) console.log(chalk.dim(`  ${data.warning}`));
    } catch (e) { fail(spinner, 'Failed to create key', e); }
  });

keysCommand
  .command('revoke <key_id>')
  .description('Revoke an API key')
  .action(async (id) => {
    requireAuth();
    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) { console.error(chalk.red('Invalid key ID.')); process.exit(1); }
    const spinner = ora(`Revoking key ${keyId}...`).start();
    try {
      await apiClient.apiKeyRevoke(keyId);
      spinner.succeed(chalk.green(`Key ${keyId} revoked`));
    } catch (e) { fail(spinner, 'Failed to revoke key', e); }
  });

keysCommand
  .command('rotate <key_id>')
  .description('Revoke and re-create with the same name + scopes (returns a new key)')
  .action(async (id) => {
    requireAuth();
    const keyId = parseInt(id, 10);
    if (isNaN(keyId)) { console.error(chalk.red('Invalid key ID.')); process.exit(1); }
    const spinner = ora(`Rotating key ${keyId}...`).start();
    try {
      // Backend doesn't have a single rotate; do it client-side: list, find, revoke, recreate.
      const list = (await apiClient.apiKeyList()).data;
      const old = list.api_keys.find((k) => k.id === keyId);
      if (!old) { spinner.fail(chalk.red(`Key ${keyId} not found`)); return; }
      await apiClient.apiKeyRevoke(keyId);
      const fresh = (await apiClient.apiKeyCreate(old.name, old.scopes)).data;
      spinner.succeed(chalk.green(`Key rotated: new id ${fresh.api_key.id}`));
      console.log('');
      console.log(chalk.yellow('  ⚠ Copy this key NOW — it will not be shown again:'));
      console.log(`  ${chalk.cyan(fresh.key)}`);
    } catch (e) { fail(spinner, 'Failed to rotate key', e); }
  });
