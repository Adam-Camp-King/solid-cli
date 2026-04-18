/**
 * Cross-company dashboard for agencies
 *
 * solid dashboard                → Overview of all companies
 * solid dashboard --json         → JSON output
 * solid dashboard --revenue      → Revenue focus
 * solid dashboard --agents       → Agent health focus
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';
import { isJsonOutput } from '../lib/json-output';

export const dashboardCommand = new Command('dashboard')
  .description('Agency dashboard — all companies at a glance')
  .option('--json', 'JSON output')
  .option('--revenue', 'Focus on revenue metrics')
  .option('--agents', 'Focus on agent health')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora('Loading dashboard across all companies...').start();

    try {
      // Get company list
      const companiesRes = await apiClient.companiesList();
      const companies = companiesRes.data.companies || [];

      if (companies.length === 0) {
        spinner.succeed(chalk.dim('No companies found'));
        return;
      }

      // Fetch status for each company in parallel
      const results = await Promise.allSettled(
        companies.map(async (company: { id: number; name: string; role: string }) => {
          try {
            // Fetch dashboard summary for each company
            const summary = await apiClient.get('/api/v1/dashboard/summary', {
              params: { company_id: company.id },
            });
            const agents = await apiClient.get('/api/v1/cli/agents/status', {
              params: { company_id: company.id },
            }).catch(() => ({ data: { agents: [] } }));

            return {
              ...company,
              summary: summary.data as Record<string, any>,
              agents: (agents.data as Record<string, any>).agents || [],
              status: 'ok' as const,
            };
          } catch {
            return { ...company, summary: {}, agents: [], status: 'error' as const };
          }
        })
      );

      spinner.stop();

      if (isJsonOutput(options)) {
        const data = results.map((r) => r.status === 'fulfilled' ? r.value : null).filter(Boolean);
        console.log(JSON.stringify(data, null, 2));
        return;
      }

      const active = config.companyId;

      console.log('');
      console.log(ui.header(`Agency Dashboard — ${companies.length} Companies`));
      console.log('');

      let totalRevenue = 0;
      let totalCustomers = 0;
      let healthyAgents = 0;
      let totalAgents = 0;

      for (const result of results) {
        if (result.status !== 'fulfilled') continue;
        const c = result.value;
        const isActive = c.id === active;
        const marker = isActive ? chalk.green(' ●') : '  ';
        const nameStr = isActive ? chalk.bold.green(c.name) : chalk.bold(c.name);
        const roleStr = chalk.dim(`(${c.role})`);

        const s = c.summary as Record<string, any>;
        const revenue = s.revenue || 0;
        const customers = s.customers || 0;
        totalRevenue += revenue;
        totalCustomers += customers;

        const agentCount = c.agents.length;
        const agentHealthy = c.agents.filter((a: any) => a.status === 'active' || a.is_enabled).length;
        totalAgents += agentCount;
        healthyAgents += agentHealthy;

        const statusIcon = c.status === 'ok' ? chalk.green('●') : chalk.red('●');

        if (options.revenue) {
          console.log(`${marker} ${nameStr} ${roleStr}`);
          console.log(`     ${chalk.dim('Revenue:')} ${chalk.green('$' + revenue.toLocaleString())}  ${chalk.dim('Customers:')} ${customers}`);
        } else if (options.agents) {
          console.log(`${marker} ${nameStr} ${roleStr}`);
          const agentStr = agentCount > 0
            ? `${agentHealthy}/${agentCount} healthy`
            : chalk.dim('no agents');
          console.log(`     ${chalk.dim('Agents:')} ${agentStr}`);
        } else {
          const revenueStr = revenue > 0 ? chalk.green('$' + revenue.toLocaleString()) : chalk.dim('$0');
          const agentStr = agentCount > 0
            ? `${chalk.green(String(agentHealthy))}/${agentCount}`
            : chalk.dim('0');
          console.log(`${marker} ${statusIcon} ${nameStr} ${roleStr}  ${revenueStr}  ${chalk.dim('agents:')} ${agentStr}  ${chalk.dim('customers:')} ${customers}`);
        }
      }

      console.log('');
      console.log(ui.divider('Totals'));
      console.log(`  ${chalk.bold('Revenue:')}    ${chalk.green('$' + totalRevenue.toLocaleString())}`);
      console.log(`  ${chalk.bold('Customers:')}  ${totalCustomers}`);
      console.log(`  ${chalk.bold('Agents:')}     ${healthyAgents}/${totalAgents} healthy`);
      console.log(`  ${chalk.bold('Companies:')}  ${companies.length}`);
      console.log('');
    } catch (error) {
      spinner.fail(chalk.red('Failed to load dashboard'));
      console.error(handleApiError(error).message);
    }
  });
