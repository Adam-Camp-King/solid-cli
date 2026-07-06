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

Multi-tenant SaaS where each customer gets a full Solid# business — AI that answers, books, and takes payment, plus CRM, website, and the rest.

## How it works
- \`POST /signup\` creates a Solid# company + applies industry template
- Each customer gets: AI agents, CRM, website, booking, payments
- You build the custom UI, Solid# handles the infrastructure

## What you DON'T have to build
- Auth & multi-tenancy (530 tables with RLS)
- Payment processing (Stripe wired)
- The AI workforce (Sarah, Marcus, ADA, and the rest — plus SmartRouter and CognitiveLimiter under the hood)
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

// ---------------------------------------------------------------------------
// Starter-kit layer — the tenant stamp + operating rules + connector wiring
// that turn a bare template into a project bound to ONE business (company_id).
// Kept as pure builders so the real output is unit-tested, not simulated.
// ---------------------------------------------------------------------------

/** Bumped when the scaffold's shape changes; recorded in .solid/config.json. */
export const STARTER_VERSION = '1.0.0';

const DEFAULT_API_URL = 'https://api.solidnumber.com';
const DEFAULT_CONNECTOR_URL = 'https://api.solidnumber.com/mcp/connector';

export interface StarterContext {
  name: string;
  type: string;
  typeLabel: string;
  companyId: number | null;
  apiUrl: string;
  connectorUrl: string;
}

/**
 * The operating-rules CLAUDE.md — the sleeper feature. Every local AI session
 * that opens this project inherits the SAME discipline the Solid# connector runs
 * by (`_OPERATING_RULES` in solid-backend), so client work grounds and persists
 * instead of hallucinating and evaporating. Keep these five in parity with the
 * backend contract.
 */
export function renderStarterClaudeMd(ctx: StarterContext): string {
  const cid = ctx.companyId != null ? String(ctx.companyId) : '<set in .solid/config.json>';
  return `# ${ctx.name}

This project was scaffolded by Solid# for **company_id ${cid}** and is bound to that one
business. It builds ON Solid# infrastructure — the same CRM, brand, knowledge base, pages,
and AI the company already runs — reached through the Solid# connector.

> Your source lives in YOUR git. Solid#'s platform is never handed to you. The only Solid#
> credential in this project is a scoped token in \`.env\` that can touch company_id ${cid}
> and nothing else. It is gitignored — never commit it.

## Operating rules — how to work in this project

You are an AI building for a real business. Nothing you make here is throwaway. Follow these
five rules; they are the same rules the Solid# connector runs by.

1. **Ground, don't guess.** Write only facts that come from a Solid# tool result (company
   profile, brand truth, knowledge base). Never invent a partner, payment processor,
   certification, price, award, or year in business. If it isn't in a tool result, say you
   don't have it and ask the owner.

2. **Persist everything — nothing is session-ephemeral.** Every design, brand decision, page,
   and durable fact must be WRITTEN BACK to company_id ${cid} through the connector
   (\`set_brand_truth\`, \`set_capability\`, \`edit_page_content\`, \`add_memory\`, …). Generating a
   preview is NOT persisting: if you generate and don't commit, the work evaporates and the
   business is left exactly as un-changed as before.

3. **Preview → confirm → written.** Solid# write tools preview by default; call again with
   \`confirm=true\` to commit. Money and irreversible actions also need the owner to type the
   approval phrase. Every write is auditable and reversible (\`list_changes\` / \`approve_change\`
   / \`rollback_change\`).

4. **Close the grounding gaps first.** If the company's brand/positioning is unconfigured, do
   NOT write public copy yet — ask the owner the grounding questions and persist each answer
   with \`set_brand_truth\` / \`set_capability\`.

5. **Leave a handoff.** Open every Solid# session with \`start_here\` (it orients you to this
   business) and close it with \`end_session\` (it persists what you did and what's next), so
   the next session — and the owner — continue from where you stopped instead of starting cold.

## The connector

- Connector URL: ${ctx.connectorUrl}
- Bound company_id: ${cid}
- Config: \`.solid/config.json\`

**Call \`start_here\` before you build. Call \`end_session\` when you finish.**

## Deploy

Your build deploys back to THIS company's own slot (keyed by company_id ${cid}) — never to a
shared or wrong place:

\`\`\`bash
solid deploy
\`\`\`

## Resources
- CLI: \`npm i -g @solidnumber/cli\`
- Docs: https://solidnumber.com/docs
- App type: ${ctx.typeLabel}
`;
}

/** The tenant stamp — who this project is, so every tool call is scoped right. */
export function renderSolidConfig(ctx: StarterContext): string {
  return JSON.stringify(
    {
      companyId: ctx.companyId,
      connectorUrl: ctx.connectorUrl,
      apiUrl: ctx.apiUrl,
      appType: ctx.type,
      starterVersion: STARTER_VERSION,
      createdWith: '@solidnumber/cli',
    },
    null,
    2,
  ) + '\n';
}

/**
 * Build EVERY file the starter lands on the client's drive — template files plus
 * the starter-kit layer (CLAUDE.md operating rules, .solid/config.json tenant
 * stamp, token-safe .gitignore, tenant-stamped .env.example). Pure → testable.
 */
