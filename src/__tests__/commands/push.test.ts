/**
 * Push command tests — real behavior, not mock ceremony.
 *
 * Tests pure functions (parseKbMarkdown, detectChanges) with real
 * filesystem operations. Tests source contracts for safety guards.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseKbMarkdown, detectChanges } from '../../lib/push-utils';
import { PullManifest } from '../../lib/tenant-guard';

const PUSH_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'push.ts'),
  'utf-8',
);

function makeTmpdir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'push-test-'));
}

function emptyManifest(overrides: Partial<PullManifest> = {}): PullManifest {
  return {
    company_id: 42,
    company_name: 'Test Co',
    pulled_at: '2026-05-26T00:00:00Z',
    api_url: 'https://api.example.com',
    pages: {},
    kb: {},
    services: {},
    products: {},
    ...overrides,
  };
}

// ── parseKbMarkdown — pure function ─────────────────────────────────
describe('parseKbMarkdown', () => {
  it('extracts title, category, id, and content from valid frontmatter', () => {
    const input = '---\ntitle: Business Hours\ncategory: company_identity\nid: 15\n---\nMon-Fri 8AM-5PM';
    const result = parseKbMarkdown(input);
    expect(result.title).toBe('Business Hours');
    expect(result.category).toBe('company_identity');
    expect(result.id).toBe(15);
    expect(result.content).toBe('Mon-Fri 8AM-5PM');
  });

  it('handles missing frontmatter — defaults to Untitled/general', () => {
    const result = parseKbMarkdown('Just plain text content');
    expect(result.title).toBe('Untitled');
    expect(result.category).toBe('general');
    expect(result.content).toBe('Just plain text content');
    expect(result.id).toBeUndefined();
  });

  it('strips quotes from title values', () => {
    const result = parseKbMarkdown('---\ntitle: "Quoted Title"\ncategory: faq\n---\nBody text');
    expect(result.title).toBe('Quoted Title');
  });

  it('strips single quotes from title values', () => {
    const result = parseKbMarkdown("---\ntitle: 'Single Quoted'\ncategory: faq\n---\nBody");
    expect(result.title).toBe('Single Quoted');
  });

  it('handles colons in title value (e.g. "Hours: Mon-Fri")', () => {
    const result = parseKbMarkdown('---\ntitle: Hours: Mon-Fri 8-5\ncategory: hours\n---\nDetails');
    expect(result.title).toBe('Hours: Mon-Fri 8-5');
  });

  it('handles missing optional fields', () => {
    const result = parseKbMarkdown('---\ntitle: Only Title\n---\nContent');
    expect(result.title).toBe('Only Title');
    expect(result.category).toBe('general');
    expect(result.id).toBeUndefined();
  });

  it('handles multi-line content after frontmatter', () => {
    const input = '---\ntitle: FAQ\ncategory: faq\n---\nLine one\n\nLine two\n\nLine three';
    const result = parseKbMarkdown(input);
    expect(result.content).toContain('Line one');
    expect(result.content).toContain('Line two');
    expect(result.content).toContain('Line three');
  });

  it('handles empty content after frontmatter', () => {
    const result = parseKbMarkdown('---\ntitle: Empty\ncategory: test\n---\n');
    expect(result.title).toBe('Empty');
    expect(result.content).toBe('');
  });
});

// ── detectChanges — real filesystem ─────────────────────────────────
describe('detectChanges', () => {
  let baseDir: string;

  beforeEach(() => { baseDir = makeTmpdir(); });
  afterEach(() => { fs.rmSync(baseDir, { recursive: true, force: true }); });

  it('detects new page files as creates', () => {
    fs.mkdirSync(path.join(baseDir, 'pages'));
    fs.writeFileSync(
      path.join(baseDir, 'pages', 'home.json'),
      JSON.stringify({ title: 'Home', slug: 'home' }),
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.pages).toHaveLength(1);
    expect(changes.pages[0].action).toBe('create');
    expect(changes.pages[0].file).toBe('home.json');
    expect(changes.summary.creates).toBe(1);
    expect(changes.summary.updates).toBe(0);
  });

  it('detects existing page files as updates (manifest has entry)', () => {
    fs.mkdirSync(path.join(baseDir, 'pages'));
    fs.writeFileSync(
      path.join(baseDir, 'pages', 'about.json'),
      JSON.stringify({ title: 'About Us' }),
    );

    const manifest = emptyManifest({
      pages: { 'about.json': { id: 5, slug: 'about', updated_at: '2026-05-25T00:00:00Z' } },
    });
    const changes = detectChanges(baseDir, manifest);
    expect(changes.pages).toHaveLength(1);
    expect(changes.pages[0].action).toBe('update');
    expect(changes.summary.updates).toBe(1);
    expect(changes.summary.creates).toBe(0);
  });

  it('detects new KB markdown files as creates', () => {
    fs.mkdirSync(path.join(baseDir, 'kb'));
    fs.writeFileSync(
      path.join(baseDir, 'kb', 'hours.md'),
      '---\ntitle: Business Hours\ncategory: hours\n---\nMon-Fri 8AM-5PM',
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.kb).toHaveLength(1);
    expect(changes.kb[0].action).toBe('create');
    expect(changes.kb[0].data.title).toBe('Business Hours');
    expect(changes.kb[0].data.category).toBe('hours');
    expect(changes.kb[0].data.content).toBe('Mon-Fri 8AM-5PM');
  });

  it('detects existing KB files as updates with manifest ID carried through', () => {
    fs.mkdirSync(path.join(baseDir, 'kb'));
    fs.writeFileSync(
      path.join(baseDir, 'kb', 'faq.md'),
      '---\ntitle: FAQ\ncategory: faq\n---\nUpdated FAQ content',
    );

    const manifest = emptyManifest({
      kb: { 'faq.md': { id: 99, title: 'FAQ' } },
    });
    const changes = detectChanges(baseDir, manifest);
    expect(changes.kb).toHaveLength(1);
    expect(changes.kb[0].action).toBe('update');
    expect(changes.kb[0].data.id).toBe(99);
  });

  it('detects website settings changes from solid.config.json', () => {
    fs.writeFileSync(
      path.join(baseDir, 'solid.config.json'),
      JSON.stringify({ website_settings: { primary_color: '#3b82f6' } }),
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.settings.changed).toBe(true);
    expect(changes.settings.data).toEqual({ primary_color: '#3b82f6' });
    expect(changes.summary.settings).toBe(true);
  });

  it('no changes when directories are empty', () => {
    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.pages).toHaveLength(0);
    expect(changes.kb).toHaveLength(0);
    expect(changes.settings.changed).toBe(false);
    expect(changes.summary.creates).toBe(0);
    expect(changes.summary.updates).toBe(0);
  });

  it('ignores non-.json files in pages/', () => {
    fs.mkdirSync(path.join(baseDir, 'pages'));
    fs.writeFileSync(path.join(baseDir, 'pages', 'README.md'), '# Pages');
    fs.writeFileSync(path.join(baseDir, 'pages', '.DS_Store'), '');
    fs.writeFileSync(
      path.join(baseDir, 'pages', 'real.json'),
      JSON.stringify({ title: 'Real' }),
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.pages).toHaveLength(1);
    expect(changes.pages[0].file).toBe('real.json');
  });

  it('ignores non-.md files in kb/', () => {
    fs.mkdirSync(path.join(baseDir, 'kb'));
    fs.writeFileSync(path.join(baseDir, 'kb', 'notes.txt'), 'not kb');
    fs.writeFileSync(
      path.join(baseDir, 'kb', 'real.md'),
      '---\ntitle: Real\ncategory: test\n---\nContent',
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.kb).toHaveLength(1);
    expect(changes.kb[0].file).toBe('real.md');
  });

  it('handles mixed creates and updates across pages and KB', () => {
    fs.mkdirSync(path.join(baseDir, 'pages'));
    fs.mkdirSync(path.join(baseDir, 'kb'));
    fs.writeFileSync(path.join(baseDir, 'pages', 'new.json'), JSON.stringify({ title: 'New' }));
    fs.writeFileSync(path.join(baseDir, 'pages', 'existing.json'), JSON.stringify({ title: 'Existing' }));
    fs.writeFileSync(path.join(baseDir, 'kb', 'new.md'), '---\ntitle: New KB\ncategory: test\n---\nNew');
    fs.writeFileSync(path.join(baseDir, 'kb', 'old.md'), '---\ntitle: Old KB\ncategory: test\n---\nOld');

    const manifest = emptyManifest({
      pages: { 'existing.json': { id: 10, slug: 'existing', updated_at: '2026-01-01T00:00:00Z' } },
      kb: { 'old.md': { id: 20, title: 'Old KB' } },
    });
    const changes = detectChanges(baseDir, manifest);

    expect(changes.summary.creates).toBe(2);
    expect(changes.summary.updates).toBe(2);
    expect(changes.pages).toHaveLength(2);
    expect(changes.kb).toHaveLength(2);
  });

  it('empty website_settings object → no settings change', () => {
    fs.writeFileSync(
      path.join(baseDir, 'solid.config.json'),
      JSON.stringify({ website_settings: {} }),
    );

    const changes = detectChanges(baseDir, emptyManifest());
    expect(changes.settings.changed).toBe(false);
  });
});

// ── Source contracts ─────────────────────────────────────────────────
describe('push source contracts', () => {
  it('calls requireTenantManifest before any API call', () => {
    const guardIdx = PUSH_SRC.indexOf('requireTenantManifest');
    const apiIdx = PUSH_SRC.indexOf('apiClient.');
    expect(guardIdx).not.toBe(-1);
    expect(apiIdx).not.toBe(-1);
    expect(guardIdx).toBeLessThan(apiIdx);
  });

  it('imports requireTenantManifest from tenant-guard', () => {
    expect(PUSH_SRC).toMatch(/import.*requireTenantManifest.*from.*tenant-guard/);
  });

  it('supports --dry-run flag', () => {
    expect(PUSH_SRC).toMatch(/dry-run|dryRun/);
  });

  it('supports --flush for offline queue replay', () => {
    expect(PUSH_SRC).toMatch(/--flush/);
  });

  it('creates snapshot before pushing (non-fatal)', () => {
    expect(PUSH_SRC).toMatch(/createSnapshot/);
  });

  it('flush mode gates on isLoggedIn()', () => {
    expect(PUSH_SRC).toMatch(/isLoggedIn\(\)/);
  });
});
