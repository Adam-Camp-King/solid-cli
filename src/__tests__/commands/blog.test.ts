/**
 * Blog command tests — source-read contracts (no network).
 *
 * Covers the Phase 3 CLI parity additions: publish / unpublish / generate.
 * Mirrors the lightweight source-contract style used by company.test.ts.
 */

import * as fs from 'fs';
import * as path from 'path';

const BLOG_SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'commands', 'blog.ts'),
  'utf-8',
);

describe('blog command — publish / unpublish / generate parity', () => {
  // ── Commander argument contracts ──────────────────────────────────
  describe('subcommand registration', () => {
    it('registers publish <idOrSlug>', () => {
      expect(BLOG_SRC).toMatch(/command\('publish <idOrSlug>'\)/);
    });

    it('registers unpublish <idOrSlug>', () => {
      expect(BLOG_SRC).toMatch(/command\('unpublish <idOrSlug>'\)/);
    });

    it('registers generate', () => {
      expect(BLOG_SRC).toMatch(/command\('generate'\)/);
    });
  });

  // ── Backend endpoints ─────────────────────────────────────────────
  describe('backend endpoints', () => {
    it('publish hits the publish endpoint', () => {
      expect(BLOG_SRC).toMatch(/\/api\/v1\/cms\/blog\/posts\/\$\{postId\}\/publish/);
    });

    it('unpublish hits the unpublish endpoint', () => {
      expect(BLOG_SRC).toMatch(/\/api\/v1\/cms\/blog\/posts\/\$\{postId\}\/unpublish/);
    });

    it('generate hits the blog-engine single endpoint', () => {
      expect(BLOG_SRC).toMatch(/'\/api\/v1\/blog-engine\/generate'/);
    });

    it('generate --count uses the batch endpoint', () => {
      expect(BLOG_SRC).toMatch(/'\/api\/v1\/blog-engine\/generate\/batch'/);
    });
  });

  // ── id|slug resolution ────────────────────────────────────────────
  describe('id-or-slug resolution', () => {
    it('resolves via the by-slug endpoint for non-numeric args', () => {
      expect(BLOG_SRC).toMatch(/resolvePostId/);
      expect(BLOG_SRC).toMatch(/\/api\/v1\/cms\/blog\/posts\/slug\//);
    });

    it('passes numeric IDs through unchanged', () => {
      expect(BLOG_SRC).toMatch(/\/\^\\d\+\$\/\.test\(idOrSlug\)/);
    });
  });

  // ── generate flags ────────────────────────────────────────────────
  describe('generate flags', () => {
    it('supports --topic, --count and --auto-publish', () => {
      expect(BLOG_SRC).toMatch(/--topic <topic>/);
      expect(BLOG_SRC).toMatch(/--count <n>/);
      expect(BLOG_SRC).toMatch(/--auto-publish/);
    });

    it('maps --topic to the keyword request field', () => {
      expect(BLOG_SRC).toMatch(/body\.keyword = options\.topic/);
    });

    it('maps --auto-publish to the publish request field', () => {
      expect(BLOG_SRC).toMatch(/publish: !!options\.autoPublish/);
    });

    it('reports the async job id for batch generation', () => {
      expect(BLOG_SRC).toMatch(/data\.task_id/);
    });
  });

  // ── Auth + JSON parity with siblings ──────────────────────────────
  describe('conventions', () => {
    it('each new command gates on auth', () => {
      // publish, unpublish, generate each call requireAuth()
      const authCalls = BLOG_SRC.match(/requireAuth\(\)/g)?.length || 0;
      expect(authCalls).toBeGreaterThanOrEqual(6);
    });

    it('each new command supports --json output', () => {
      expect(BLOG_SRC).toMatch(/isJsonOutput/);
    });
  });
});
