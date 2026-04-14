/**
 * Import command for Solid CLI
 *
 * Converts raw HTML/JSX (from ChatGPT, v0, Bolt, etc.) into Solid# layout_json blocks.
 * Creates a new page file locally that can be previewed with `solid serve` and pushed.
 *
 * solid import landing.html --page "Summer Sale"
 * solid import --clipboard --page "Promo"
 * solid import --url https://example.com/page --page "Competitor Reference"
 * cat snippet.html | solid import --stdin --page "Quick Page"
 */

import { Command } from 'commander';
import ora from 'ora';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import { config } from '../lib/config';

// ─── HTML-to-Blocks Parser ──────────────────────────────────────────

interface Block {
  type: string;
  content: Record<string, any>;
}

function parseHtmlToBlocks(html: string): Block[] {
  const blocks: Block[] = [];

  // Strip doctype, html, head, body wrappers
  let body = html
    .replace(/<!DOCTYPE[^>]*>/i, '')
    .replace(/<html[^>]*>/gi, '').replace(/<\/html>/gi, '')
    .replace(/<head[\s\S]*?<\/head>/gi, '')
    .replace(/<body[^>]*>/gi, '').replace(/<\/body>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .trim();

  // Split into top-level sections
  const sectionRegex = /<(section|header|footer|main|article|div)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let match;
  let lastIndex = 0;
  const sections: string[] = [];

  while ((match = sectionRegex.exec(body)) !== null) {
    // Capture any text between sections
    if (match.index > lastIndex) {
      const between = body.slice(lastIndex, match.index).trim();
      if (between) sections.push(between);
    }
    sections.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  // Remaining content after last section
  if (lastIndex < body.length) {
    const remaining = body.slice(lastIndex).trim();
    if (remaining) sections.push(remaining);
  }

  // If no sections found, treat whole body as one block
  if (sections.length === 0 && body.trim()) {
    sections.push(body);
  }

  for (const section of sections) {
    const block = classifySection(section);
    if (block) blocks.push(block);
  }

  return blocks;
}

function classifySection(html: string): Block | null {
  const lower = html.toLowerCase();
  const text = stripTags(html).trim();
  if (!text && !lower.includes('<img') && !lower.includes('<video')) return null;

  // Hero detection: large heading + optional subheading + optional CTA
  if (isHero(lower)) {
    return {
      type: 'hero',
      content: {
        headline: extractFirst(html, 'h1') || extractFirst(html, 'h2') || '',
        subheadline: extractFirst(html, 'p') || '',
        cta_text: extractButtonText(html) || '',
        cta_url: extractHref(html) || '#',
      },
    };
  }

  // Pricing detection: multiple price-like elements
  if (lower.includes('pricing') || lower.includes('/mo') || lower.includes('$') && countPattern(lower, /\$\d/) >= 2) {
    return {
      type: 'pricing',
      content: {
        title: extractFirst(html, 'h2') || extractFirst(html, 'h3') || 'Pricing',
        plans: extractPricingPlans(html),
      },
    };
  }

  // FAQ detection
  if (lower.includes('faq') || lower.includes('frequently') || lower.includes('questions')) {
    return {
      type: 'faq',
      content: {
        title: extractFirst(html, 'h2') || 'FAQ',
        questions: extractFaqItems(html),
      },
    };
  }

  // Testimonials detection
  if (lower.includes('testimonial') || lower.includes('review') || lower.includes('what our') || countPattern(lower, /[""\u201c]/) >= 2) {
    return {
      type: 'testimonials',
      content: {
        title: extractFirst(html, 'h2') || 'What Our Customers Say',
        testimonials: extractTestimonials(html),
      },
    };
  }

  // Features/grid detection: multiple similar child elements
  if (lower.includes('feature') || lower.includes('benefit') || lower.includes('why choose') || countChildren(html) >= 3) {
    const items = extractRepeatingItems(html);
    if (items.length >= 3) {
      return {
        type: 'features',
        content: {
          title: extractFirst(html, 'h2') || '',
          features: items,
        },
      };
    }
  }

  // CTA detection
  if (lower.includes('get started') || lower.includes('sign up') || lower.includes('contact us') || lower.includes('book now') || lower.includes('call now')) {
    return {
      type: 'cta',
      content: {
        headline: extractFirst(html, 'h2') || extractFirst(html, 'h3') || '',
        subheadline: extractFirst(html, 'p') || '',
        cta_text: extractButtonText(html) || 'Get Started',
        cta_url: extractHref(html) || '#',
      },
    };
  }

  // Contact/form detection
  if (lower.includes('<form') || lower.includes('<input') || lower.includes('contact')) {
    return {
      type: 'contact',
      content: {
        title: extractFirst(html, 'h2') || extractFirst(html, 'h3') || 'Contact Us',
        button_text: extractButtonText(html) || 'Send Message',
      },
    };
  }

  // Stats detection: numbers
  if (countPattern(lower, /\d+[+%kKmM]/) >= 3) {
    return {
      type: 'stats',
      content: {
        stats: extractStats(html),
      },
    };
  }

  // Process/steps detection
  if (lower.includes('step') || lower.includes('process') || lower.includes('how it works')) {
    const items = extractRepeatingItems(html);
    if (items.length >= 2) {
      return {
        type: 'process-steps',
        content: {
          title: extractFirst(html, 'h2') || 'How It Works',
          steps: items,
        },
      };
    }
  }

  // Team detection
  if (lower.includes('team') || lower.includes('our people') || lower.includes('staff')) {
    return {
      type: 'team',
      content: {
        title: extractFirst(html, 'h2') || 'Our Team',
        members: extractRepeatingItems(html).map(i => ({ name: i.title, role: i.description })),
      },
    };
  }

  // Footer detection
  if (lower.includes('<footer') || lower.includes('copyright') || lower.includes('\u00a9')) {
    return null; // Skip footers — TenantShell handles this
  }

  // Navigation detection
  if (lower.includes('<nav')) {
    return null; // Skip nav — TenantShell handles this
  }

  // Default: text block
  return {
    type: 'text',
    content: {
      title: extractFirst(html, 'h2') || extractFirst(html, 'h3') || '',
      text: extractAllText(html),
    },
  };
}

// ─── Extraction helpers ─────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractFirst(html: string, tag: string): string {
  const match = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return match ? stripTags(match[1]).trim() : '';
}

function extractButtonText(html: string): string {
  const btn = html.match(/<button[^>]*>([\s\S]*?)<\/button>/i);
  if (btn) return stripTags(btn[1]).trim();
  const a = html.match(/<a[^>]*class="[^"]*btn[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
  if (a) return stripTags(a[1]).trim();
  const aAny = html.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
  if (aAny) return stripTags(aAny[1]).trim();
  return '';
}

function extractHref(html: string): string {
  const match = html.match(/href="([^"]+)"/i);
  return match ? match[1] : '#';
}

function extractAllText(html: string): string {
  // Get all paragraph and text content
  const paragraphs: string[] = [];
  const pRegex = /<p[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = pRegex.exec(html)) !== null) {
    const t = stripTags(m[1]).trim();
    if (t) paragraphs.push(t);
  }
  if (paragraphs.length > 0) return paragraphs.join('\n\n');
  return stripTags(html).slice(0, 500);
}

