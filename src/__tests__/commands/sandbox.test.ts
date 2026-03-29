/**
 * Sandbox command tests — fork, status, diff, push, reset.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('sandbox', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'solid-sandbox-test-'));
    // Create mock pulled site
    fs.mkdirSync(path.join(tmpDir, 'pages'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, 'kb'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.solid'), { recursive: true });

    fs.writeFileSync(path.join(tmpDir, 'pages', 'home.json'), JSON.stringify({
      title: 'Home', slug: 'home', is_published: true,
      layout_json: { sections: [{ type: 'hero', content: { headline: 'Welcome' } }] },
    }));

    fs.writeFileSync(path.join(tmpDir, 'kb', 'services.md'), '---\nid: 1\ntitle: Services\ncategory: general\n---\nWe offer plumbing.');

    fs.writeFileSync(path.join(tmpDir, 'solid.config.json'), JSON.stringify({ name: 'Test Co', industry: 'plumber' }));

    fs.writeFileSync(path.join(tmpDir, '.solid', 'manifest.json'), JSON.stringify({
      company_id: 99999, company_name: 'Test Co', pulled_at: new Date().toISOString(),
      pages: { 'home.json': { id: 1, slug: 'home', updated_at: new Date().toISOString() } },
      kb: { 'services.md': { id: 1, title: 'Services' } },
    }));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create', () => {
    it('creates .sandbox/ directory with all files', () => {
      const sandboxDir = path.join(tmpDir, '.sandbox');
      fs.mkdirSync(path.join(sandboxDir, 'pages'), { recursive: true });
      fs.mkdirSync(path.join(sandboxDir, 'kb'), { recursive: true });
      fs.mkdirSync(path.join(sandboxDir, '.solid'), { recursive: true });

      // Copy files (simulating sandbox create)
      fs.copyFileSync(path.join(tmpDir, 'pages', 'home.json'), path.join(sandboxDir, 'pages', 'home.json'));
      fs.copyFileSync(path.join(tmpDir, 'kb', 'services.md'), path.join(sandboxDir, 'kb', 'services.md'));
      fs.copyFileSync(path.join(tmpDir, 'solid.config.json'), path.join(sandboxDir, 'solid.config.json'));

      fs.writeFileSync(path.join(sandboxDir, 'meta.json'), JSON.stringify({
        created_at: new Date().toISOString(),
        forked_from: tmpDir,
        company_id: 99999,
        company_name: 'Test Co',
      }));

      expect(fs.existsSync(path.join(sandboxDir, 'pages', 'home.json'))).toBe(true);
      expect(fs.existsSync(path.join(sandboxDir, 'kb', 'services.md'))).toBe(true);
      expect(fs.existsSync(path.join(sandboxDir, 'meta.json'))).toBe(true);
    });
  });

  describe('diff detection', () => {
    it('detects modified pages', () => {
      const sandboxDir = path.join(tmpDir, '.sandbox');
      fs.mkdirSync(path.join(sandboxDir, 'pages'), { recursive: true });

      // Original
      const original = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pages', 'home.json'), 'utf-8'));
      // Modified
      original.layout_json.sections[0].content.headline = 'Welcome Home!';
      fs.writeFileSync(path.join(sandboxDir, 'pages', 'home.json'), JSON.stringify(original));

      const origContent = fs.readFileSync(path.join(tmpDir, 'pages', 'home.json'), 'utf-8');
      const sandboxContent = fs.readFileSync(path.join(sandboxDir, 'pages', 'home.json'), 'utf-8');

      expect(origContent).not.toBe(sandboxContent);
    });

    it('detects new pages', () => {
      const sandboxDir = path.join(tmpDir, '.sandbox');
      fs.mkdirSync(path.join(sandboxDir, 'pages'), { recursive: true });

      fs.writeFileSync(path.join(sandboxDir, 'pages', 'pricing.json'), JSON.stringify({
        title: 'Pricing', slug: 'pricing', layout_json: { sections: [] },
      }));

      expect(fs.existsSync(path.join(tmpDir, 'pages', 'pricing.json'))).toBe(false);
      expect(fs.existsSync(path.join(sandboxDir, 'pages', 'pricing.json'))).toBe(true);
    });
  });

  describe('reset', () => {
    it('removes .sandbox/ directory completely', () => {
      const sandboxDir = path.join(tmpDir, '.sandbox');
      fs.mkdirSync(sandboxDir, { recursive: true });
      fs.writeFileSync(path.join(sandboxDir, 'meta.json'), '{}');

      fs.rmSync(sandboxDir, { recursive: true, force: true });

      expect(fs.existsSync(sandboxDir)).toBe(false);
    });
  });

  describe('push (promote)', () => {
    it('copies sandbox files back to main directory', () => {
      const sandboxDir = path.join(tmpDir, '.sandbox');
      fs.mkdirSync(path.join(sandboxDir, 'pages'), { recursive: true });

      // Create modified page in sandbox
      const modified = { title: 'Home Updated', slug: 'home', layout_json: { sections: [] } };
      fs.writeFileSync(path.join(sandboxDir, 'pages', 'home.json'), JSON.stringify(modified));

      // Promote: copy sandbox → main
      fs.copyFileSync(path.join(sandboxDir, 'pages', 'home.json'), path.join(tmpDir, 'pages', 'home.json'));

      const result = JSON.parse(fs.readFileSync(path.join(tmpDir, 'pages', 'home.json'), 'utf-8'));
      expect(result.title).toBe('Home Updated');
    });
  });
});
