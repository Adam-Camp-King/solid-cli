/**
 * Call routing commands — the phone tree's CI surface.
 *
 * `solid call simulate` dry-runs a caller through a line's answer ladder
 * (who picks up: ring/ask/ai/off + AI backup + binding-health warnings)
 * and its bound phone tree (call_flow) — WITHOUT dialing anything. It is
 * the same `switchboard.simulate` verb the Phone Tree builder's test
 * button uses, so a routing change can be proven from a terminal or a CI
 * job before it ever answers a real customer.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';

function requireAuth(): void {
  if (!config.isLoggedIn()) {
    console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
    process.exit(1);
  }
}

export const callCommand = new Command('call')
  .description('Call routing tools — simulate a caller through your phone tree');

callCommand
  .command('simulate')
  .description('Dry-run a caller through a line\'s answer ladder + phone tree (nothing rings)')
  .option('-n, --number <phone>', 'The line to call, by phone number (E.164)')
  .option('-l, --line <id>', 'The line to call, by line id')
  .option(
    '-i, --inputs <keys>',
    'Caller key presses / intents, comma-separated. e.g. "1,2" or "billing"',
    ''
  )
  .option('--json', 'Output as JSON (CI-friendly; exit 1 on flow errors)')
  .action(async (options) => {
    requireAuth();
    if (!options.number && !options.line) {
      console.error(chalk.red('Provide the line: --number +1801… or --line <id>'));
      process.exit(2);
    }
    const inputs = String(options.inputs || '')
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const spinner = ora('Simulating the call...').start();
    try {
      const res = await apiClient.post('/api/v1/ada/cli-dispatch', {
        verb: 'switchboard.simulate',
        args: {
          ...(options.line ? { line_id: Number(options.line) } : {}),
          ...(options.number ? { phone_number: options.number } : {}),
          inputs,
        },
        confirm: false,
      });
      const data = (res.data as any) || {};
      const result = data.result ?? data;

      if (data.ok === false || result?.error) {
        spinner.fail(chalk.red(`simulate: ${result?.error || data?.error?.reason || 'failed'}`));
        if (result?.detail || data?.error?.message) {
          console.error(chalk.red(`  ${result?.detail || data?.error?.message}`));
        }
        process.exit(1);
      }

      if (isJsonOutput(options)) {
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
        process.exit((result.flow_errors || []).length > 0 ? 1 : 0);
      }

      spinner.succeed(chalk.green(`${result.line?.phone_number || 'line'} — simulated`));
      console.log('');

      // Who answers
      const ladder = result.ladder || {};
      console.log(`  ${chalk.bold(ladder.first || '?')} answers` +
        (ladder.backup ? chalk.dim(` · backup ${ladder.backup}`) : ''));
      if (ladder.note) console.log(chalk.dim(`  ${ladder.note}`));
      if (ladder.warning) console.log(chalk.yellow(`  ⚠ ${ladder.warning}`));

      // The tree
      console.log(chalk.dim(`\n  Tree: ${result.flow_source || 'none'}`));
      const flowErrors: string[] = result.flow_errors || [];
      if (flowErrors.length > 0) {
        console.log(chalk.red(`  ✗ flow has ${flowErrors.length} error(s):`));
        for (const e of flowErrors) console.log(chalk.red(`    - ${e}`));
        process.exit(1);
      }

      // The caller's path
      const path = result.path || [];
      if (path.length === 0 && result.note) {
        console.log(chalk.dim(`  ${result.note}`));
      }
      for (const step of path) {
        const route = step.route;
        const dest = route
          ? `${route.type}${route.node ? ` (${route.node})` : ''}${route.name ? ` (${route.name})` : ''}`
          : 'no match — re-prompted';
        const tone = route ? chalk.bold : chalk.yellow;
        console.log(`  ${chalk.dim(step.node)} · pressed ${chalk.cyan(step.input)} → ${tone(dest)}`);
      }
    } catch (error) {
      spinner.fail(chalk.red(`Simulate failed: ${(error as Error).message || error}`));
      process.exit(1);
    }
  });