function countPattern(text: string, pattern: RegExp): number {
  return (text.match(new RegExp(pattern, 'g')) || []).length;
}

function countChildren(html: string): number {
  return (html.match(/<(div|li|article|card)[^>]*>/gi) || []).length;
}

function isHero(lower: string): boolean {
  return (lower.includes('<h1') || (lower.includes('<h2') && lower.indexOf('<h2') < 200)) &&
    (lower.includes('btn') || lower.includes('button') || lower.includes('cta') ||
     lower.includes('get started') || lower.includes('learn more') || lower.includes('hero'));
}

function extractRepeatingItems(html: string): Array<{ title: string; description: string }> {
  const items: Array<{ title: string; description: string }> = [];
  // Match divs/lis/articles with heading + text pattern
  const itemRegex = /<(?:div|li|article|card)[^>]*>([\s\S]*?)<\/(?:div|li|article|card)>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null) {
    const inner = m[1];
    const title = extractFirst(inner, 'h3') || extractFirst(inner, 'h4') || extractFirst(inner, 'strong') || '';
    const desc = extractFirst(inner, 'p') || '';
    if (title || desc) {
      items.push({ title, description: desc });
    }
  }
  return items;
}

function extractPricingPlans(html: string): Array<{ name: string; price: string; description: string; features: string[] }> {
  const plans: Array<{ name: string; price: string; description: string; features: string[] }> = [];
  const cardRegex = /<(?:div|article|section)[^>]*>([\s\S]*?)<\/(?:div|article|section)>/gi;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const inner = m[1];
    if (!inner.includes('$') && !inner.match(/\d+.*\/mo/)) continue;
    const priceMatch = inner.match(/\$[\d,.]+(?:\s*\/\s*\w+)?/);
    if (!priceMatch) continue;
    const features: string[] = [];
    const liRegex = /<li[^>]*>([\s\S]*?)<\/li>/gi;
    let li;
    while ((li = liRegex.exec(inner)) !== null) {
      features.push(stripTags(li[1]).trim());
    }
    plans.push({
      name: extractFirst(inner, 'h3') || extractFirst(inner, 'h2') || '',
      price: priceMatch[0],
      description: extractFirst(inner, 'p') || '',
      features,
    });
  }
  return plans;
}

