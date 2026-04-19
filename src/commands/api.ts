/**
 * API Explorer for Solid CLI
 *
 * solid api list                              → Browse API endpoints
 * solid api call GET /api/v1/crm/contacts     → Make an API call
 * solid api docs crm                          → Show docs for a section
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

const API_SECTIONS: Record<string, { description: string; endpoints: string[] }> = {
  auth: {
    description: 'Authentication & sessions',
    endpoints: [
      'POST /api/v1/auth/login',
      'POST /api/v1/auth/logout',
      'GET  /api/v1/auth/me',
      'POST /api/v1/auth/refresh',
    ],
  },
  crm: {
    description: 'Contacts, deals, tasks, pipeline',
    endpoints: [
      'GET  /api/v1/crm/contacts',
      'POST /api/v1/crm/contacts',
      'GET  /api/v1/crm/deals',
      'POST /api/v1/crm/deals',
      'GET  /api/v1/crm/tasks',
      'POST /api/v1/crm/tasks',
    ],
  },
  pages: {
    description: 'CMS page management',
    endpoints: [
      'GET  /api/v1/cms/pages',
      'POST /api/v1/cms/pages',
      'GET  /api/v1/cms/pages/{id}',
      'PATCH /api/v1/cms/pages/{id}',
      'DELETE /api/v1/cms/pages/{id}',
      'POST /api/v1/cms/pages/{id}/publish',
      'GET  /api/v1/cms/pages/public/context?company_id=N',
    ],
  },
  kb: {
    description: 'Knowledge base',
    endpoints: [
      'GET  /api/v1/kb/company',
      'POST /api/v1/kb/company',
      'DELETE /api/v1/kb/{id}',
      'GET  /api/v1/kb/search?q=...',
    ],
  },
  agents: {
    description: 'AI agent management',
    endpoints: [
      'GET  /api/v1/cli/agents/status',
      'POST /api/v1/cli/agents/{type}/chat',
      'GET  /api/v1/cli/agents/{type}/soul',
      'POST /api/v1/cli/agents/mission',
      'GET  /api/v1/cli/agents/{type}/memory',
      'GET  /api/v1/cli/agents/{type}/telemetry',
    ],
  },
  billing: {
    description: 'Subscription & invoicing',
    endpoints: [
      'GET  /api/v1/billing/status',
      'GET  /api/v1/billing/usage',
      'GET  /api/v1/billing/invoices',
      'POST /api/v1/billing/checkout-link',
      'POST /api/v1/billing/invoice',
    ],
  },
  sites: {
    description: 'Website management',
    endpoints: [
      'GET  /api/v1/sites',
      'POST /api/v1/sites',
      'GET  /api/v1/sites/{id}',
      'DELETE /api/v1/sites/{id}',
    ],
  },
  services: {
    description: 'Service catalog',
    endpoints: [
      'GET  /api/v1/services/catalog',
      'POST /api/v1/services/catalog',
      'GET  /api/v1/services/catalog/{id}',
    ],
  },
  voice: {
    description: 'Voice AI, phone numbers, calls',
    endpoints: [
      'GET  /api/v1/phone-numbers',
      'GET  /api/v1/calls',
      'GET  /api/v1/voicemails',
      'GET  /api/v1/voice-personality',
    ],
  },
  seo: {
    description: 'SEO audit & local SEO',
    endpoints: [
      'POST /api/v1/seo-audit/run',
      'GET  /api/v1/seo-audit/latest',
      'POST /api/v1/local-seo/audit',
      'GET  /api/v1/local-seo/rank-map',
      'GET  /api/v1/local-seo/citations',
      'GET  /api/v1/local-seo/gaps',
    ],
  },
  vibe: {
    description: 'Natural language site editing',
    endpoints: [
      'POST /api/v1/vibe/analyze',
      'POST /api/v1/vibe/apply',
      'GET  /api/v1/vibe/integrations/catalog',
    ],
  },
  mcp: {
    description: 'MCP tools & AI discovery',
    endpoints: [
      'POST /api/mcp',
      'GET  /api/v1/mcp/tools',
      'GET  /api/v1/healthcheck/mcp',
    ],
  },
  health: {
    description: 'System health',
    endpoints: [
      'GET  /api/v1/health',
      'GET  /api/v1/healthcheck/quick',
      'GET  /api/v1/healthcheck/mcp',
    ],
  },
};

export const apiCommand = new Command('api')
  .description('API explorer — browse and test Solid# API endpoints');

// List all sections
apiCommand
  .command('list').alias('ls')
  .description('Browse API endpoint categories')
  .option('--all', 'Show all endpoints expanded')
  .action((options) => {
    console.log('');
    console.log(ui.header('Solid# API — Endpoint Reference'));
    console.log('');

    for (const [section, info] of Object.entries(API_SECTIONS)) {
      console.log(`  ${chalk.bold.cyan(section.padEnd(12))} ${chalk.dim(info.description)}`);
      if (options.all) {
        for (const ep of info.endpoints) {
          const [method, ...pathParts] = ep.split(/\s+/);
          const path = pathParts.join(' ');
          const methodColor = method === 'GET' ? chalk.green : method === 'POST' ? chalk.blue : method === 'DELETE' ? chalk.red : chalk.yellow;
          console.log(`    ${methodColor(method.padEnd(7))} ${chalk.dim(path)}`);
        }
        console.log('');
      }
    }

    if (!options.all) {
      console.log('');
      console.log(chalk.dim('  Run with --all to expand endpoints, or:'));
      console.log(chalk.dim('  solid api docs <section>  for details'));
    }

    console.log('');
    console.log(chalk.dim(`  ${Object.keys(API_SECTIONS).length} sections • ${Object.values(API_SECTIONS).reduce((n, s) => n + s.endpoints.length, 0)} endpoints listed`));
    console.log(chalk.dim('  Full API docs: https://solidnumber.com/docs/api'));
    console.log('');
  });

// Docs for a section
apiCommand
  .command('docs <section>')
  .description('Show endpoints for a section (e.g., crm, agents, billing)')
  .action((section) => {
    const info = API_SECTIONS[section.toLowerCase()];
    if (!info) {
      console.error(chalk.red(`Unknown section: ${section}`));
      console.log(chalk.dim(`  Available: ${Object.keys(API_SECTIONS).join(', ')}`));
      process.exit(1);
    }

    console.log('');
    console.log(ui.header(`API — ${section} (${info.description})`));
    console.log('');

    for (const ep of info.endpoints) {
      const [method, ...pathParts] = ep.split(/\s+/);
      const path = pathParts.join(' ');
      const methodColor = method === 'GET' ? chalk.green : method === 'POST' ? chalk.blue : method === 'DELETE' ? chalk.red : chalk.yellow;
      console.log(`  ${methodColor(method.padEnd(7))} ${path}`);
    }

    console.log('');
    console.log(chalk.dim(`  Base URL: ${config.apiUrl}`));
    console.log(chalk.dim('  Auth: Bearer token (from solid auth login) or API key (SOLID_API_KEY)'));
    console.log('');
  });

// Call an endpoint
apiCommand
  .command('call <method> <path>')
  .description('Make an API call (e.g., solid api call GET /api/v1/crm/contacts)')
  .option('-d, --data <json>', 'Request body (JSON string)')
  .option('-q, --query <params>', 'Query params (key=val&key2=val2)')
  .option('--raw', 'Output raw response without formatting')
  .action(async (method, path, options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`${method.toUpperCase()} ${path}`).start();

    try {
      const params: Record<string, unknown> = {};
      if (options.query) {
        for (const pair of options.query.split('&')) {
          const [k, v] = pair.split('=');
          if (k) params[k] = v || '';
        }
      }

      let body: unknown;
      if (options.data) {
        try {
          body = JSON.parse(options.data);
        } catch {
          spinner.fail(chalk.red('Invalid JSON in --data'));
          process.exit(1);
        }
      }

      let response;
      const m = method.toUpperCase();
      if (m === 'GET') {
        response = await apiClient.get(path, { params });
      } else if (m === 'POST') {
        response = await apiClient.post(path, body);
      } else if (m === 'PUT') {
        response = await apiClient.put(path, body);
      } else if (m === 'PATCH') {
        response = await apiClient.patch(path, body);
      } else if (m === 'DELETE') {
        response = await apiClient.delete(path, { params });
      } else {
        spinner.fail(chalk.red(`Unsupported method: ${method}`));
        process.exit(1);
        return;
      }

      spinner.succeed(chalk.green(`${response.status} OK`));

      if (options.raw) {
        process.stdout.write(JSON.stringify(response.data));
      } else {
        console.log(JSON.stringify(response.data, null, 2));
      }
    } catch (error) {
      spinner.fail(chalk.red('Request failed'));
      const apiError = handleApiError(error);
      console.error(chalk.red(`  ${apiError.message}`));
    }
  });

apiCommand.addHelpText('after', `
Examples:
  $ solid api list                                 # Enumerate endpoints
  $ solid api docs /api/v1/orders                  # OpenAPI details for one route
  $ solid api call GET /api/v1/orders              # Raw call (adds auth header)
  $ solid api call POST /api/v1/kb -d '{"title":"X","content":"Y"}'
  $ solid api call GET /api/v1/orders?limit=5 --json | jq '.items[].id'

The \`api call\` form is the escape hatch — if a dedicated subcommand doesn't
exist, hit the endpoint directly. Honors global --token, --timeout, --dry-run.
`);
