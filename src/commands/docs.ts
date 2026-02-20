/**
 * Docs command for Solid CLI
 *
 * Pulls developer documentation into the local project:
 *   ./docs/getting-started.md    — Quick start guide
 *   ./docs/api-reference.md      — API endpoints available to your company
 *   ./docs/blocks-reference.md   — CMS block types and props
 *   ./docs/kb-guide.md           — Knowledge base + AI training guide
 *   ./docs/vibe-guide.md         — Vibe natural language commands
 *   ./docs/cli-reference.md      — CLI command reference
 *
 * These are public docs — no proprietary code or internal architecture.
 * They teach developers/agencies how to build on Solid#.
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const DOCS: Record<string, { filename: string; title: string; content: string }> = {
  'getting-started': {
    filename: 'getting-started.md',
    title: 'Getting Started with Solid#',
    content: `---
title: Getting Started with Solid#
topic: developer-guide
---

# Getting Started with Solid#

Welcome to Solid# — AI Business Infrastructure. This guide will get you building in minutes.

## Quick Start

\`\`\`bash
# Install the CLI
npm install -g @solidnumber/cli

# Login to your company
solid auth login

# Pull your business data as local files
solid pull

# Edit files with your editor (VS Code, Cursor, etc.)
# Then push changes back
solid push
\`\`\`

## Project Structure

After \`solid pull\`, your directory looks like this:

\`\`\`
my-business/
├── pages/              # CMS page layouts (JSON)
│   ├── home.json
│   ├── about.json
│   └── services.json
├── kb/                 # Knowledge base entries (Markdown)
│   ├── welcome.md
│   ├── services-overview.md
│   └── faq.md
├── services/           # Service catalog (JSON, read-only)
│   └── consultation.json
├── products/           # Product catalog (JSON, read-only)
│   └── starter-kit.json
├── docs/               # Developer documentation (this!)
├── solid.config.json   # Company settings + website config
└── .solid/
    └── manifest.json   # Sync metadata (do not edit)
\`\`\`

## Editing Pages

Each page is a JSON file with a \`layout_json\` object containing sections:

\`\`\`json
{
  "_id": 42,
  "title": "Home",
  "slug": "home",
  "is_published": true,
  "layout_json": {
    "sections": [
      {
        "type": "hero",
        "props": {
          "headline": "Welcome to Our Business",
          "subheadline": "We make great things happen",
          "ctaText": "Get Started",
          "ctaLink": "/contact"
        }
      }
    ]
  }
}
\`\`\`

Edit the sections, save, then \`solid push\` to deploy.

## Editing Knowledge Base

KB entries are Markdown files with YAML frontmatter:

\`\`\`markdown
---
id: 7
title: "Our Services"
category: services
---

We offer three main services:

1. **Consultation** — 30-minute strategy session
2. **Implementation** — Full project build-out
3. **Support** — Ongoing maintenance and updates
\`\`\`

The AI agents use your KB to answer customer questions accurately.
The better your KB, the smarter your AI.

## Using Vibe (Natural Language)

Talk to your business in plain English:

\`\`\`bash
# Ask the AI to make changes
solid vibe "Add a testimonials section to the home page"
solid vibe "Update our hours to 9am-5pm Monday through Friday"
solid vibe "Create a new FAQ entry about returns policy"
\`\`\`

## Workflow

1. \`solid pull\` — Download latest from server
2. Edit files locally (VS Code, Cursor, any editor)
3. \`solid push\` — Deploy changes
4. Repeat

Your changes are live immediately after push.

## Need Help?

- \`solid status\` — Check your business setup
- \`solid health\` — Verify API connectivity
- \`solid --help\` — See all commands
`,
  },

  'api-reference': {
    filename: 'api-reference.md',
    title: 'API Reference',
    content: `---
title: Solid# API Reference
topic: developer-guide
---

# API Reference

Base URL: \`https://api.solidnumber.com\`

All endpoints require authentication via Bearer token (from \`solid auth login\`).
All data is scoped to your company_id — you can only access your own business data.

## Authentication

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | \`/api/v1/auth/login\` | Login with email + password |
| POST | \`/api/v1/auth/refresh\` | Refresh access token |
| GET | \`/api/v1/auth/me\` | Get current user info |

## CMS Pages

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/v1/cms/pages\` | List all pages |
| GET | \`/api/v1/cms/pages/:id\` | Get page with full layout_json |
| POST | \`/api/v1/cms/pages\` | Create a new page |
| PATCH | \`/api/v1/cms/pages/:id\` | Update a page |
| POST | \`/api/v1/cms/pages/:id/publish\` | Publish a page |
| POST | \`/api/v1/cms/pages/:id/unpublish\` | Unpublish a page |

## Knowledge Base

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/v1/kb/company\` | List/search KB entries |
| POST | \`/api/v1/kb/company\` | Create KB entry |
| PUT | \`/api/v1/kb/company/:id\` | Update KB entry |
| DELETE | \`/api/v1/kb/company/:id\` | Delete KB entry |

### KB Search

\`\`\`bash
GET /api/v1/kb/company?search=returns+policy&limit=20
\`\`\`

### KB Create

\`\`\`json
POST /api/v1/kb/company
{
  "title": "Returns Policy",
  "content": "We accept returns within 30 days...",
  "category": "policies"
}
\`\`\`

## Public Endpoints (No Auth Required)

These endpoints serve your public website. Pass \`company_id\` as a query param.

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/v1/cms/pages/public/:slug\` | Get published page by slug |
| GET | \`/api/v1/cms/public/services\` | List public services |
| GET | \`/api/v1/cms/public/products\` | List public products |
| GET | \`/api/v1/cms/public/promotions\` | Active promotions |
| GET | \`/api/v1/cms/public/availability\` | Available appointment slots |

## Website Settings

\`\`\`json
PATCH /api/v1/companies/:id
{
  "website_settings": {
    "primary_color": "#6366f1",
    "show_services": true,
    "show_products": true,
    "show_appointments": true,
    "show_pricing": true,
    "show_promotions": false,
    "default_locale": "en"
  }
}
\`\`\`

## AI Chat

\`\`\`json
POST /api/v1/chat/
{
  "message": "What are your business hours?",
  "agent": "sarah"
}
\`\`\`

Available agents depend on your subscription tier.

## Health Check

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | \`/api/v1/healthcheck/quick\` | Quick health check |
| GET | \`/api/v1/healthcheck/\` | Full system health |

## Rate Limits

- 100 requests per minute per company
- AI chat: governed by your tier's token budget
- File uploads: 10MB max

## Error Format

\`\`\`json
{
  "detail": "Error description",
  "status_code": 400
}
\`\`\`
`,
  },

  'blocks-reference': {
    filename: 'blocks-reference.md',
    title: 'CMS Blocks Reference',
    content: `---
title: CMS Blocks Reference
topic: developer-guide
---

# CMS Blocks Reference

Blocks are the building units of your pages. Each section in \`layout_json\` has a \`type\` and \`props\`.

## Available Blocks

### Layout & Content

| Type | Description |
|------|-------------|
| \`hero\` | Full-width hero with headline, subheadline, CTA |
| \`text\` | Rich text content section |
| \`features\` | Feature grid (icon + title + description) |
| \`stats\` | Statistics/metrics display |
| \`divider\` | Visual separator line |
| \`accordion\` | Expandable FAQ/content sections |

### Social Proof

| Type | Description |
|------|-------------|
| \`testimonials\` | Customer testimonial carousel/grid |
| \`google_reviews\` | Google reviews integration |
| \`logo_cloud\` | Partner/client logo strip |
| \`before_after\` | Before/after image comparison slider |

### Business

| Type | Description |
|------|-------------|
| \`services\` | Service catalog display |
| \`pricing\` | Pricing tiers table |
| \`team\` | Team member grid |
| \`process_steps\` | Step-by-step process flow |
| \`gallery\` | Image gallery grid |
| \`video\` | YouTube/Vimeo embed |
| \`blog_preview\` | Latest blog posts |

### Conversion

| Type | Description |
|------|-------------|
| \`contact\` | Contact form |
| \`cta\` | Call-to-action banner |
| \`booking_widget\` | Appointment booking |
| \`countdown\` | Event countdown timer |
| \`chat_widget\` | Embedded AI chat |

### Maps & Location

| Type | Description |
|------|-------------|
| \`map_embed\` | Google Maps embed |
| \`service_area\` | Service area map with regions |

## Block Props Example

### Hero Block

\`\`\`json
{
  "type": "hero",
  "props": {
    "headline": "Your Main Headline",
    "subheadline": "Supporting text goes here",
    "ctaText": "Get Started",
    "ctaLink": "/contact",
    "backgroundImage": "https://...",
    "alignment": "center",
    "overlay": true
  }
}
\`\`\`

### Features Block

\`\`\`json
{
  "type": "features",
  "props": {
    "headline": "Why Choose Us",
    "features": [
      {
        "icon": "shield",
        "title": "Reliable",
        "description": "99.9% uptime guaranteed"
      },
      {
        "icon": "zap",
        "title": "Fast",
        "description": "Average response time under 2 seconds"
      }
    ],
    "columns": 3
  }
}
\`\`\`

### Testimonials Block

\`\`\`json
{
  "type": "testimonials",
  "props": {
    "headline": "What Our Customers Say",
    "testimonials": [
      {
        "name": "Jane Smith",
        "role": "CEO, Acme Inc",
        "quote": "Incredible service!",
        "rating": 5
      }
    ],
    "layout": "grid"
  }
}
\`\`\`

### Contact Block

\`\`\`json
{
  "type": "contact",
  "props": {
    "headline": "Get In Touch",
    "fields": ["name", "email", "phone", "message"],
    "submitText": "Send Message",
    "showMap": true,
    "showPhone": true
  }
}
\`\`\`

## Adding Blocks

Add a new section to your page's \`layout_json.sections\` array:

\`\`\`json
{
  "layout_json": {
    "sections": [
      { "type": "hero", "props": { ... } },
      { "type": "features", "props": { ... } },
      { "type": "testimonials", "props": { ... } },
      { "type": "contact", "props": { ... } }
    ]
  }
}
\`\`\`

Sections render in order from top to bottom.
`,
  },

  'kb-guide': {
    filename: 'kb-guide.md',
    title: 'Knowledge Base & AI Training Guide',
    content: `---
title: Knowledge Base & AI Training Guide
topic: developer-guide
---

# Knowledge Base & AI Training Guide

Your knowledge base (KB) is how you train your AI agents. Everything your AI knows about your business comes from KB entries.

## How It Works

1. You write KB entries (services, policies, FAQ, etc.)
2. AI agents read your KB when customers ask questions
3. Better KB = smarter, more accurate AI responses

## KB File Format

KB entries are Markdown files with YAML frontmatter:

\`\`\`markdown
---
id: 7
title: "Shipping Policy"
category: policies
---

## Standard Shipping

We ship within 2-3 business days. Free shipping on orders over $50.

## Express Shipping

Next-day delivery available for $15.99.

## International

We ship to 30+ countries. Delivery in 7-14 business days.
\`\`\`

## Categories

Organize your KB by category for better AI retrieval:

| Category | What to Include |
|----------|----------------|
| \`services\` | What you offer, pricing, duration |
| \`policies\` | Returns, shipping, cancellation |
| \`faq\` | Common customer questions |
| \`about\` | Company story, mission, values |
| \`products\` | Product details, specifications |
| \`hours\` | Business hours, holidays, availability |
| \`promotions\` | Current deals, seasonal offers |
| \`general\` | Anything else |

## Training Tips

### Be Specific
\`\`\`markdown
# Bad
We have good prices.

# Good
Our basic plan starts at $29/month and includes:
- Up to 100 customers
- Email support (response within 24 hours)
- 5GB storage
\`\`\`

### Write Like You Talk
The AI will paraphrase your KB in conversation. Write naturally:

\`\`\`markdown
# Bad
The organization provides consultation services
to eligible clientele during designated hours.

# Good
We offer free 30-minute consultations Monday through
Friday, 9am to 5pm. Just call or book online!
\`\`\`

### Cover Edge Cases
Think about what customers actually ask:

\`\`\`markdown
## Do you offer refunds?
Yes! Full refund within 30 days, no questions asked.
After 30 days, we offer store credit.

## What if my order arrives damaged?
Contact us within 48 hours with a photo.
We'll send a replacement immediately — no need to return the damaged item.
\`\`\`

### Keep It Current
Outdated KB = wrong AI answers. Review monthly:
- Are prices still correct?
- Have hours changed?
- Any new services or products?
- Seasonal promotions updated?

## CLI Commands

\`\`\`bash
# Pull KB to local files
solid pull

# Edit kb/*.md files in your editor

# Push changes back
solid push

# Or manage directly:
solid kb list              # List all entries
solid kb add               # Add new entry
solid kb delete <id>       # Remove entry
\`\`\`

## The AI Agents

Your KB trains these agents (available depends on your tier):

| Agent | Role | Uses KB For |
|-------|------|-------------|
| Sarah | Customer Service | Answering questions, booking, support |
| Marcus | Growth Intelligence | Marketing copy, promotions, outreach |
| Devon | Operations | Scheduling, inventory, process flows |

The more complete your KB, the more capable each agent becomes.
`,
  },

  'vibe-guide': {
    filename: 'vibe-guide.md',
    title: 'Vibe — Natural Language Commands',
    content: `---
title: Vibe — Natural Language Commands
topic: developer-guide
---

# Vibe — Natural Language Commands

Vibe lets you modify your business using plain English. No code required.

## How It Works

1. You describe what you want in natural language
2. Solid# analyzes your intent and generates a preview
3. You confirm, and the changes are applied

## CLI Usage

\`\`\`bash
solid vibe "your instruction here"
\`\`\`

## Examples

### Pages
\`\`\`bash
solid vibe "Add a hero section to the home page with our tagline"
solid vibe "Create a new landing page for our summer sale"
solid vibe "Move the testimonials above the contact form on the about page"
\`\`\`

### Knowledge Base
\`\`\`bash
solid vibe "Add a FAQ entry about our return policy"
solid vibe "Update the business hours to close at 6pm on Fridays"
solid vibe "Create KB entries for all our services"
\`\`\`

### Settings
\`\`\`bash
solid vibe "Change the primary color to blue"
solid vibe "Enable the appointments module"
solid vibe "Set the default language to Spanish"
\`\`\`

### AI Training
\`\`\`bash
solid vibe "Train the AI to recommend our premium plan for businesses over 50 employees"
solid vibe "Add context about our new partnership with Acme Corp"
solid vibe "Update the AI personality to be more casual and friendly"
\`\`\`

## Safety

Vibe has built-in safety checks:
- **No deletion** — Vibe can create and update, but won't delete data
- **Preview first** — You always see what will change before confirming
- **Rollback** — Changes can be undone
- **Scoped** — Only affects your company, never others

## Combining with CLI

Vibe works great alongside the file-based workflow:

\`\`\`bash
# Pull your files
solid pull

# Make big structural changes in your editor
# (rearrange sections, add new pages, etc.)

# Push the structural changes
solid push

# Then use Vibe for quick tweaks
solid vibe "Update the hero headline to 'Welcome Home'"
solid vibe "Add a testimonial from John at Acme Corp"
\`\`\`
`,
  },

  'cli-reference': {
    filename: 'cli-reference.md',
    title: 'CLI Command Reference',
    content: `---
title: Solid# CLI Command Reference
topic: developer-guide
---

# CLI Command Reference

## Installation

\`\`\`bash
npm install -g @solidnumber/cli
\`\`\`

## Authentication

\`\`\`bash
solid auth login              # Login with email + password
solid auth login --token sk_solid_...  # Login with API key (CI/CD)
solid auth status             # Check login status
solid auth logout             # Clear credentials
solid auth config --show      # Show stored config
\`\`\`

### API Keys

\`\`\`bash
solid auth token create -n "CI" -s kb:read,pages:write  # Create key
solid auth token create -n "CI" -e 90                    # With 90-day expiry
solid auth token list         # List active keys
solid auth token revoke <id>  # Revoke a key
\`\`\`

Credentials are stored in \`~/.solid/config.json\`.
Your session is scoped to one company_id — you can only access your own data.

## Multi-Company (Agencies)

\`\`\`bash
solid company list            # List all your companies
solid company create "Name"   # Create a new company
solid company create "Name" --template plumber  # With industry template
solid company info            # Current company details
solid company invite dev@co.com  # Invite a developer
solid company members         # List company members
solid company members revoke <userId>  # Remove a member
solid switch                  # Interactive company picker
solid switch 15               # Switch by company ID
solid switch "Mike's Plumbing"  # Switch by name
\`\`\`

## Business Overview

\`\`\`bash
solid status                  # Full business status
solid status --json           # JSON output
\`\`\`

## Pull & Push (File Workflow)

\`\`\`bash
solid pull                    # Download all business data as files
solid pull --pages-only       # Only pull pages
solid pull --kb-only          # Only pull knowledge base
solid pull -d ./my-project    # Pull to specific directory

solid push                    # Push local changes to server
solid push --dry-run          # See what would change (no changes made)
solid push --pages-only       # Only push page changes
solid push --kb-only          # Only push KB changes
solid push --settings-only    # Only push website settings
solid push --yes              # Skip confirmation prompt
\`\`\`

## Knowledge Base

\`\`\`bash
solid kb list                 # List all KB entries
solid kb list --query "returns"  # Search entries
solid kb add                  # Add new entry (interactive)
solid kb delete <id>          # Delete an entry
\`\`\`

## Pages

\`\`\`bash
solid pages list              # List all pages
solid pages list --json       # JSON output
solid pages publish <id>      # Publish a page
solid pages unpublish <id>    # Unpublish a page
\`\`\`

## Services

\`\`\`bash
solid services list           # List service catalog
solid services list --category plumbing  # Filter by category
solid services list --json    # JSON output
\`\`\`

## AI Training

\`\`\`bash
solid train status            # KB coverage dashboard
solid train import ./docs/    # Bulk import .md files as KB
solid train import ./docs/ --dry-run  # Preview import
solid train chat              # Chat with Sarah (default agent)
solid train chat marcus       # Chat with specific agent
solid train add -t "Title" -c faq     # Quick-add KB entry
solid train add -t "Title" -f file.md # Add from file
\`\`\`

## Vibe (Natural Language)

\`\`\`bash
solid vibe "your instruction"     # Execute a natural language command
solid vibe analyze "instruction"  # Preview without applying
\`\`\`

## Integrations

\`\`\`bash
solid integrations list           # List active integrations
solid integrations catalog        # Browse available integrations
solid integrations health         # Check integration health
solid integrations generate       # Generate new integration
solid integrations test <id>      # Test an integration
solid integrations deploy <id>    # Deploy integration
solid integrations logs <id>      # View integration logs
\`\`\`

## Health & Diagnostics

\`\`\`bash
solid health                  # Quick health check
solid health --full           # Detailed system health
solid health --mcp            # MCP/agent system health
\`\`\`

## Developer Docs

\`\`\`bash
solid docs                    # Pull developer documentation
solid docs --force            # Re-download docs (overwrite)
\`\`\`

## Global Options

\`\`\`bash
--help                        # Show help for any command
--version                     # Show CLI version
\`\`\`

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| \`SOLID_API_URL\` | \`https://api.solidnumber.com\` | API base URL |
| \`SOLID_API_KEY\` | — | API key for headless auth (CI/CD, scripts) |

## Troubleshooting

**"Not logged in"** — Run \`solid auth login\`
**"No company_id"** — Your login may have expired. Re-login.
**"Company mismatch"** — You're logged in as a different company than the project. Use \`--force\` or switch directories.
**Push failed** — Check \`solid health\` to verify connectivity.
`,
  },
};

export const docsCommand = new Command('docs')
  .description('Pull developer documentation into your project')
  .option('-d, --dir <directory>', 'Project directory', '.')
  .option('--force', 'Overwrite existing docs')
  .action(async (options) => {
    const baseDir = path.resolve(options.dir);
    const docsDir = path.join(baseDir, 'docs');

    // Check if docs already exist
    if (fs.existsSync(docsDir) && !options.force) {
      const existingFiles = fs.readdirSync(docsDir).filter((f) => f.endsWith('.md'));
      if (existingFiles.length > 0) {
        console.log(chalk.yellow('  Docs already exist. Use --force to overwrite.'));
        console.log(chalk.dim(`  ${docsDir}`));
        return;
      }
    }

    const spinner = ora('Writing developer docs...').start();

    ensureDir(docsDir);

    let count = 0;
    for (const [, doc] of Object.entries(DOCS)) {
      fs.writeFileSync(path.join(docsDir, doc.filename), doc.content);
      count++;
    }

    spinner.succeed(chalk.green(`${count} docs → ./docs/`));

    console.log('');
    for (const [, doc] of Object.entries(DOCS)) {
      console.log(chalk.dim(`    docs/${doc.filename}`));
    }
    console.log('');
    console.log(chalk.bold.green('  ✓ Developer docs ready'));
    console.log(chalk.dim('    These docs teach you how to build on Solid#.'));
    console.log(chalk.dim('    They contain no proprietary code — safe to share with your team.'));
    console.log('');
  });