export function buildStarterFiles(ctx: StarterContext): Record<string, string> {
  const appType = APP_TYPES[ctx.type];
  const files: Record<string, string> = {};

  // 1. Template files, {{name}}-rendered.
  for (const [filename, content] of Object.entries(appType.files)) {
    files[filename] = content.replace(/\{\{name\}\}/g, ctx.name);
  }

  // 2. Tenant stamp — the scoped token slot + bound company_id. Never a real secret.
  const cidEnv = ctx.companyId != null ? String(ctx.companyId) : '';
  files['.env.example'] =
    `# Scoped Solid# token — can touch company_id ${cidEnv || '<yours>'} ONLY.\n` +
    `# Get one: solid auth token create -n "${ctx.name}"\n` +
    `# Copy this file to .env and fill it in. NEVER commit .env.\n` +
    `SOLID_TOKEN=\n` +
    `SOLID_COMPANY_ID=${cidEnv}\n`;

  // 3. Config, CLAUDE.md, .gitignore (token-safe).
  files['.solid/config.json'] = renderSolidConfig(ctx);
  files['CLAUDE.md'] = renderStarterClaudeMd(ctx);
  files['.gitignore'] = ['node_modules/', 'dist/', '.env', '.env.local', '.solid/token', '*.log', ''].join('\n');

  return files;
}

export const initCommand = new Command('init')
  .description('Scaffold a LOCAL starter project bound to one Solid# company (tenant-stamped, operating-rules + connector wired). Does NOT create a company; use `solid company create` or `solid demo create` for that.')
  .argument('<name>', 'Project name')
  .option('-t, --type <type>', 'App type (basic, marketplace, saas, agency-dashboard)', 'basic')
  .option('-c, --company <id>', 'Bind the project to this Solid# company_id (tenant stamp)')
  .option('--no-git', 'Skip initializing a local git repo for the project')
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

    // Resolve the tenant stamp: --company > stored config > env > unset.
    const rawCompany = options.company
      ?? (config as any).companyId
      ?? process.env.SOLID_COMPANY_ID;
    const hasCompany = rawCompany != null && String(rawCompany).trim() !== '';
    const companyId = hasCompany ? parseInt(String(rawCompany), 10) : null;
    if (hasCompany && Number.isNaN(companyId)) {
      console.error(chalk.red(`Invalid --company id: ${rawCompany}`));
      process.exit(1);
    }

    const ctx: StarterContext = {
      name,
      type: options.type,
      typeLabel: appType.name,
      companyId,
      apiUrl: config.apiUrl || DEFAULT_API_URL,
      connectorUrl: DEFAULT_CONNECTOR_URL,
    };

    fs.mkdirSync(projectDir, { recursive: true });
    const files = buildStarterFiles(ctx);
    for (const [filename, content] of Object.entries(files)) {
      const filePath = path.join(projectDir, filename);
      fs.mkdirSync(path.dirname(filePath), { recursive: true });  // nested .solid/
      fs.writeFileSync(filePath, content);
    }

    // The client's OWN git — their source, their repo, never ours. --no-git opts out.
    let gitInitialized = false;
    if (options.git !== false) {
      try {
        const { execFileSync } = await import('node:child_process');
        const gopts = { cwd: projectDir, stdio: 'ignore' as const };
        execFileSync('git', ['init', '-q'], gopts);
        execFileSync('git', ['add', '-A'], gopts);
        execFileSync('git', ['commit', '-q', '-m',
          `chore: scaffold ${name} (Solid# starter${companyId != null ? `, company ${companyId}` : ''})`], gopts);
        gitInitialized = true;
      } catch {
        // git absent, or commit blocked (no identity) — non-fatal.
      }
    }

    spinner.succeed(chalk.green(`${appType.name} scaffolded`));
    console.log('');
    console.log(`  ${chalk.bold('Project:')}    ${name}`);
    console.log(`  ${chalk.bold('Type:')}       ${appType.name}`);
    console.log(`  ${chalk.bold('Company:')}    ${companyId != null ? companyId : chalk.yellow('unset — add it to .solid/config.json')}`);
    console.log(`  ${chalk.bold('Path:')}       ${projectDir}`);
    console.log('');

    for (const f of Object.keys(files).sort()) {
      console.log(chalk.dim(`    ${f}`));
    }
    console.log('');
    console.log(gitInitialized
      ? chalk.dim('  ✓ git initialized — your source, your git (Solid# is never in it)')
      : chalk.dim('  (no git repo — run `git init` yourself, or drop --no-git)'));
    console.log('');

    console.log(chalk.bold('  Next steps:'));
    console.log(`  ${chalk.cyan(`cd ${name}`)}`);
    console.log(`  ${chalk.cyan('npm install')}`);
    console.log(`  ${chalk.cyan('cp .env.example .env')}  ${chalk.dim('← add your scoped token')}`);
    console.log(`  ${chalk.dim('Open in Claude Code — CLAUDE.md carries the operating rules; call start_here first.')}`);
    console.log('');
  });

import { appendExamples as __ae_init } from '../lib/command-kit';
__ae_init(initCommand, [
  { cmd: 'solid init',                  why: 'Scaffold local app boilerplate (local-only, no cloud)' },
  { cmd: 'solid init --type nextjs',    why: 'Specific template' },
  { cmd: 'solid init --list',           why: 'Available templates' },
]);
