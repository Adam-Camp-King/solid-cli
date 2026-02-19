/**
 * Vibe natural language commands for Solid CLI
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const vibeCommand = new Command('vibe')
  .description('Natural language integration commands')
  .argument('[prompt...]', 'Natural language prompt')
  .option('--preview', 'Preview without applying')
  .option('--json', 'Output as JSON')
  .action(async (promptWords, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    let prompt = promptWords.join(' ');

    // If no prompt provided, start interactive mode
    if (!prompt) {
      const { userPrompt } = await inquirer.prompt([{
        type: 'input',
        name: 'userPrompt',
        message: chalk.cyan('What would you like to do?'),
        validate: (input) => input.length > 0 || 'Please enter a prompt',
      }]);
      prompt = userPrompt;
    }

    const spinner = ora('Analyzing...').start();

    try {
      const response = await apiClient.vibeAnalyze(prompt);

      if (options.json) {
        spinner.stop();
        console.log(JSON.stringify(response.data, null, 2));
        return;
      }

      // Check if blocked
      if (response.data.safety_check.blocked) {
        spinner.fail(chalk.red('Request blocked'));
        console.log(chalk.red(`  Reason: ${(response.data.safety_check as { message?: string }).message || 'Safety check failed'}`));
        return;
      }

      // Show analysis
      spinner.succeed('Analysis complete');
      console.log('');
      console.log(chalk.bold('Intent:'));
      console.log(chalk.dim(`  Action: ${response.data.intent.action || 'unknown'}`));
      console.log(chalk.dim(`  Entity: ${response.data.intent.entity_type || 'unknown'}`));

      if (Object.keys(response.data.parsed).length > 0) {
        console.log('');
        console.log(chalk.bold('Parsed:'));
        for (const [key, value] of Object.entries(response.data.parsed)) {
          console.log(chalk.dim(`  ${key}: ${JSON.stringify(value)}`));
        }
      }

      // If preview mode or no preview_id, stop here
      if (options.preview || !response.data.preview_id) {
        if (options.preview) {
          console.log('');
          console.log(chalk.dim('Preview mode - no changes applied'));
        }
        return;
      }

      // Ask for confirmation
      console.log('');
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: 'Apply these changes?',
        default: false,
      }]);

      if (!confirm) {
        console.log(chalk.dim('Changes not applied'));
        return;
      }

      // Apply changes
      const applySpinner = ora('Applying changes...').start();

      try {
        const applyResponse = await apiClient.vibeApply(response.data.preview_id!);

        if (applyResponse.data.success) {
          applySpinner.succeed(chalk.green('Changes applied'));
          console.log(chalk.dim(`  ${applyResponse.data.message}`));
        } else {
          applySpinner.fail(chalk.red('Failed to apply changes'));
        }
      } catch (error) {
        applySpinner.fail(chalk.red('Failed to apply changes'));
        const apiError = handleApiError(error);
        console.error(chalk.red(`  ${apiError.message}`));
      }
    } catch (error) {
      spinner.fail(chalk.red('Analysis failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

// Interactive mode subcommand
vibeCommand
  .command('interactive')
  .alias('i')
  .description('Start interactive Vibe session')
  .action(async () => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    console.log(chalk.cyan.bold('\nSolid# Vibe Interactive Mode'));
    console.log(chalk.dim('Type your prompts in natural language. Type "exit" to quit.\n'));

    while (true) {
      const { prompt } = await inquirer.prompt([{
        type: 'input',
        name: 'prompt',
        message: chalk.cyan('>'),
        prefix: '',
      }]);

      if (prompt.toLowerCase() === 'exit' || prompt.toLowerCase() === 'quit') {
        console.log(chalk.dim('Goodbye!'));
        break;
      }

      if (!prompt.trim()) continue;

      const spinner = ora('Analyzing...').start();

      try {
        const response = await apiClient.vibeAnalyze(prompt);

        if (response.data.safety_check.blocked) {
          spinner.fail(chalk.red('Blocked'));
          console.log(chalk.dim(`  ${(response.data.safety_check as { message?: string }).message || 'Safety check failed'}\n`));
          continue;
        }

        spinner.succeed(`Intent: ${response.data.intent.action} ${response.data.intent.entity_type}`);

        if (!response.data.preview_id) {
          console.log(chalk.dim('  No preview available\n'));
          continue;
        }

        const { confirm } = await inquirer.prompt([{
          type: 'confirm',
          name: 'confirm',
          message: 'Apply?',
          default: false,
        }]);

        if (confirm) {
          const applySpinner = ora('Applying...').start();
          try {
            const applyResponse = await apiClient.vibeApply(response.data.preview_id);
            if (applyResponse.data.success) {
              applySpinner.succeed(chalk.green('Applied'));
            } else {
              applySpinner.fail(chalk.red('Failed'));
            }
          } catch (error) {
            applySpinner.fail(chalk.red('Failed'));
          }
        }

        console.log('');
      } catch (error) {
        spinner.fail(chalk.red('Error'));
        const apiError = handleApiError(error);
        console.log(chalk.dim(`  ${apiError.message}\n`));
      }
    }
  });
