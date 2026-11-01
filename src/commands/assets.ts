/** Stored images and videos: save a copy on this computer, or move them here to save space. */
import { Command } from 'commander';
import chalk from 'chalk';
import { handleApiError } from '../lib/api-client';
import { config } from '../lib/config';
import { saveAsset } from '../lib/asset-move';

async function run(assetId: string, opts: { output?: string; json?: boolean }, keepCopy: boolean) {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
  try {
    const out = await saveAsset(assetId, opts.output, keepCopy);
    if (opts.json) return console.log(JSON.stringify(out, null, 2));
    console.log(chalk.green(`✓ Saved ${out.saved}`));
    if (keepCopy) return console.log(chalk.dim('  Our copy stays too.'));
    if (out.approval_url) {
      console.log(`  Our copy stays until the account holder approves removing it: ${out.approval_url}`);
    } else if (out.bytes_removed) {
      console.log(chalk.dim('  Our copy is removed. This is now the only ready copy.'));
    } else {
      console.log(chalk.yellow(`  Our copy was not removed: ${out.detail ?? 'see the answer with --json'}`));
    }
  } catch (e) {
    console.error(chalk.red(handleApiError(e).message));
    process.exit(1);
  }
}

export const assetsCommand = new Command('assets').description('Stored images and videos: save or move them to this computer');

assetsCommand.command('save <asset_id>').description('Save a copy here and keep ours')
  .option('-o, --output <path>', 'Where to save it').option('--json', 'Output as JSON')
  .action((id, opts) => run(id, opts, true));

assetsCommand.command('move <asset_id>').description('Save it here, prove the copy, then remove ours to save space (refused if a page uses it)')
  .option('-o, --output <path>', 'Where to save it').option('--json', 'Output as JSON')
  .action((id, opts) => run(id, opts, false));
