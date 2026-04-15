/**
 * Project scaffolding — build apps on Solid# infrastructure
 *
 * solid init my-app                          → Interactive setup
 * solid init my-app --type marketplace       → Marketplace template
 * solid init my-app --type saas              → SaaS starter
 * solid init my-app --type agency-dashboard  → Agency management tool
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { ui } from '../lib/ui';

const APP_TYPES: Record<string, { name: string; description: string; files: Record<string, string> }> = {
  basic: {
    name: 'Basic App',
    description: 'Simple app connected to Solid# API',
    files: {
      'package.json': JSON.stringify({
        name: '{{name}}',
        version: '0.1.0',
        scripts: { start: 'node index.js', dev: 'node --watch index.js' },
        dependencies: { '@solidnumber/sdk': '^1.0.0' },
      }, null, 2),
      'index.js': `const { SolidClient } = require('@solidnumber/sdk');

const solid = new SolidClient({
  apiKey: process.env.SOLID_API_KEY,
  companyId: process.env.SOLID_COMPANY_ID ? parseInt(process.env.SOLID_COMPANY_ID) : undefined,
});

async function main() {
  // Your app starts here
  const health = await solid.health.check();
  console.log('Connected to Solid#:', health.data.status);

  const contacts = await solid.crm.contacts();
  console.log('Contacts:', contacts.data);
}

main().catch(console.error);
`,
      '.env.example': `SOLID_API_KEY=sk_solid_your_key_here
SOLID_COMPANY_ID=
`,
      'README.md': `# {{name}}

Built on [Solid#](https://solidnumber.com) infrastructure.

## Setup

1. \`npm install\`
2. Copy \`.env.example\` to \`.env\` and add your API key
3. \`npm start\`

## Get your API key

\`\`\`bash
solid auth login
solid auth token create -n "{{name}}" -s "crm:read,pages:read,kb:read"
\`\`\`
`,
    },
  },
  marketplace: {
    name: 'Multi-Vendor Marketplace',
    description: 'Each vendor is a Solid# company with AI agents',
    files: {
      'package.json': JSON.stringify({
        name: '{{name}}',
        version: '0.1.0',
        scripts: { start: 'node server.js', dev: 'node --watch server.js' },
        dependencies: { '@solidnumber/sdk': '^1.0.0', express: '^4.18.0' },
      }, null, 2),
      'server.js': `const express = require('express');
const { SolidClient } = require('@solidnumber/sdk');

const app = express();
const solid = new SolidClient({ apiKey: process.env.SOLID_API_KEY });

// List all vendor companies
app.get('/vendors', async (req, res) => {
  const companies = await solid.companies.list();
  res.json(companies.data);
});

// Vendor storefront — switch company context per request
app.get('/vendor/:companyId/products', async (req, res) => {
  solid.switchCompany(parseInt(req.params.companyId));
  const services = await solid.services.list();
  res.json(services.data);
});

// Vendor AI chat
app.post('/vendor/:companyId/chat', express.json(), async (req, res) => {
  solid.switchCompany(parseInt(req.params.companyId));
  const reply = await solid.agents.chat('sarah', req.body.message);
  res.json(reply.data);
});

app.listen(3000, () => console.log('Marketplace running on :3000'));
`,
      '.env.example': `SOLID_API_KEY=sk_solid_your_key_here
`,
      'README.md': `# {{name}} — Multi-Vendor Marketplace

Each vendor is a Solid# company with their own AI agents, CRM, and services.

## Architecture
- Each vendor = one Solid# company (created via \`solid company create\`)
- Vendor onboarding = \`solid clone <template> --company "Vendor Name"\`
- Each vendor gets AI agents, CRM, booking, payments
- Your app is the frontend connecting them all

## Setup
1. \`npm install\`
2. Set \`SOLID_API_KEY\` in \`.env\`
3. \`npm start\`
`,
    },
  },
  saas: {
    name: 'SaaS Starter',
    description: 'Multi-tenant SaaS with Solid# backend',
    files: {
      'package.json': JSON.stringify({
        name: '{{name}}',
        version: '0.1.0',
        scripts: { start: 'node server.js', dev: 'node --watch server.js' },
        dependencies: { '@solidnumber/sdk': '^1.0.0', express: '^4.18.0' },
      }, null, 2),
      'server.js': `const express = require('express');
const { SolidClient } = require('@solidnumber/sdk');

const app = express();
app.use(express.json());

// Each customer = a Solid# company
// Your SaaS manages the companies, Solid# handles everything else

const admin = new SolidClient({ apiKey: process.env.SOLID_API_KEY });

// Onboard new customer
app.post('/signup', async (req, res) => {
  const { businessName, industry } = req.body;

  // Create company on Solid#
  const company = await admin.companies.create(businessName, industry);
  const companyId = company.data.company.id;

  // Apply industry template
  admin.switchCompany(companyId);
  await admin.templates.clone(industry);

  res.json({
    companyId,
    message: 'Business created with AI agents, website, CRM, and more',
    dashboard: \`https://app.solidnumber.com/dashboard\`,
  });
});

// Customer dashboard data
app.get('/customer/:id/dashboard', async (req, res) => {
  admin.switchCompany(parseInt(req.params.id));
  const [contacts, pages, agents] = await Promise.all([
    admin.crm.contacts(),
    admin.pages.list(),
    admin.agents.list(),
  ]);
  res.json({ contacts: contacts.data, pages: pages.data, agents: agents.data });
});

app.listen(3000, () => console.log('SaaS running on :3000'));
`,
      '.env.example': `SOLID_API_KEY=sk_solid_your_key_here
`,
      'README.md': `# {{name}} — SaaS on Solid#

Multi-tenant SaaS where each customer gets a full AI-powered business.

## How it works
- \`POST /signup\` creates a Solid# company + applies industry template
- Each customer gets: AI agents, CRM, website, booking, payments
- You build the custom UI, Solid# handles the infrastructure

## What you DON'T have to build
- Auth & multi-tenancy (530 tables with RLS)
- Payment processing (Stripe wired)
- AI agents (116 agents, SmartRouter, CognitiveLimiter)
- CRM, voice AI, website builder, SEO
`,
    },
  },
  'agency-dashboard': {
    name: 'Agency Dashboard',
    description: 'Manage all client companies from one interface',
    files: {
      'package.json': JSON.stringify({
        name: '{{name}}',
        version: '0.1.0',
        scripts: { start: 'node server.js', dev: 'node --watch server.js' },
        dependencies: { '@solidnumber/sdk': '^1.0.0', express: '^4.18.0' },
      }, null, 2),
      'server.js': `const express = require('express');
const { SolidClient } = require('@solidnumber/sdk');

const app = express();
const solid = new SolidClient({ apiKey: process.env.SOLID_API_KEY });

// All clients overview
app.get('/clients', async (req, res) => {
  const companies = await solid.companies.list();
  res.json(companies.data);
});

// Client health check
app.get('/clients/:id/health', async (req, res) => {
  solid.switchCompany(parseInt(req.params.id));
  const [health, agents] = await Promise.all([
    solid.health.check(),
    solid.agents.list(),
  ]);
  res.json({ health: health.data, agents: agents.data });
});

// Bulk KB update across all clients
app.post('/bulk/kb', express.json(), async (req, res) => {
  const companies = await solid.companies.list();
  const results = [];
  for (const c of companies.data.companies) {
    solid.switchCompany(c.id);
    const result = await solid.kb.create(req.body).catch(e => ({ error: e.message }));
    results.push({ company: c.name, result });
  }
  res.json(results);
});

app.listen(3000, () => console.log('Agency dashboard on :3000'));
`,
      '.env.example': `SOLID_API_KEY=sk_solid_your_key_here
`,
      'README.md': `# {{name}} — Agency Dashboard

Manage all your Solid# client companies from one place.

## Features
- View all clients at a glance
- Per-client health monitoring
- Bulk KB updates across all clients
- Revenue tracking per client
`,
    },
  },
};

export const initCommand = new Command('init')
  .description('Scaffold a new app on Solid# infrastructure')
  .argument('<name>', 'Project name')
  .option('-t, --type <type>', 'App type (basic, marketplace, saas, agency-dashboard)', 'basic')
  .option('--list', 'List available app types')
  .action(async (name, options) => {
    if (options.list) {
      console.log('');
      console.log(ui.header('App Templates'));
      console.log('');
      for (const [key, tmpl] of Object.entries(APP_TYPES)) {
        console.log(`  ${chalk.bold.cyan(key.padEnd(20))} ${tmpl.name}`);
        console.log(`  ${' '.repeat(20)} ${chalk.dim(tmpl.description)}`);
      }
      console.log('');
      console.log(chalk.dim('  Usage: solid init my-app --type marketplace'));
      console.log('');
      return;
    }

    const appType = APP_TYPES[options.type];
    if (!appType) {
      console.error(chalk.red(`Unknown type: ${options.type}`));
      console.log(chalk.dim(`  Available: ${Object.keys(APP_TYPES).join(', ')}`));
      process.exit(1);
    }

    const projectDir = path.resolve(name);

    if (fs.existsSync(projectDir)) {
      console.error(chalk.red(`Directory already exists: ${projectDir}`));
      process.exit(1);
    }

    const ora = (await import('ora')).default;
    const spinner = ora(`Scaffolding ${appType.name}...`).start();

    fs.mkdirSync(projectDir, { recursive: true });

    for (const [filename, content] of Object.entries(appType.files)) {
      const filePath = path.join(projectDir, filename);
      const rendered = content.replace(/\{\{name\}\}/g, name);
      fs.writeFileSync(filePath, rendered);
    }

    // Copy .gitignore
    fs.writeFileSync(path.join(projectDir, '.gitignore'), 'node_modules/\n.env\ndist/\n');

    // Generate CLAUDE.md for AI context
    const claudeMd = `# ${name}

Built on [Solid#](https://solidnumber.com) infrastructure.

## Architecture
- Backend: Solid# API (${config.apiUrl || 'https://api.solidnumber.com'})
- SDK: @solidnumber/sdk
- Type: ${appType.name}

## API Key
Set \`SOLID_API_KEY\` in \`.env\`. Create one with:
\`\`\`bash
solid auth token create -n "${name}" -s "crm:read,pages:read,kb:read,agents:read"
\`\`\`

## Solid# Resources
- API Docs: https://solidnumber.com/docs/api
- SDK Docs: https://solidnumber.com/docs/sdks
- CLI: npm i -g @solidnumber/cli
`;
    fs.writeFileSync(path.join(projectDir, 'CLAUDE.md'), claudeMd);

    spinner.succeed(chalk.green(`${appType.name} scaffolded`));
    console.log('');
    console.log(`  ${chalk.bold('Project:')}  ${name}`);
    console.log(`  ${chalk.bold('Type:')}     ${appType.name}`);
    console.log(`  ${chalk.bold('Path:')}     ${projectDir}`);
    console.log('');

    const files = Object.keys(appType.files);
    for (const f of files) {
      console.log(chalk.dim(`    ${f}`));
    }
    console.log(chalk.dim('    .gitignore'));
    console.log(chalk.dim('    CLAUDE.md'));
    console.log('');

    console.log(chalk.bold('  Next steps:'));
    console.log(`  ${chalk.cyan(`cd ${name}`)}`);
    console.log(`  ${chalk.cyan('npm install')}`);
    console.log(`  ${chalk.cyan('cp .env.example .env')}  ${chalk.dim('← add your API key')}`);
    console.log(`  ${chalk.cyan('npm start')}`);
    console.log('');
  });
