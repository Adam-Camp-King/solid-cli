/**
 * Agent test command for Solid CLI
 *
 * CI/CD testing for agent behavior:
 *   solid test sarah "what are your hours"              — basic test
 *   solid test sarah "what are your hours" --contains "monday,friday"
 *   solid test sarah "refund policy" --not-contains "guaranteed"
 *   solid test --file tests.json                        — run test suite from file
 *   solid test results                                  — recent test results
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

const AGENT_NAME_MAP: Record<string, string> = {
  sarah: 'customer_service', marcus: 'growth_intelligence', devon: 'operations_monitor',
  ada: 'orchestrator', jake: 'inventory_manager', morgan: 'appointment_scheduler',
  alex: 'sales_rep', jordan: 'review_manager', maya: 'email_marketer',
  riley: 'loyalty_program', ace: 'design_engine', annie: 'phone_agent',
  nora: 'social_media', emma: 'content_writer', victor: 'voice_setup',
  gwen: 'google_workspace', jackson: 'estimates', lucie: 'lead_intake',
  daphne: 'dispatch', dexter: 'data_entry',
};

function resolveAgentType(name: string): string {
  return AGENT_NAME_MAP[name.toLowerCase()] || name.toLowerCase();
}

interface TestCase {
  agent: string;
  prompt: string;
  contains?: string[];
  not_contains?: string[];
  timeout?: number;
}

export const testCommand = new Command('test')
  .description('Test agent responses with assertions')
  .argument('[agent]', 'Agent name (sarah, marcus, etc.) or "results"')
  .argument('[prompt]', 'Prompt to send to the agent')
  .option('-c, --contains <strings>', 'Response MUST contain these (comma-separated)')
  .option('-C, --not-contains <strings>', 'Response MUST NOT contain these (comma-separated)')
  .option('--timeout <seconds>', 'Max wait time for response', '30')
  .option('--file <path>', 'Run test suite from JSON file')
  .option('--json', 'Output as JSON')
  .option('-v, --verbose', 'Show full response text')
  .action(async (agent, prompt, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run: solid auth login'));
      return;
    }

    // Show recent test results
    if (agent === 'results') {
      const spinner = ora('Loading test results...').start();
      try {
        const res = await apiClient.agentTestResults(24, 50);
        spinner.succeed(chalk.green('Results loaded'));
        const data = res.data as Record<string, any>;

        if (options.json) {
          console.log(JSON.stringify(data, null, 2));
          return;
        }

        console.log('');
        if (data.results.length === 0) {
          console.log(chalk.dim('  No test results in the last 24h.'));
        } else {
          const rows = data.results.map((r: Record<string, any>) => [
            r.success ? chalk.green('PASS') : chalk.red('FAIL'),
            r.agent_type,
            r.latency_ms ? `${r.latency_ms}ms` : '—',
            r.tokens_used ? `${r.tokens_used}` : '—',
            new Date(r.timestamp).toLocaleTimeString(),
          ]);
          console.log(ui.table(['Result', 'Agent', 'Latency', 'Tokens', 'Time'], rows));
        }
        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Failed to load results'));
        console.error(chalk.red(`  ${handleApiError(error).message}`));
        process.exit(1);
      }
      return;
    }

    // Run test suite from file
    if (options.file) {
      const filePath = path.resolve(options.file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`Test file not found: ${filePath}`));
        return;
      }

      const suite: TestCase[] = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      if (!Array.isArray(suite)) {
        console.error(chalk.red('Test file must be a JSON array of test cases.'));
        return;
      }

      console.log('');
      console.log(chalk.bold(`  Running ${suite.length} tests from ${path.basename(filePath)}`));
      console.log('');

      let passed = 0;
      let failed = 0;

      for (let i = 0; i < suite.length; i++) {
        const tc = suite[i];
        const agentType = resolveAgentType(tc.agent);
        const label = `[${i + 1}/${suite.length}] ${tc.agent}: "${tc.prompt.substring(0, 50)}"`;
        const spinner = ora(label).start();

        try {
          const res = await apiClient.agentTest({
            agent_type: agentType,
            prompt: tc.prompt,
            assertions: tc.contains,
            not_assertions: tc.not_contains,
            timeout_seconds: tc.timeout || 30,
          });
          const result = res.data as Record<string, any>;

          if (result.passed) {
            spinner.succeed(chalk.green(`${label} — PASS (${result.latency_ms}ms)`));
            passed++;
          } else {
            spinner.fail(chalk.red(`${label} — FAIL`));
            for (const f of result.assertions_failed) {
              console.log(`    ${chalk.red('✗')} ${f.type}: "${f.value}"`);
            }
            if (options.verbose && result.response) {
              console.log(chalk.dim(`    Response: ${result.response.substring(0, 200)}`));
            }
            failed++;
          }
        } catch (error) {
          // Don't exit on individual test failure — count and keep
          // going, then exit non-zero at the end of the loop based on
          // failed > 0. The aggregate summary is the contract.
          spinner.fail(chalk.red(`${label} — ERROR`));
          console.error(`    ${chalk.red(handleApiError(error).message)}`);
          failed++;
        }
      }

      console.log('');
      const summary = failed === 0
        ? chalk.green(`All ${passed} tests passed`)
        : chalk.red(`${failed} failed, ${passed} passed`);
      console.log(ui.successBox('Test Suite Complete', [summary]));
      console.log('');

      if (failed > 0) process.exit(1);
      return;
    }

    // Single test
    if (!agent || !prompt) {
      console.error(chalk.red('Usage: solid test <agent> "<prompt>" [--contains "word1,word2"]'));
      console.error(chalk.dim('       solid test sarah "what are your hours" --contains "monday"'));
      console.error(chalk.dim('       solid test results'));
      console.error(chalk.dim('       solid test --file tests.json'));
      return;
    }

    const agentType = resolveAgentType(agent);
    const assertions = options.contains ? options.contains.split(',').map((s: string) => s.trim()) : undefined;
    const notAssertions = options.notContains ? options.notContains.split(',').map((s: string) => s.trim()) : undefined;
    const hasAssertions = (assertions && assertions.length > 0) || (notAssertions && notAssertions.length > 0);

    const spinner = ora(`Testing ${agent}: "${prompt.substring(0, 50)}"...`).start();

    try {
      const res = await apiClient.agentTest({
        agent_type: agentType,
        prompt,
        assertions,
        not_assertions: notAssertions,
        timeout_seconds: parseInt(options.timeout, 10),
      });
      const result = res.data as Record<string, any>;

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      if (!hasAssertions) {
        // No assertions — just show the response
        spinner.succeed(chalk.green(`Response from ${agent} (${result.latency_ms}ms)`));
        console.log('');
        console.log(chalk.white(`  ${result.response}`));
        console.log('');
        console.log(chalk.dim('  Add assertions: --contains "keyword" --not-contains "bad word"'));
        console.log('');
        return;
      }

      if (result.passed) {
        spinner.succeed(chalk.green(`PASS — ${agent} (${result.latency_ms}ms)`));
        console.log('');
        for (const a of result.assertions_passed) {
          console.log(`  ${chalk.green('✓')} ${a.type}: "${a.value}"`);
        }
      } else {
        spinner.fail(chalk.red(`FAIL — ${agent} (${result.latency_ms}ms)`));
        console.log('');
        for (const a of result.assertions_passed) {
          console.log(`  ${chalk.green('✓')} ${a.type}: "${a.value}"`);
        }
        for (const a of result.assertions_failed) {
          console.log(`  ${chalk.red('✗')} ${a.type}: "${a.value}"`);
        }
      }

      if (options.verbose && result.response) {
        console.log('');
        console.log(chalk.dim('  Response:'));
        console.log(chalk.dim(`  ${result.response.substring(0, 500)}`));
      }

      console.log('');

      if (!result.passed) process.exit(1);
    } catch (error) {
      spinner.fail(chalk.red('Test failed'));
      console.error(chalk.red(`  ${handleApiError(error).message}`));
      process.exit(1);
    }
  });

import { appendExamples as __ae_test } from '../lib/command-kit';
__ae_test(testCommand, [
  { cmd: 'solid test sarah "When are you open?"',             why: 'Test an agent response' },
  { cmd: 'solid test sarah "..." --expect "Mon-Fri 9-5"',     why: 'Assert substring in response' },
  { cmd: 'solid test --file tests.json',                      why: 'Run a batch of assertions' },
]);
