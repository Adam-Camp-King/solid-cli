/**
 * API key management commands.
 * Wraps controllers/cli_api_keys.py at /api/v1/cli/api-keys/*.
 *
 * Critical for agencies — issue scoped keys per client, share with CI, rotate.
 */

import { Command } from 'commander';
import ora from '../lib/spinner';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth() {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}


export const keysCommand = new Command('keys')
  .alias('api-keys')
  .description('Issue and manage scoped API keys (agencies use this for client access)');

{
  const { withListFlags } = require('../lib/command-kit') as typeof import('../lib/command-kit');
  const listCmd = keysCommand.command('list').alias('ls').description('List API keys for the current company');
  withListFlags(listCmd);
  listCmd.action(async (opts: import('../lib/command-kit').ListFlags) => {
    requireAuth();
    const { runListCommand } = await import('../lib/command-kit');
    await runListCommand(opts, {
      spinnerText: 'Loading API keys...',
      errorText: 'Failed to list keys',
      fetch: async () => (await apiClient.apiKeyList()).data,
      extract: (page) => {
        const d = page as Record<string, unknown>;
        return ((d.api_keys || d.items || []) as Array<Record<string, unknown>>);
      },
      render: (items) => {
        if (!items.length) { console.log(chalk.dim('  No API keys yet.')); return; }
        console.log('');
        for (const k of items) {
          const dot = k.is_active ? chalk.green('●') : chalk.dim('○');
          const used = k.last_used_at ? chalk.dim(`(last used ${String(k.last_used_at).split('T')[0]})`) : chalk.dim('(never used)');
          console.log(`  ${dot} ${chalk.bold(String(k.id))}  ${k.name}  ${chalk.cyan(k.key_prefix + '...')}  ${used}`);
          if (Array.isArray(k.scopes) && k.scopes.length) console.log(`    ${chalk.dim('scopes:')} ${(k.scopes as string[]).join(', ')}`);
        }
        console.log('');
      },
    });
  });
}

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

/**
 * The key this CLI is authenticating with right now, if it is an sk_ key.
 * The list returns `key_prefix` as the first 25 chars plus "...".
 */
export function currentKeyId(
  keys: Array<{ id: number; key_prefix: string; is_active?: boolean }>,
  token: string | undefined,
): number | undefined {
  if (!token || !token.startsWith('sk_')) return undefined;
  const hit = keys.filter((k) => k.is_active !== false)
    .find((k) => {
      const p = String(k.key_prefix || '').replace(/\.\.\.$/, '');
      return p.length > 0 && token.startsWith(p);
    });
  return hit?.id;
}

function collect(v: string, prev: string[]): string[] {
  return prev.concat(v.split(',').map((s) => s.trim()).filter(Boolean));
}

keysCommand
  .command('rotate [key_id]')
  .description('Replace a key with a new one (same name + scopes, plus any --add-scope). New key is created first; the old one is revoked only after that succeeds. Omit key_id to rotate the sk_ key you are using now.')
  .option('--add-scope <scope>', 'Add a scope to the replacement key (repeatable, or comma-separated)', collect, [] as string[])
  .option('--keep-old', 'Create the replacement but do not revoke the old key')
  .action(async (id: string | undefined, opts: { addScope: string[]; keepOld?: boolean }) => {
    requireAuth();
    const spinner = ora(id ? `Rotating key ${id}...` : 'Rotating the current key...').start();
    try {
      // Backend has no single rotate on this surface; do it client-side, in the
      // order that can never lock anyone out: find → CREATE → then revoke.
      const list = (await apiClient.apiKeyList()).data;
      let keyId: number | undefined;
      if (id !== undefined) {
        keyId = parseInt(id, 10);
        if (isNaN(keyId)) { spinner.fail(chalk.red('Invalid key ID.')); process.exit(1); }
      } else {
        keyId = currentKeyId(list.api_keys, config.effectiveToken);
        if (keyId === undefined) {
          spinner.fail(chalk.red('No key id given, and this CLI is not authenticated with an sk_ key it can find.'));
          console.error(chalk.dim('  Pick one from `solid keys list`, then: solid keys rotate <key_id> --add-scope <scope>'));
          process.exit(1);
        }
      }
      const old = list.api_keys.find((k) => k.id === keyId);
      if (!old) { spinner.fail(chalk.red(`Key ${keyId} not found`)); process.exit(1); }
      const scopes = Array.from(new Set([...(old.scopes || []), ...(opts.addScope || [])]));

      let fresh;
      try {
        fresh = (await apiClient.apiKeyCreate(old.name, scopes, undefined, { require_approval: old.require_approval })).data;
      } catch (e) {
        // Nothing was revoked: the old key still works.
        fail(spinner, `Could not create the replacement — key ${keyId} was NOT revoked and still works`, e);
        return;
      }

      let revoked = false;
      let revokeError: unknown;
      if (!opts.keepOld) {
        try { await apiClient.apiKeyRevoke(keyId as number); revoked = true; } catch (e) { revokeError = e; }
      }

      if (isJsonOutput()) {
        spinner.stop();
        console.log(JSON.stringify({
          rotated_from: keyId, api_key: fresh.api_key, key: fresh.key,
          old_key_revoked: revoked,
          ...(revokeError ? { revoke_error: (revokeError as Error)?.message || String(revokeError) } : {}),
        }, null, 2));
      } else {
        spinner.succeed(chalk.green(`New key ${fresh.api_key.id} created (scopes: ${fresh.api_key.scopes.join(', ')})`));
        if (revoked) console.log(chalk.dim(`  Old key ${keyId} revoked.`));
        else if (opts.keepOld) console.log(chalk.dim(`  Old key ${keyId} left active (--keep-old). Revoke it later: solid keys revoke ${keyId}`));
        else console.log(chalk.yellow(`  ⚠ Old key ${keyId} could NOT be revoked — revoke it yourself: solid keys revoke ${keyId}`));
        console.log('');
        console.log(chalk.yellow('  ⚠ Copy this key NOW — it will not be shown again:'));
        console.log(`  ${chalk.cyan(fresh.key)}`);
      }
      if (revokeError) process.exitCode = 1;
    } catch (e) { fail(spinner, 'Failed to rotate key', e); }
  });

import { appendExamples as __appendExamplesKeys, fail } from '../lib/command-kit';
__appendExamplesKeys(keysCommand, [
  { cmd: 'solid keys list', why: 'All issued API keys' },
  { cmd: 'solid keys create --name "prod worker" --scopes kb:read,pages:read', why: 'Issue a scoped key' },
  { cmd: 'solid keys revoke <id>', why: 'Kill a compromised key' },
  { cmd: 'solid keys rotate <id>', why: 'Issue replacement; deprecate old' },
  { cmd: 'solid keys rotate <id> --add-scope verbs:write', why: 'Replace a key with one that also has verbs:write' },
]);
