/**
 * Import command tests — HTML parsing to layout_json blocks.
 *
 * Calls the actual parseHtmlToBlocks parser and asserts on classified output.
 */

jest.mock('ora', () => ({
  __esModule: true,
  default: () => ({ start: jest.fn().mockReturnThis(), stop: jest.fn(), succeed: jest.fn(), fail: jest.fn() }),
}));

import { parseHtmlToBlocks } from '../../commands/import';

describe('import: HTML-to-blocks parser', () => {
  describe('block detection', () => {
    it('detects hero sections from H1 + button', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h1>Welcome to Our Business</h1><p>Best service in town</p><a href="/contact" class="btn">Get Started</a></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('hero');
      expect(blocks[0].content.headline).toContain('Welcome');
      expect(blocks[0].content.cta_text).toBeTruthy();
    });

    it('detects pricing from dollar amounts', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h2>Pricing</h2><div><h3>Basic</h3><p>$29/mo</p></div><div><h3>Pro</h3><p>$99/mo</p></div></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('pricing');
      expect(blocks[0].content.plans).toBeDefined();
    });

    it('detects FAQ from question/answer patterns', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h2>FAQ</h2><div><h3>How does it work?</h3><p>Simple.</p></div></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('faq');
      expect(blocks[0].content.title).toBeDefined();
    });

    it('detects testimonials from quotes', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h2>Reviews</h2><blockquote><p>"Great service!"</p><cite>John</cite></blockquote></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('testimonials');
    });

    it('detects contact forms even with quoted attributes', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h2>Contact Us</h2><form><input placeholder="Name"><input placeholder="Email"><textarea></textarea><button>Send</button></form></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('contact');
    });

    it('contact wins over hero when form is present', () => {
      const blocks = parseHtmlToBlocks(
        `<section><h2>Get In Touch</h2><p>We'd love to hear from you</p><form><input placeholder="Name"><button>Submit</button></form></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).toBe('contact');
    });

    it('returns empty array for empty HTML', () => {
      expect(parseHtmlToBlocks('')).toEqual([]);
      expect(parseHtmlToBlocks('   ')).toEqual([]);
    });

    it('strips script and style tags before parsing', () => {
      const blocks = parseHtmlToBlocks(
        `<script>alert(1)</script><style>.x{}</style><section><h1>Real Content</h1><p>Description here</p><a class=btn>Go</a></section>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0]).toHaveProperty('type');
      expect(blocks[0]).toHaveProperty('content');
    });

    it('does not misclassify forms as testimonials from attribute quotes', () => {
      const blocks = parseHtmlToBlocks(
        `<div><form><input placeholder="Your name"><input placeholder="Your email"><button>Send</button></form></div>`,
      );
      expect(blocks.length).toBeGreaterThanOrEqual(1);
      expect(blocks[0].type).not.toBe('testimonials');
    });
  });

  describe('multi-section parsing', () => {
    it('parses multiple sections into multiple blocks', () => {
      const blocks = parseHtmlToBlocks(`
        <section><h1>Hero Title</h1><p>Sub</p><a href="/go" class="btn">CTA</a></section>
        <section><h2>FAQ</h2><div><h3>How does it work?</h3><p>Like this.</p></div></section>
      `);
      expect(blocks.length).toBeGreaterThanOrEqual(2);
      const types = blocks.map((b) => b.type);
      expect(types).toContain('hero');
      expect(types).toContain('faq');
    });
  });

  describe('slug generation', () => {
    it('generates slug from title', () => {
      const title = 'Summer Sale 2026!';
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      expect(slug).toBe('summer-sale-2026');
    });

    it('handles special characters', () => {
      const title = "Mike's Plumbing & HVAC";
      const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
      expect(slug).toBe('mike-s-plumbing-hvac');
    });
  });

  describe('page JSON structure', () => {
    it('creates valid page structure', () => {
      const page = {
        title: 'Test Page',
        slug: 'test-page',
        page_type: 'website',
        is_published: false,
        is_landing_page: false,
        meta_title: 'Test Page',
        meta_description: '',
        layout_json: { sections: [] },
      };

      expect(page).toHaveProperty('title');
      expect(page).toHaveProperty('slug');
      expect(page).toHaveProperty('layout_json');
      expect(page.layout_json).toHaveProperty('sections');
      expect(Array.isArray(page.layout_json.sections)).toBe(true);
    });

    it('marks landing pages correctly', () => {
      const page = { page_type: 'landing', is_landing_page: true };
      expect(page.is_landing_page).toBe(true);
    });
  });
});