function extractFaqItems(html: string): Array<{ question: string; answer: string }> {
  const items: Array<{ question: string; answer: string }> = [];
  const pairRegex = /<(?:div|dt|details)[^>]*>([\s\S]*?)<\/(?:div|dt|details)>/gi;
  let m;
  while ((m = pairRegex.exec(html)) !== null) {
    const q = extractFirst(m[1], 'h3') || extractFirst(m[1], 'h4') || extractFirst(m[1], 'summary') || extractFirst(m[1], 'strong') || '';
    const a = extractFirst(m[1], 'p') || extractFirst(m[1], 'dd') || '';
    if (q && a) items.push({ question: q, answer: a });
  }
  return items;
}

function extractTestimonials(html: string): Array<{ quote: string; name: string }> {
  const items: Array<{ quote: string; name: string }> = [];
  const cardRegex = /<(?:div|blockquote|article)[^>]*>([\s\S]*?)<\/(?:div|blockquote|article)>/gi;
  let m;
  while ((m = cardRegex.exec(html)) !== null) {
    const inner = m[1];
    const quote = extractFirst(inner, 'p') || extractFirst(inner, 'blockquote') || '';
    const name = extractFirst(inner, 'cite') || extractFirst(inner, 'strong') || extractFirst(inner, 'h4') || '';
    if (quote && quote.length > 20) {
      items.push({ quote: quote.replace(/^[""\u201c]+|[""\u201d]+$/g, ''), name });
    }
  }
  return items;
}

function extractStats(html: string): Array<{ value: string; label: string }> {
  const stats: Array<{ value: string; label: string }> = [];
  const itemRegex = /<(?:div|li|span)[^>]*>([\s\S]*?)<\/(?:div|li|span)>/gi;
  let m;
  while ((m = itemRegex.exec(html)) !== null) {
    const inner = m[1];
    const numMatch = stripTags(inner).match(/(\d[\d,.]*[+%kKmM]?)/);
    if (numMatch) {
      const value = numMatch[1];
      const label = stripTags(inner).replace(value, '').trim();
      if (label) stats.push({ value, label });
    }
  }
  return stats;
}

