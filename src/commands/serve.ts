/**
 * Serve command for Solid CLI
 *
 * Local preview server that renders CMS pages from pulled layout_json files.
 * Uses a built-in HTTP server + HTML renderer for the 25 block types.
 *
 * solid serve                → Start at localhost:4000
 * solid serve --port 3333    → Custom port
 * solid serve --open         → Auto-open browser
 *
 * Reads from:
 *   ./pages/*.json           → Page layout_json
 *   ./solid.config.json      → Company branding (name, colors, logo)
 *
 * Hot reloads on file changes.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

// ─── Block-to-HTML Renderer ─────────────────────────────────────────

interface Section {
  type: string;
  content?: any;
  props?: any;
  [key: string]: any;
}

interface CompanyContext {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  logo_url?: string;
  primary_color?: string;
  accent_color?: string;
  tagline?: string;
  industry?: string;
  [key: string]: any;
}

function renderSection(section: Section, ctx: CompanyContext): string {
  const type = section.type || 'text';
  const content = section.content || section.props || section;
  const primary = ctx.primary_color || '#4f46e5';

  switch (type) {
    case 'hero':
    case 'hero-image':
    case 'hero-split':
      return `
        <section style="background:linear-gradient(135deg,${primary},${primary}dd);color:#fff;padding:80px 40px;text-align:center;">
          <h1 style="font-size:2.5rem;margin-bottom:16px;">${esc(content.headline || content.title || ctx.name || '')}</h1>
          <p style="font-size:1.2rem;opacity:0.9;max-width:600px;margin:0 auto 24px;">${esc(content.subheadline || content.subtitle || content.description || '')}</p>
          ${content.cta_text ? `<a href="${esc(content.cta_url || '#')}" style="display:inline-block;background:#fff;color:${primary};padding:12px 32px;border-radius:8px;font-weight:600;text-decoration:none;">${esc(content.cta_text)}</a>` : ''}
        </section>`;

    case 'features':
      const features = content.features || content.items || [];
      return `
        <section style="padding:60px 40px;max-width:1000px;margin:0 auto;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'Features')}</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:24px;">
            ${features.map((f: any) => `
              <div style="padding:24px;border:1px solid #e5e7eb;border-radius:12px;">
                <h3 style="margin-bottom:8px;">${esc(f.title || f.name || '')}</h3>
                <p style="color:#6b7280;font-size:0.9rem;">${esc(f.description || f.text || '')}</p>
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'pricing':
      const plans = content.plans || content.tiers || content.items || [];
      return `
        <section style="padding:60px 40px;background:#f9fafb;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'Pricing')}</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;max-width:1000px;margin:0 auto;">
            ${plans.map((p: any) => `
              <div style="padding:32px;background:#fff;border-radius:12px;border:2px solid ${p.featured ? primary : '#e5e7eb'};text-align:center;">
                <h3>${esc(p.name || p.title || '')}</h3>
                <div style="font-size:2rem;font-weight:700;margin:16px 0;color:${primary};">${esc(p.price || '')}</div>
                <p style="color:#6b7280;margin-bottom:16px;">${esc(p.description || '')}</p>
                ${(p.features || []).map((f: any) => `<div style="padding:4px 0;font-size:0.9rem;">\u2713 ${esc(typeof f === 'string' ? f : f.text || f.name || '')}</div>`).join('')}
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'cta':
      return `
        <section style="background:${primary};color:#fff;padding:60px 40px;text-align:center;">
          <h2 style="margin-bottom:12px;">${esc(content.headline || content.title || 'Get Started')}</h2>
          <p style="opacity:0.9;margin-bottom:24px;">${esc(content.subheadline || content.description || '')}</p>
          ${content.cta_text ? `<a href="${esc(content.cta_url || '#')}" style="display:inline-block;background:#fff;color:${primary};padding:14px 36px;border-radius:8px;font-weight:600;text-decoration:none;">${esc(content.cta_text || content.button_text || 'Contact Us')}</a>` : ''}
        </section>`;

    case 'testimonials':
      const testimonials = content.testimonials || content.items || [];
      return `
        <section style="padding:60px 40px;max-width:900px;margin:0 auto;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'What Our Customers Say')}</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:24px;">
            ${testimonials.map((t: any) => `
              <div style="padding:24px;background:#f9fafb;border-radius:12px;border-left:4px solid ${primary};">
                <p style="font-style:italic;margin-bottom:12px;">"${esc(t.quote || t.text || '')}"</p>
                <p style="font-weight:600;font-size:0.9rem;">— ${esc(t.name || t.author || '')}</p>
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'faq':
    case 'accordion':
      const faqs = content.questions || content.items || content.faqs || [];
      return `
        <section style="padding:60px 40px;max-width:800px;margin:0 auto;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'FAQ')}</h2>
          ${faqs.map((q: any) => `
            <div style="border-bottom:1px solid #e5e7eb;padding:16px 0;">
              <h3 style="font-size:1.1rem;margin-bottom:8px;">${esc(q.question || q.title || '')}</h3>
              <p style="color:#6b7280;">${esc(q.answer || q.content || q.text || '')}</p>
            </div>
          `).join('')}
        </section>`;

    case 'contact':
    case 'form':
      return `
        <section style="padding:60px 40px;max-width:600px;margin:0 auto;">
          <h2 style="text-align:center;margin-bottom:32px;">${esc(content.title || 'Contact Us')}</h2>
          <div style="background:#f9fafb;padding:32px;border-radius:12px;">
            <div style="margin-bottom:16px;"><input placeholder="Name" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;" disabled></div>
            <div style="margin-bottom:16px;"><input placeholder="Email" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;" disabled></div>
            <div style="margin-bottom:16px;"><input placeholder="Phone" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;" disabled></div>
            <div style="margin-bottom:16px;"><textarea placeholder="Message" rows="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:6px;resize:vertical;" disabled></textarea></div>
            <button style="width:100%;background:${primary};color:#fff;padding:12px;border:none;border-radius:6px;font-size:1rem;cursor:not-allowed;opacity:0.7;">${esc(content.button_text || 'Send Message')} (Preview)</button>
          </div>
        </section>`;

    case 'stats':
      const stats = content.stats || content.items || [];
      return `
        <section style="padding:60px 40px;background:#f9fafb;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:24px;max-width:800px;margin:0 auto;text-align:center;">
            ${stats.map((s: any) => `
              <div>
                <div style="font-size:2.5rem;font-weight:700;color:${primary};">${esc(s.value || s.number || '')}</div>
                <div style="color:#6b7280;font-size:0.9rem;">${esc(s.label || s.title || '')}</div>
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'text':
      return `
        <section style="padding:40px;max-width:800px;margin:0 auto;">
          ${content.title ? `<h2 style="margin-bottom:16px;">${esc(content.title)}</h2>` : ''}
          <div style="color:#374151;line-height:1.7;">${content.html || esc(content.text || content.body || JSON.stringify(content))}</div>
        </section>`;

    case 'gallery':
      const images = content.images || content.items || [];
      return `
        <section style="padding:60px 40px;">
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;max-width:1000px;margin:0 auto;">
            ${images.map((img: any) => `
              <div style="aspect-ratio:4/3;background:#e5e7eb;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;">
                ${typeof img === 'string' ? `<img src="${esc(img)}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : esc(img.alt || 'Image')}
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'team':
      const members = content.members || content.items || [];
      return `
        <section style="padding:60px 40px;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'Our Team')}</h2>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:24px;max-width:1000px;margin:0 auto;text-align:center;">
            ${members.map((m: any) => `
              <div>
                <div style="width:80px;height:80px;border-radius:50%;background:#e5e7eb;margin:0 auto 12px;"></div>
                <h3 style="font-size:1rem;">${esc(m.name || '')}</h3>
                <p style="color:#6b7280;font-size:0.85rem;">${esc(m.role || m.title || '')}</p>
              </div>
            `).join('')}
          </div>
        </section>`;

    case 'divider':
      return `<hr style="border:none;border-top:1px solid #e5e7eb;margin:40px auto;max-width:800px;">`;

    case 'video':
      return `
        <section style="padding:60px 40px;text-align:center;">
          <div style="max-width:720px;margin:0 auto;aspect-ratio:16/9;background:#111;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.2rem;">
            \u25B6 Video: ${esc(content.url || content.title || 'Video Player')}
          </div>
        </section>`;

    case 'map':
    case 'service-area':
      return `
        <section style="padding:40px;text-align:center;">
          <div style="max-width:800px;margin:0 auto;height:300px;background:#e5e7eb;border-radius:12px;display:flex;align-items:center;justify-content:center;color:#6b7280;">
            Map: ${esc(content.address || ctx.address || 'Service Area')}
          </div>
        </section>`;

    case 'logo-cloud':
      return `
        <section style="padding:40px;text-align:center;">
          <p style="color:#6b7280;margin-bottom:16px;">${esc(content.title || 'Trusted By')}</p>
          <div style="display:flex;gap:32px;justify-content:center;flex-wrap:wrap;opacity:0.5;">
            ${(content.logos || content.items || []).map((l: any) => `<span style="font-size:1.1rem;font-weight:600;">${esc(typeof l === 'string' ? l : l.name || 'Logo')}</span>`).join('')}
          </div>
        </section>`;

    case 'booking':
      return `
        <section style="padding:60px 40px;text-align:center;background:#f9fafb;">
          <h2 style="margin-bottom:16px;">${esc(content.title || 'Book an Appointment')}</h2>
          <p style="color:#6b7280;margin-bottom:24px;">${esc(content.description || '')}</p>
          <button style="background:${primary};color:#fff;padding:14px 36px;border:none;border-radius:8px;font-size:1rem;cursor:not-allowed;opacity:0.7;">${esc(content.button_text || 'Book Now')} (Preview)</button>
        </section>`;

    case 'process-steps':
      const steps = content.steps || content.items || [];
      return `
        <section style="padding:60px 40px;max-width:800px;margin:0 auto;">
          <h2 style="text-align:center;margin-bottom:40px;">${esc(content.title || 'How It Works')}</h2>
          ${steps.map((s: any, i: number) => `
            <div style="display:flex;gap:16px;margin-bottom:24px;align-items:flex-start;">
              <div style="width:36px;height:36px;border-radius:50%;background:${primary};color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;flex-shrink:0;">${i + 1}</div>
              <div>
                <h3 style="margin-bottom:4px;">${esc(s.title || s.name || '')}</h3>
                <p style="color:#6b7280;">${esc(s.description || s.text || '')}</p>
              </div>
            </div>
          `).join('')}
        </section>`;

    default:
      return `
        <section style="padding:20px 40px;background:#fef3c7;border-left:4px solid #f59e0b;margin:20px 40px;border-radius:4px;">
          <p style="color:#92400e;font-size:0.9rem;">Block type: <strong>${esc(type)}</strong></p>
          <pre style="font-size:0.8rem;color:#6b7280;overflow-x:auto;">${esc(JSON.stringify(content, null, 2).slice(0, 300))}</pre>
        </section>`;
  }
}

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderPage(page: any, ctx: CompanyContext, allPages: any[]): string {
  const sections = page.layout_json?.sections || page.layout_json?.blocks || [];
  const title = page.title || 'Untitled Page';
  const primary = ctx.primary_color || '#4f46e5';

  const nav = allPages.map(p => `<a href="/${p.slug}" style="color:inherit;text-decoration:none;opacity:0.8;">${esc(p.title)}</a>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>${esc(title)} — ${esc(ctx.name || 'Preview')}</title>
  <meta name="description" content="${esc(page.meta_description || page.description || '')}">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; color: #111827; }
    a { color: ${primary}; }
    img { max-width: 100%; }
  </style>
</head>
<body>
  ${page.is_landing_page ? '' : `
  <nav style="display:flex;align-items:center;justify-content:space-between;padding:16px 40px;border-bottom:1px solid #e5e7eb;">
    <div style="font-weight:700;font-size:1.2rem;color:${primary};">${esc(ctx.name || 'Company')}</div>
    <div style="display:flex;gap:24px;font-size:0.9rem;">${nav}</div>
    ${ctx.phone ? `<a href="tel:${esc(ctx.phone)}" style="font-weight:600;text-decoration:none;">${esc(ctx.phone)}</a>` : ''}
  </nav>`}

  <main>
    ${sections.map((s: Section) => renderSection(s, ctx)).join('\n')}
  </main>

  ${page.is_landing_page ? '' : `
  <footer style="background:#111827;color:#9ca3af;padding:40px;text-align:center;font-size:0.85rem;">
    <p>&copy; ${new Date().getFullYear()} ${esc(ctx.name || '')}. All rights reserved.</p>
    ${ctx.address ? `<p style="margin-top:8px;">${esc(ctx.address)}</p>` : ''}
    ${ctx.email ? `<p style="margin-top:4px;">${esc(ctx.email)}</p>` : ''}
  </footer>`}

  <div style="position:fixed;bottom:0;left:0;right:0;background:#1e1b4b;color:#c7d2fe;padding:8px 16px;font-size:0.8rem;display:flex;justify-content:space-between;z-index:9999;">
    <span>Solid# Local Preview — <strong>${esc(title)}</strong></span>
    <span>${sections.length} sections &middot; ${page.is_published ? 'Published' : 'Draft'} &middot; ${esc(page.page_type || 'website')}</span>
  </div>
</body>
</html>`;
}

// ─── Server ─────────────────────────────────────────────────────────

function loadPages(dir: string): any[] {
  const pagesDir = path.join(dir, 'pages');
  if (!fs.existsSync(pagesDir)) return [];

  return fs.readdirSync(pagesDir)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf-8'));
        if (!data.slug) data.slug = f.replace('.json', '');
        return data;
      } catch { return null; }
    })
    .filter(Boolean);
}

function loadContext(dir: string): CompanyContext {
  const configPath = path.join(dir, 'solid.config.json');
  if (!fs.existsSync(configPath)) return {};
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    return {
      name: data.name,
      phone: data.phone,
      email: data.email,
      address: data.address,
      logo_url: data.logo_url,
      primary_color: data.website_settings?.primary_color || data.primary_color,
      accent_color: data.website_settings?.accent_color || data.accent_color,
      tagline: data.tagline,
      industry: data.industry,
    };
  } catch { return {}; }
}

export const serveCommand = new Command('serve')
  .description('Start a local preview server for your pulled site')
  .option('--port <number>', 'Server port', '4000')
  .option('--dir <path>', 'Working directory', process.cwd())
  .option('--open', 'Auto-open browser')
  .action(async (options) => {
    const dir = options.dir;
    const port = parseInt(options.port);

    // Verify we have pulled files
    if (!fs.existsSync(path.join(dir, 'pages')) && !fs.existsSync(path.join(dir, 'solid.config.json'))) {
      console.error(chalk.red('No pulled site found. Run `solid pull` first.'));
      process.exit(1);
    }

    const server = http.createServer((req, res) => {
      const pages = loadPages(dir);
      const ctx = loadContext(dir);
      const url = (req.url || '/').replace(/\?.*$/, '');

      // Index page
      if (url === '/' || url === '/index') {
        // Find home page or first page
        const home = pages.find(p => p.slug === 'home' || p.slug === 'index') || pages[0];
        if (home) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(renderPage(home, ctx, pages));
        } else {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(renderIndex(pages, ctx));
        }
        return;
      }

      // Page by slug
      const slug = url.replace(/^\//, '').replace(/\/$/, '');
      const page = pages.find(p => p.slug === slug);
      if (page) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(renderPage(page, ctx, pages));
        return;
      }

      // 404
      res.writeHead(404, { 'Content-Type': 'text/html' });
      res.end(`<html><body style="font-family:system-ui;padding:60px;text-align:center;">
        <h1>404</h1><p>Page "${esc(slug)}" not found.</p>
        <p><a href="/">Go to index</a></p>
      </body></html>`);
    });

    server.listen(port, () => {
      const pages = loadPages(dir);
      const ctx = loadContext(dir);
      console.log('');
      console.log(chalk.bold(`  Solid# Local Preview`));
      console.log(chalk.dim(`  ${ctx.name || 'Your Site'} — ${pages.length} pages`));
      console.log('');
      console.log(`  ${chalk.green('\u25CF')} http://localhost:${port}`);
      console.log('');
      pages.forEach(p => {
        const status = p.is_published ? chalk.green('live') : chalk.yellow('draft');
        console.log(`    ${status}  /${p.slug}  ${chalk.dim(p.title)}`);
      });
      console.log('');
      console.log(chalk.dim('  Edit pages/*.json and refresh to see changes.'));
      console.log(chalk.dim('  Press Ctrl+C to stop.'));
      console.log('');

      if (options.open) {
        const { exec } = require('child_process');
        const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
        exec(`${cmd} http://localhost:${port}`);
      }
    });

    // Watch for file changes and log
    const pagesDir = path.join(dir, 'pages');
    if (fs.existsSync(pagesDir)) {
      fs.watch(pagesDir, { recursive: true }, (eventType, filename) => {
        if (filename?.endsWith('.json')) {
          console.log(chalk.dim(`  [${new Date().toLocaleTimeString()}] ${filename} changed — refresh browser`));
        }
      });
    }
  });

// Index page listing all pages
function renderIndex(pages: any[], ctx: CompanyContext): string {
  const primary = ctx.primary_color || '#4f46e5';
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${esc(ctx.name || 'Site')} — Local Preview</title>
<style>*{margin:0;padding:0;box-sizing:border-box;}body{font-family:system-ui,sans-serif;padding:60px 40px;max-width:600px;margin:0 auto;}</style>
</head><body>
  <h1 style="margin-bottom:8px;color:${primary};">${esc(ctx.name || 'Your Site')}</h1>
  <p style="color:#6b7280;margin-bottom:32px;">${pages.length} pages available</p>
  ${pages.map(p => `
    <a href="/${p.slug}" style="display:block;padding:16px;margin-bottom:8px;border:1px solid #e5e7eb;border-radius:8px;text-decoration:none;color:inherit;">
      <strong>${esc(p.title)}</strong>
      <span style="float:right;font-size:0.8rem;color:${p.is_published ? '#059669' : '#d97706'};">${p.is_published ? 'Published' : 'Draft'}</span>
      <br><span style="color:#6b7280;font-size:0.85rem;">/${p.slug} \u2014 ${p.page_type || 'website'}</span>
    </a>
  `).join('')}
  <div style="margin-top:40px;padding:16px;background:#f3f4f6;border-radius:8px;font-size:0.85rem;color:#6b7280;">
    <p>Solid# Local Preview Server</p>
    <p>Edit files in <code>pages/</code> and refresh the browser.</p>
  </div>
</body></html>`;
}
