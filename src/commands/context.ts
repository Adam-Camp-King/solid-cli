/**
 * Context command for Solid CLI
 *
 * Generates a complete AI context package (SOLID-CONTEXT.md) that any AI
 * (Claude, GPT, Cursor, Windsurf, etc.) can ingest to understand
 * the Solid# platform and this specific company.
 *
 * Usage:
 *   solid context                    # Print to stdout
 *   solid context > SOLID-CONTEXT.md # Save to file
 *   solid context --clipboard        # Copy to clipboard
 *   solid context --save             # Save to ./SOLID-CONTEXT.md
 *   solid context --claude           # Save to ./.claude/CLAUDE.md
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';
import { apiClient, handleApiError } from '../lib/api-client';
import { ui } from '../lib/ui';

interface CompanyData {
  name: string;
  slug: string;
  industry: string;
  tier: string;
  contact_phone?: string;
  contact_email?: string;
  location?: string;
  business_hours?: Record<string, unknown>;
  website_settings?: Record<string, unknown>;
}

interface KBEntry {
  id: number;
  title: string;
  category: string;
  content: string;
}

interface ServiceItem {
  title: string;
  slug: string;
  description?: string;
  price?: number;
  currency?: string;
  duration_minutes?: number;
}

interface PageItem {
  id: number;
  title: string;
  slug: string;
  is_published: boolean;
  page_type?: string;
}

interface AgentItem {
  agent_type: string;
  name: string;
  description: string;
  autonomy_level: number;
  tool_count: number;
}

export const contextCommand = new Command('context')
  .description('Generate AI context package for this company')
  .option('--save', 'Save to ./SOLID-CONTEXT.md')
  .option('--claude', 'Save to ./.claude/CLAUDE.md (for Claude Code)')
  .option('--cursor', 'Save to ./.cursorrules (for Cursor)')
  .option('--json', 'Output as JSON instead of markdown')
  .option('--minimal', 'Compact version (no command reference)')
  .option('--watch', 'Auto-refresh context file when data changes')
  .option('--interval <seconds>', 'Watch interval in seconds (default: 30)', '30')
  .action(async (options) => {
    if (!config.isLoggedIn()) {
      console.error(chalk.red('Not logged in. Run `solid auth login` first.'));
      process.exit(1);
    }

    const companyId = config.companyId;
    if (!companyId) {
      console.error(chalk.red('No company selected. Run `solid auth login` first.'));
      process.exit(1);
    }

    const isSaving = options.save || options.claude || options.cursor;
    const spinner = isSaving ? ora('Building AI context package...').start() : null;

    // Gather all data in parallel
    const [companyResult, kbResult, pagesResult, servicesResult, productsResult, agentsResult] =
      await Promise.allSettled([
        apiClient.companyInfo(),
        apiClient.kbSearch('', 100),
        apiClient.pagesList(),
        apiClient.servicesList(),
        apiClient.productsList(),
        apiClient.agentsList(),
      ]);

    // Extract data safely
    const company: CompanyData | null =
      companyResult.status === 'fulfilled'
        ? ((companyResult.value.data as Record<string, any>).company as CompanyData)
        : null;

    const kbEntries: KBEntry[] =
      kbResult.status === 'fulfilled'
        ? ((kbResult.value.data as Record<string, any>).results || [])
        : [];

    const pages: PageItem[] =
      pagesResult.status === 'fulfilled'
        ? ((pagesResult.value.data as Record<string, any>).pages || [])
        : [];

    const services: ServiceItem[] =
      servicesResult.status === 'fulfilled'
        ? ((servicesResult.value.data as Record<string, any>).items || [])
        : [];

    const products: any[] =
      productsResult.status === 'fulfilled'
        ? ((productsResult.value.data as Record<string, any>).items || [])
        : [];

    const agents: AgentItem[] =
      agentsResult.status === 'fulfilled'
        ? ((agentsResult.value.data as Record<string, any>).agents || [])
        : [];

    if (!company) {
      if (spinner) spinner.fail(chalk.red('Failed to load company data'));
      else console.error(chalk.red('Failed to load company data'));
      process.exit(1);
    }

    // Build the context document
    const doc = options.json
      ? buildJsonContext(company, companyId, kbEntries, pages, services, products, agents)
      : buildMarkdownContext(company, companyId, kbEntries, pages, services, products, agents, !!options.minimal);

    // Determine output file path
    let outputPath: string | null = null;
    let outputMode: string = 'stdout';

    if (options.claude) {
      const claudeDir = path.resolve('.claude');
      if (!fs.existsSync(claudeDir)) {
        fs.mkdirSync(claudeDir, { recursive: true });
      }
      outputPath = path.join(claudeDir, 'CLAUDE.md');
      outputMode = 'claude';
    } else if (options.cursor) {
      outputPath = path.resolve('.cursorrules');
      outputMode = 'cursor';
    } else if (options.save || options.watch) {
      outputPath = path.resolve('SOLID-CONTEXT.md');
      outputMode = 'file';
    }

    // Write output
    if (outputPath) {
      fs.writeFileSync(outputPath, doc);
      spinner?.succeed(chalk.green(`Saved to ${outputPath}`));
      printNextSteps(outputMode, company.name);
    } else {
      process.stdout.write(doc);
    }

    // Watch mode — re-generate on interval
    if (options.watch && outputPath) {
      const intervalSec = Math.max(10, parseInt(options.interval) || 30);
      let lastHash = simpleHash(doc);

      console.log(chalk.dim(`  Watching for changes every ${intervalSec}s... (Ctrl+C to stop)`));
      console.log('');

      const tick = async () => {
        try {
          const [compRes, kbRes, pgRes, svcRes, prodRes, agRes] =
            await Promise.allSettled([
              apiClient.companyInfo(),
              apiClient.kbSearch('', 100),
              apiClient.pagesList(),
              apiClient.servicesList(),
              apiClient.productsList(),
              apiClient.agentsList(),
            ]);

          const co = compRes.status === 'fulfilled' ? ((compRes.value.data as Record<string, any>).company as CompanyData) : null;
          if (!co) return;

          const freshDoc = options.json
            ? buildJsonContext(co, companyId!, kbRes.status === 'fulfilled' ? ((kbRes.value.data as Record<string, any>).results || []) : [],
                pgRes.status === 'fulfilled' ? ((pgRes.value.data as Record<string, any>).pages || []) : [],
                svcRes.status === 'fulfilled' ? ((svcRes.value.data as Record<string, any>).items || []) : [],
                prodRes.status === 'fulfilled' ? ((prodRes.value.data as Record<string, any>).items || []) : [],
                agRes.status === 'fulfilled' ? ((agRes.value.data as Record<string, any>).agents || []) : [])
            : buildMarkdownContext(co, companyId!, kbRes.status === 'fulfilled' ? ((kbRes.value.data as Record<string, any>).results || []) : [],
                pgRes.status === 'fulfilled' ? ((pgRes.value.data as Record<string, any>).pages || []) : [],
                svcRes.status === 'fulfilled' ? ((svcRes.value.data as Record<string, any>).items || []) : [],
                prodRes.status === 'fulfilled' ? ((prodRes.value.data as Record<string, any>).items || []) : [],
                agRes.status === 'fulfilled' ? ((agRes.value.data as Record<string, any>).agents || []) : [], !!options.minimal);

          const newHash = simpleHash(freshDoc);
          if (newHash !== lastHash) {
            fs.writeFileSync(outputPath!, freshDoc);
            lastHash = newHash;
            const time = new Date().toLocaleTimeString();
            console.log(chalk.green(`  [${time}] Context updated — changes detected`));
          }
        } catch {
          // Silently skip failed polls
        }
      };

      setInterval(tick, intervalSec * 1000);

      // Keep process alive
      await new Promise(() => {});
    }
  });

function printNextSteps(mode: string, companyName: string): void {
  console.log('');
  const lines: string[] = [
    `${chalk.dim('Company:')}  ${companyName}`,
    `${chalk.dim('Updated:')} ${new Date().toISOString().split('T')[0]}`,
    '',
  ];

  if (mode === 'claude') {
    lines.push(`${chalk.dim('Claude Code will auto-read .claude/CLAUDE.md')}`);
    lines.push(`${chalk.dim('Run')} ${chalk.cyan('solid context --claude')} ${chalk.dim('again to refresh')}`);
  } else if (mode === 'cursor') {
    lines.push(`${chalk.dim('Cursor will auto-read .cursorrules')}`);
    lines.push(`${chalk.dim('Run')} ${chalk.cyan('solid context --cursor')} ${chalk.dim('again to refresh')}`);
  } else {
    lines.push(`${chalk.dim('Paste into any AI project context, or:')}`)
    lines.push(`  ${chalk.cyan('solid context --claude')}   ${chalk.dim('→ .claude/CLAUDE.md')}`);
    lines.push(`  ${chalk.cyan('solid context --cursor')}   ${chalk.dim('→ .cursorrules')}`);
  }

  console.log(ui.successBox('AI Context Ready', lines));
  console.log('');
}

function buildJsonContext(
  company: CompanyData,
  companyId: number,
  kb: KBEntry[],
  pages: PageItem[],
  services: ServiceItem[],
  products: any[],
  agents: AgentItem[],
): string {
  return JSON.stringify({
    platform: 'solid',
    version: '1.0',
    generated_at: new Date().toISOString(),
    company: {
      id: companyId,
      name: company.name,
      slug: company.slug,
      industry: company.industry,
      tier: company.tier,
      phone: company.contact_phone,
      email: company.contact_email,
      address: company.location,
      hours: company.business_hours,
    },
    knowledge_base: kb.map((e) => ({ title: e.title, category: e.category, content: e.content })),
    pages: pages.map((p) => ({ title: p.title, slug: p.slug, published: p.is_published })),
    services: services.map((s) => ({ title: s.title, slug: s.slug, price: s.price, duration: s.duration_minutes })),
    products: products.map((p) => ({ name: p.name, category: p.category, price: p.price })),
    agents: agents.map((a) => ({ name: a.name, type: a.agent_type, description: a.description })),
    api_base: config.apiUrl,
    cli_version: '1.3.1',
  }, null, 2);
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return hash;
}

function buildMarkdownContext(
  company: CompanyData,
  companyId: number,
  kb: KBEntry[],
  pages: PageItem[],
  services: ServiceItem[],
  products: any[],
  agents: AgentItem[],
  minimal: boolean,
): string {
  const lines: string[] = [];

  // Header
  lines.push(`# Solid# AI Context — ${company.name}`);
  lines.push('');
  lines.push(`> Auto-generated by \`solid context\` on ${new Date().toISOString().split('T')[0]}`);
  lines.push(`> Run \`solid context --save\` to refresh this file.`);
  lines.push('');

  // Platform overview
  lines.push('## Platform');
  lines.push('');
  lines.push('Solid# is AI Business Infrastructure. You are working on a business that runs on the Solid# platform.');
  lines.push('The platform provides: CMS/website builder, CRM, booking, invoicing, AI agents, voice AI, and knowledge base management.');
  lines.push('Everything is multi-tenant — all operations are scoped to this company.');
  lines.push('');

  // Company
  lines.push('## This Company');
  lines.push('');
  lines.push(`| Field | Value |`);
  lines.push(`|-------|-------|`);
  lines.push(`| **Name** | ${company.name} |`);
  lines.push(`| **ID** | ${companyId} |`);
  lines.push(`| **Slug** | ${company.slug || 'not set'} |`);
  lines.push(`| **Industry** | ${company.industry || 'not set'} |`);
  lines.push(`| **Tier** | ${company.tier || 'starter'} |`);
  if (company.contact_phone) lines.push(`| **Phone** | ${company.contact_phone} |`);
  if (company.contact_email) lines.push(`| **Email** | ${company.contact_email} |`);
  if (company.location) lines.push(`| **Address** | ${company.location} |`);
  lines.push('');

  if (company.business_hours && Object.keys(company.business_hours).length > 0) {
    lines.push('### Business Hours');
    lines.push('');
    lines.push('```json');
    lines.push(JSON.stringify(company.business_hours, null, 2));
    lines.push('```');
    lines.push('');
  }

  // Knowledge Base
  if (kb.length > 0) {
    lines.push('## Knowledge Base');
    lines.push('');
    lines.push(`This company has ${kb.length} KB entries. The AI agents use these to answer questions and make decisions.`);
    lines.push('');

    // Group by category
    const byCategory: Record<string, KBEntry[]> = {};
    for (const entry of kb) {
      const cat = entry.category || 'general';
      if (!byCategory[cat]) byCategory[cat] = [];
      byCategory[cat].push(entry);
    }

    for (const [category, entries] of Object.entries(byCategory)) {
      lines.push(`### ${category}`);
      lines.push('');
      for (const entry of entries) {
        lines.push(`**${entry.title}**`);
        // Truncate very long content for context efficiency
        const content = entry.content || '';
        if (content.length > 500) {
          lines.push(content.substring(0, 500) + '...');
          lines.push(`*(${content.length} chars total — use \`solid kb get ${entry.id}\` for full text)*`);
        } else {
          lines.push(content);
        }
        lines.push('');
      }
    }
  }

  // Pages
  if (pages.length > 0) {
    lines.push('## Website Pages');
    lines.push('');
    lines.push('| Page | Slug | Published |');
    lines.push('|------|------|-----------|');
    for (const page of pages) {
      lines.push(`| ${page.title} | /${page.slug} | ${page.is_published ? 'Yes' : 'No'} |`);
    }
    lines.push('');
  }

  // Services
  if (services.length > 0) {
    lines.push('## Services');
    lines.push('');
    lines.push('| Service | Price | Duration |');
    lines.push('|---------|-------|----------|');
    for (const svc of services) {
      const price = svc.price ? `$${svc.price}` : 'Quote';
      const duration = svc.duration_minutes ? `${svc.duration_minutes} min` : '-';
      lines.push(`| ${svc.title} | ${price} | ${duration} |`);
    }
    lines.push('');
  }

  // Products
  if (products.length > 0) {
    lines.push('## Products');
    lines.push('');
    lines.push('| Product | Category | Price |');
    lines.push('|---------|----------|-------|');
    for (const prod of products) {
      lines.push(`| ${prod.name} | ${prod.category || '-'} | ${prod.price ? '$' + prod.price : '-'} |`);
    }
    lines.push('');
  }

  // Agents
  if (agents.length > 0) {
    lines.push('## AI Agents');
    lines.push('');
    lines.push('These AI personas work for this company:');
    lines.push('');
    for (const agent of agents) {
      lines.push(`- **${agent.name}** (${agent.agent_type}) — ${agent.description}`);
    }
    lines.push('');
  }

  // CLI Command Reference
  if (!minimal) {
    lines.push('## CLI Commands');
    lines.push('');
    lines.push('Use these commands to manage this company. All commands are scoped to the current company automatically.');
    lines.push('');

    lines.push('### Core Workflow');
    lines.push('```bash');
    lines.push('solid pull                    # Download pages, KB, services, products as local files');
    lines.push('solid push                    # Push local changes back to Solid#');
    lines.push('solid push --dry-run          # Preview what would change (ALWAYS do this first)');
    lines.push('solid status                  # Show company overview');
    lines.push('```');
    lines.push('');

    lines.push('### Knowledge Base');
    lines.push('```bash');
    lines.push('solid kb list                 # List all KB entries');
    lines.push('solid kb search "plumbing"    # Search KB');
    lines.push('solid kb create               # Create new KB entry');
    lines.push('solid kb delete <id>          # Delete KB entry');
    lines.push('```');
    lines.push('');

    lines.push('### Website Pages');
    lines.push('```bash');
    lines.push('solid pages list              # List all pages');
    lines.push('solid pages publish <id>      # Publish a page');
    lines.push('solid vibe "add a hero..."    # Natural language page edits');
    lines.push('```');
    lines.push('');

    lines.push('### AI Agents');
    lines.push('```bash');
    lines.push('solid train chat sarah        # Chat with Sarah (customer service)');
    lines.push('solid train chat marcus       # Chat with Marcus (growth)');
    lines.push('solid agent dashboard         # Agent overview + telemetry');
    lines.push('solid agent soul sarah        # View agent identity and config');
    lines.push('solid agent mission "..."     # Multi-agent mission');
    lines.push('```');
    lines.push('');

    lines.push('### CRM & Operations');
    lines.push('```bash');
    lines.push('solid crm contacts            # View contacts');
    lines.push('solid crm deals               # View deals/pipeline');
    lines.push('solid inbox                   # Unified inbox');
    lines.push('solid schedule list           # Appointments');
    lines.push('solid voice calls             # Call logs');
    lines.push('solid reports revenue          # Revenue analytics');
    lines.push('```');
    lines.push('');

    lines.push('### Content & Commerce');
    lines.push('```bash');
    lines.push('solid blog list               # Blog posts');
    lines.push('solid brand get               # Brand identity');
    lines.push('solid services list           # Service catalog');
    lines.push('solid inventory list          # Inventory');
    lines.push('solid payment list            # Payment history');
    lines.push('```');
    lines.push('');

    lines.push('### Multi-Company (Agencies)');
    lines.push('```bash');
    lines.push('solid company list            # List all companies you manage');
    lines.push('solid switch <id or name>     # Switch to another company');
    lines.push('solid company create "Name" --template plumber  # New client from template');
    lines.push('```');
    lines.push('');

    lines.push('### API Access');
    lines.push('```bash');
    lines.push('# For CI/CD or AI agent integration:');
    lines.push('export SOLID_API_KEY=your_api_key_here');
    lines.push('solid status  # Now uses API key instead of login token');
    lines.push('```');
    lines.push('');
  }

  // File structure
  lines.push('## Local File Structure');
  lines.push('');
  lines.push('After running `solid pull`, your directory looks like:');
  lines.push('');
  lines.push('```');
  lines.push('├── solid.config.json        # Company settings (name, industry, tier, hours)');
  lines.push('├── pages/');
  lines.push('│   ├── home.json            # Page layout (title, slug, layout_json, is_published)');
  lines.push('│   └── about.json');
  lines.push('├── kb/');
  lines.push('│   ├── services.md          # KB entry (YAML frontmatter + markdown content)');
  lines.push('│   └── faq.md');
  lines.push('├── services/');
  lines.push('│   └── plumbing.json        # Service (title, price, duration_minutes)');
  lines.push('├── products/');
  lines.push('│   └── widget.json          # Product (name, price, category)');
  lines.push('└── .solid/');
  lines.push('    └── manifest.json        # Sync metadata (DO NOT EDIT)');
  lines.push('```');
  lines.push('');

  // Rules
  lines.push('## Rules');
  lines.push('');
  lines.push('1. **Always `solid push --dry-run` before `solid push`** — preview changes before deploying');
  lines.push('2. **Never edit `.solid/manifest.json`** — this tracks sync state');
  lines.push('3. **KB entries are markdown** with YAML frontmatter (id, title, category)');
  lines.push('4. **Pages are JSON** with `layout_json` containing the page builder blocks');
  lines.push('5. **All data is scoped to this company** — you cannot accidentally affect other businesses');
  lines.push('6. **To refresh this context**, run `solid context --save` (or `--claude` / `--cursor`)');
  lines.push('');

  // API info
  lines.push('## API');
  lines.push('');
  lines.push(`- **Base URL:** ${config.apiUrl}`);
  lines.push(`- **Auth:** Bearer token (via \`solid auth login\`) or \`SOLID_API_KEY\` env var`);
  lines.push(`- **Company scope:** All requests include \`X-Company-ID: ${companyId}\` header`);
  lines.push('');

  return lines.join('\n');
}
