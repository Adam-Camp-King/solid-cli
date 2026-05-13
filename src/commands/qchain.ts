/**
 * `solid qchain ...` — Q-Chain substrate audit verbs for external auditors.
 *
 *   solid qchain pubkey                    → fetch public verification metadata (anonymous)
 *   solid qchain export [--since X]        → export own chain (full canonical-form rows)
 *   solid qchain verify [--limit N]        → server-side chain walk + sig verify
 *   solid qchain audit-key --label "..."   → mint a scoped read-only API key for an auditor
 *
 * Designed for AI agents: every verb supports `--json` and the export
 * row shape is the exact contract /.well-known/qchain.json describes.
 *
 * Spec: Owners-Manual/75-Qchain/08-EXTERNAL-AUDITOR-FLOW.md
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

export const qchainCommand = new Command('qchain')
  .description('Q-Chain substrate verification — for external auditors (insurance, SOC 2, compliance)');

// ── solid qchain pubkey ──────────────────────────────────────────────────
// Anonymous. Returns the platform's verification metadata so auditors can
// recompute hashes and verify Ed25519 signatures offline.
qchainCommand
  .command('pubkey')
  .description('Fetch the public verification key + algorithm spec (anonymous, no auth)')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    const spinner = isJsonOutput(options) ? null : ora('Fetching qchain pubkey…').start();
    try {
      const { data } = await apiClient.qchainWellKnown();
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.bold('Q-Chain verification metadata'));
      console.log('');
      console.log(`  ${chalk.bold('Active signer')}     ${chalk.cyan(data.signer_id)}`);
      console.log(`  ${chalk.bold('Hash')}              ${data.hash_algorithm}`);
      console.log(`  ${chalk.bold('Signature')}         ${data.signature_algorithm}`);
      console.log(`  ${chalk.bold('Genesis prev_hash')} ${chalk.dim(data.chain_genesis_prev_hash)}`);
      console.log('');
      console.log(chalk.bold(`  ${data.signers.length} signer(s):`));
      if (data.signers.length === 0) {
        console.log(chalk.yellow('    (hash-chain-only mode — no Ed25519 key configured)'));
      } else {
        for (const s of data.signers) {
          console.log(`    ${chalk.cyan(s.signer_id)} (${s.algorithm})`);
          console.log(`      ${chalk.dim(s.public_key_hex)}`);
        }
      }
      console.log('');
      console.log(chalk.dim(`  Docs: ${data.docs_url}`));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid qchain export ──────────────────────────────────────────────────
// Tenant-scoped. Pulls every field that enters the canonical hash so an
// auditor can reproduce the SHA-256 + verify Ed25519 sig offline.
qchainCommand
  .command('export')
  .description("Export this tenant's full substrate chain for offline verification")
  .option('--since <iso>', 'Only rows with action_taken_at >= ISO-8601 timestamp')
  .option('--until <iso>', 'Only rows with action_taken_at <= ISO-8601 timestamp')
  .option('--limit <n>', 'Max rows (default 10000, hard cap 50000)', (v) => parseInt(v, 10))
  .option('--json', 'Output as JSON (default for this verb)')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora('Exporting chain…').start();
    try {
      const { data } = await apiClient.qchainExport({
        since: options.since,
        until: options.until,
        limit: options.limit,
      });
      if (spinner) spinner.stop();
      // Export is always JSON — that's the auditor contract.
      console.log(JSON.stringify(data, null, 2));
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid qchain verify ──────────────────────────────────────────────────
// Tenant-scoped. Server-side chain walk. Useful as a sanity check before
// the auditor runs their own offline verification.
qchainCommand
  .command('verify')
  .description("Server-side walk + verify of this tenant's chain (sanity check)")
  .option('--limit <n>', 'Cap rows walked (default: all)', (v) => parseInt(v, 10))
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora('Verifying chain…').start();
    try {
      const { data } = await apiClient.qchainVerify(options.limit);
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      const okColor = data.ok ? chalk.green.bold : chalk.red.bold;
      console.log('');
      console.log(`  ${chalk.bold('Status')}        ${okColor(data.ok ? 'INTACT' : 'TAMPER DETECTED')}`);
      console.log(`  ${chalk.bold('Rows checked')}  ${data.rows_checked}`);
      console.log(`  ${chalk.bold('Rows broken')}   ${data.rows_broken.length}`);
      const ss = data.signature_summary || {};
      if (Object.keys(ss).length > 0) {
        console.log('');
        console.log(chalk.bold('  Signature summary'));
        for (const [k, v] of Object.entries(ss)) {
          console.log(`    ${k.padEnd(18)} ${v}`);
        }
      }
      if (data.rows_broken.length > 0) {
        console.log('');
        console.log(chalk.red.bold('  Broken rows'));
        for (const r of data.rows_broken.slice(0, 10)) {
          console.log(`    ${chalk.red(JSON.stringify(r))}`);
        }
        if (data.rows_broken.length > 10) {
          console.log(chalk.dim(`    … +${data.rows_broken.length - 10} more`));
        }
      }
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });

// ── solid qchain audit-key ───────────────────────────────────────────────
// Tenant-scoped. Mints an API key with ONLY audit:substrate:read scope.
// Hand the returned key to the auditor.
qchainCommand
  .command('audit-key')
  .description('Mint a scoped read-only API key for an external auditor')
  .requiredOption('--label <name>', 'Human label, e.g. "Acme Insurance — 2026 SOC 2"')
  .option('--expires-days <n>', 'Days until the key auto-expires (default: 90)', (v) => parseInt(v, 10), 90)
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }
    const spinner = isJsonOutput(options) ? null : ora('Minting auditor key…').start();
    try {
      const { data } = await apiClient.apiKeyCreate(
        options.label,
        ['audit:substrate:read'],
        options.expiresDays,
      );
      if (spinner) spinner.stop();
      if (isJsonOutput(options)) {
        console.log(JSON.stringify(data, null, 2));
        return;
      }
      console.log('');
      console.log(chalk.green.bold('  ✓ Auditor key minted'));
      console.log('');
      console.log(`  ${chalk.bold('Label')}        ${data.api_key.name}`);
      console.log(`  ${chalk.bold('Scopes')}       ${data.api_key.scopes.join(', ')}`);
      console.log(`  ${chalk.bold('Expires in')}   ${options.expiresDays} days`);
      console.log('');
      console.log(chalk.bold('  Key (give this to the auditor — shown only ONCE):'));
      console.log('');
      console.log(`    ${chalk.cyan(data.key)}`);
      console.log('');
      if (data.warning) {
        console.log(chalk.yellow(`  ${data.warning}`));
        console.log('');
      }
      console.log(chalk.dim('  Auditor flow:'));
      console.log(chalk.dim('    1. Auditor fetches  https://api.solidnumber.com/.well-known/qchain.json'));
      console.log(chalk.dim('    2. Auditor calls    GET /api/v1/predictions/substrate/export'));
      console.log(chalk.dim('       with header     Authorization: Bearer <the key above>'));
      console.log(chalk.dim('    3. Auditor walks chain locally — verifies hashes + sigs.'));
      console.log(chalk.dim('  Full spec: Owners-Manual/75-Qchain/08-EXTERNAL-AUDITOR-FLOW.md'));
      console.log('');
    } catch (e) {
      if (spinner) spinner.stop();
      handleApiError(e);
    }
  });