// ─── Claude AI Parser ───────────────────────────────────────────────

async function parseWithClaude(html: string): Promise<Block[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error(chalk.red('ANTHROPIC_API_KEY not set. Set it or remove --ai flag.'));
    process.exit(1);
  }

  try {
    let Anthropic;
    try {
      Anthropic = (await import('@anthropic-ai/sdk')).default;
    } catch {
      console.error(chalk.red('Missing @anthropic-ai/sdk. Install it: npm i @anthropic-ai/sdk'));
      process.exit(1);
    }
    const client = new Anthropic({ apiKey });

    // Truncate very large HTML to avoid token limits
    const truncated = html.length > 30000 ? html.slice(0, 30000) + '\n<!-- truncated -->' : html;

    const response = await client.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Convert this HTML into a JSON array of CMS content blocks.

Each block must have: { "type": "<block_type>", "content": { ... } }

Available block types and their content fields:
- hero: { headline, subheadline, cta_text, cta_url }
- features: { title, features: [{ title, description }] }
- pricing: { title, plans: [{ name, price, description, features: ["..."] }] }
- cta: { headline, subheadline, cta_text, cta_url }
- testimonials: { title, testimonials: [{ quote, name }] }
- faq: { title, questions: [{ question, answer }] }
- contact: { title, button_text }
- stats: { stats: [{ value, label }] }
- text: { title, text }
- team: { title, members: [{ name, role }] }
- gallery: { images: [{ url, alt }] }
- process-steps: { title, steps: [{ title, description }] }
- booking: { title, description, button_text }
- video: { url, title }
- divider: {}

Return ONLY a JSON array. No markdown, no explanation.

HTML:
${truncated}`,
      }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';

    // Extract JSON array from response
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (!jsonMatch) return [];

    const parsed = JSON.parse(jsonMatch[0]);
    if (!Array.isArray(parsed)) return [];

    // Validate each block
    return parsed.filter((b: any) =>
      b && typeof b.type === 'string' && typeof b.content === 'object'
    );
  } catch (error: any) {
    console.error(chalk.yellow(`  AI parsing failed: ${error.message || 'Unknown error'}`));
    console.error(chalk.dim('  Falling back to regex parser...'));
    return [];
  }
}

// ─── Main Command ───────────────────────────────────────────────────

export const importCommand = new Command('import')
  .description('Convert HTML/JSX into Solid# CMS page blocks')
  .argument('[file]', 'HTML file to import')
  .option('--page <title>', 'Page title (required)')
  .option('--slug <slug>', 'URL slug (auto-generated from title if omitted)')
  .option('--type <type>', 'Page type: website, landing, blog', 'website')
  .option('--stdin', 'Read HTML from stdin (pipe)')
  .option('--clipboard', 'Read HTML from system clipboard')
  .option('--publish', 'Mark page as published')
  .option('--ai', 'Use Claude AI for smarter block classification (requires ANTHROPIC_API_KEY)')
  .option('--dir <path>', 'Working directory', process.cwd())
  .action(async (file, options) => {
    let html = '';

    // Read HTML from source
    if (options.stdin) {
      // Read from stdin
      const chunks: Buffer[] = [];
      for await (const chunk of process.stdin) {
        chunks.push(chunk);
      }
      html = Buffer.concat(chunks).toString('utf-8');
    } else if (options.clipboard) {
      // Read from clipboard (macOS)
      try {
        const { execSync } = await import('child_process');
        if (process.platform === 'darwin') {
          html = execSync('pbpaste', { encoding: 'utf-8' });
        } else if (process.platform === 'linux') {
          html = execSync('xclip -selection clipboard -o', { encoding: 'utf-8' });
        } else {
          html = execSync('powershell Get-Clipboard', { encoding: 'utf-8' });
        }
      } catch {
        console.error(chalk.red('Failed to read clipboard. Paste your HTML into a file instead.'));
        process.exit(1);
      }
    } else if (file) {
      const filePath = path.resolve(file);
      if (!fs.existsSync(filePath)) {
        console.error(chalk.red(`File not found: ${filePath}`));
        process.exit(1);
      }
      html = fs.readFileSync(filePath, 'utf-8');
    } else {
      console.error(chalk.red('Provide an HTML file, --stdin, or --clipboard'));
      console.log(chalk.dim('  solid import landing.html --page "Summer Sale"'));
      console.log(chalk.dim('  solid import --clipboard --page "Promo"'));
      console.log(chalk.dim('  cat page.html | solid import --stdin --page "Quick"'));
      process.exit(1);
    }

    if (!html.trim()) {
      console.error(chalk.red('Empty HTML input.'));
      process.exit(1);
    }

    if (!options.page) {
      console.error(chalk.red('--page <title> is required'));
      process.exit(1);
    }

    const title = options.page;
    const slug = options.slug || title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    let blocks: Block[];

    if (options.ai) {
      const spinner = ora('Using Claude AI to parse HTML into blocks...').start();
      blocks = await parseWithClaude(html);
      if (blocks.length === 0) {
        spinner.text = 'AI returned no blocks, falling back to regex parser...';
        blocks = parseHtmlToBlocks(html);
      }
      if (blocks.length === 0) {
        spinner.fail(chalk.red('Could not extract any content blocks from the HTML.'));
        process.exit(1);
      }
      spinner.succeed(`AI detected ${blocks.length} content blocks`);
    } else {
      const spinner = ora('Parsing HTML into blocks...').start();
      blocks = parseHtmlToBlocks(html);
      if (blocks.length === 0) {
        spinner.fail(chalk.red('Could not extract any content blocks. Try --ai for smarter parsing.'));
        process.exit(1);
      }
      spinner.succeed(`Detected ${blocks.length} content blocks`);
    }

    // Show what was detected
    for (const block of blocks) {
      const icon = {
        hero: '\u{1F3AC}', features: '\u2728', pricing: '\u{1F4B0}', cta: '\u{1F4E3}',
        testimonials: '\u{1F4AC}', faq: '\u2753', contact: '\u{1F4E7}', stats: '\u{1F4CA}',
        text: '\u{1F4DD}', team: '\u{1F465}', gallery: '\u{1F5BC}', 'process-steps': '\u{1F4CB}',
      }[block.type] || '\u{1F4E6}';
      console.log(`  ${icon} ${chalk.bold(block.type)} — ${chalk.dim(block.content.headline || block.content.title || block.content.text?.slice(0, 50) || '')}`);
    }

    // Build page JSON
    const page = {
      title,
      slug,
      page_type: options.type,
      is_published: options.publish || false,
      is_landing_page: options.type === 'landing',
      meta_title: title,
      meta_description: '',
      layout_json: {
        sections: blocks,
      },
    };

    // Save to pages/ directory
    const dir = options.dir;
    const pagesDir = path.join(dir, 'pages');
    if (!fs.existsSync(pagesDir)) {
      fs.mkdirSync(pagesDir, { recursive: true });
    }

    const outPath = path.join(pagesDir, `${slug}.json`);
    fs.writeFileSync(outPath, JSON.stringify(page, null, 2), 'utf-8');

    console.log('');
    console.log(chalk.green(`Created: pages/${slug}.json`));
    console.log(chalk.dim(`  ${blocks.length} sections · ${options.type} · ${page.is_published ? 'published' : 'draft'}`));
    console.log('');
    console.log(chalk.dim('Next steps:'));
    console.log(chalk.dim(`  solid serve            Preview locally`));
    console.log(chalk.dim(`  solid open ${slug}      Edit in web builder`));
    console.log(chalk.dim(`  solid push             Push to production`));
  });
