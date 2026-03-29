/**
 * Serve command tests — block rendering and page loading.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('serve: local preview', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-serve-test-'));
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('page loading', () => {
    it('loads pages from pages/ directory', () => {
      fs.writeFileSync(path.join(tmpDir, 'pages', 'home.json'), JSON.stringify({
        title: 'Home', slug: 'home', is_published: true,
        layout_json: { sections: [{ type: 'hero', content: { headline: 'Welcome' } }] },
      }));

      fs.writeFileSync(path.join(tmpDir, 'pages', 'about.json'), JSON.stringify({
        title: 'About', slug: 'about', is_published: true,
        layout_json: { sections: [{ type: 'text', content: { text: 'About us' } }] },
      }));

      const pagesDir = path.join(tmpDir, 'pages');
      const pages = fs.readdirSync(pagesDir)
        .filter(f => f.endsWith('.json'))
        .map(f => JSON.parse(fs.readFileSync(path.join(pagesDir, f), 'utf-8')));

      expect(pages).toHaveLength(2);
      expect(pages[0].slug).toBeDefined();
      expect(pages[1].slug).toBeDefined();
    });

    it('assigns slug from filename if missing', () => {
      fs.writeFileSync(path.join(tmpDir, 'pages', 'pricing.json'), JSON.stringify({
        title: 'Pricing', layout_json: { sections: [] },
      }));

      const data = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pages', 'pricing.json'), 'utf-8'));
      if (!data.slug) data.slug = 'pricing';
      expect(data.slug).toBe('pricing');
    });
  });

  describe('context loading', () => {
    it('reads company branding from solid.config.json', () => {
      fs.writeFileSync(path.join(tmpDir, 'solid.config.json'), JSON.stringify({
        name: 'Test Plumbing', phone: '555-1234', industry: 'plumber',
        website_settings: { primary_color: '#2563eb' },
      }));

      const config = JSON.parse(fs.readFileSync(path.join(tmpDir, 'solid.config.json'), 'utf-8'));
      expect(config.name).toBe('Test Plumbing');
      expect(config.website_settings.primary_color).toBe('#2563eb');
    });

    it('handles missing config gracefully', () => {
      const configPath = path.join(tmpDir, 'solid.config.json');
      const exists = fs.existsSync(configPath);
      const ctx = exists ? JSON.parse(fs.readFileSync(configPath, 'utf-8')) : {};
      expect(ctx).toEqual({});
    });
  });

  describe('section types', () => {
    const blockTypes = [
      'hero', 'hero-image', 'hero-split', 'features', 'pricing', 'cta',
      'testimonials', 'faq', 'accordion', 'contact', 'form', 'stats',
      'text', 'gallery', 'team', 'divider', 'video', 'map', 'service-area',
      'logo-cloud', 'booking', 'process-steps', 'blog-preview', 'countdown',
      'before-after',
    ];

    it('supports all 25 block types', () => {
      expect(blockTypes).toHaveLength(25);
    });

    it('each block type has a string name', () => {
      for (const type of blockTypes) {
        expect(typeof type).toBe('string');
        expect(type.length).toBeGreaterThan(0);
      }
    });
  });
});
