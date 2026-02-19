/**
 * Company switching command for Solid CLI
 *
 * solid switch                    → Interactive picker
 * solid switch 15                 → Switch directly to company_id 15
 * solid switch "Mike's Plumbing"  → Switch by name
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import ora from 'ora';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';

export const switchCommand = new Command('switch')
  .description('Switch active company')
  .argument('[target]', 'Company ID or name to switch to')
  .action(async (target?: string) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const spinner = ora('Loading companies...').start();

    try {
      const response = await apiClient.companiesList();
      spinner.stop();

      const { companies, active_company_id } = response.data;

      if (companies.length === 0) {
        console.log(chalk.yellow('  No companies found.'));
        return;
      }

      if (companies.length === 1) {
        console.log(chalk.dim(`  You only have access to one company: ${companies[0].name} (${companies[0].id})`));
        return;
      }

      let targetId: number | undefined;

      if (target) {
        // Try to match by ID
        const asNumber = parseInt(target, 10);
        if (!isNaN(asNumber)) {
          const match = companies.find((c: { id: number }) => c.id === asNumber);
          if (match) {
            targetId = match.id;
          } else {
            console.error(chalk.red(`  Company ID ${asNumber} not found in your linked companies.`));
            process.exit(1);
          }
        } else {
          // Match by name (case-insensitive partial)
          const lower = target.toLowerCase();
          const match = companies.find((c: { name: string }) => c.name.toLowerCase().includes(lower));
          if (match) {
            targetId = match.id;
          } else {
            console.error(chalk.red(`  No company matching "${target}" found.`));
            process.exit(1);
          }
        }
      } else {
        // Interactive picker
        const choices = companies.map((c: { id: number; name: string; role: string }) => ({
          name: c.id === active_company_id
            ? chalk.green(`→ ${c.name} (ID: ${c.id}) — ${c.role} [current]`)
            : `  ${c.name} (ID: ${c.id}) — ${c.role}`,
          value: c.id,
        }));

        const answer = await inquirer.prompt([{
          type: 'list',
          name: 'companyId',
          message: 'Select company:',
          choices,
          default: active_company_id,
        }]);

        targetId = answer.companyId;
      }

      if (targetId === active_company_id) {
        console.log(chalk.dim('  Already on this company.'));
        return;
      }

      // Switch
      const switchSpinner = ora('Switching company...').start();
      const switchResponse = await apiClient.companySwitch(targetId!);
      switchSpinner.succeed(chalk.green(`Switched to ${switchResponse.data.company.name}`));

      // Update local config
      config.accessToken = switchResponse.data.access_token;
      config.refreshToken = switchResponse.data.refresh_token;
      config.companyId = switchResponse.data.company.id;

      // Compute expiry from expires_in
      const expiresAt = new Date(Date.now() + switchResponse.data.expires_in * 1000);
      config.tokenExpiresAt = expiresAt;

      console.log('');
      console.log(chalk.dim(`  Company:  ${switchResponse.data.company.name} (${switchResponse.data.company.id})`));
      console.log(chalk.dim(`  Role:     ${switchResponse.data.role}`));
      console.log('');
    } catch (error) {
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
      process.exit(1);
    }
  });
