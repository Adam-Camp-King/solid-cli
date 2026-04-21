/**
 * Tests for `solid nest` CLI command — pure helpers only.
 *
 * The live commander action invokes network calls and process.exit, so we test
 * the classification + payload-shaping helpers that carry all the interesting
 * logic. The action itself is thin: read bytes, call import, call execute with
 * destination — both endpoints already have integration coverage elsewhere.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  detectSource,
  normalizeUrl,
  flagsToDestination,
  flagsAsArgv,
  guessPageType,
} from '../commands/nest-helpers';

describe('detectSource', () => {
  it('treats undefined/missing as stdin', () => {
    expect(detectSource(undefined)).toBe('stdin');
  });

  it('treats "-" as stdin', () => {
    expect(detectSource('-')).toBe('stdin');
  });

  it('detects http:// urls', () => {
    expect(detectSource('http://example.com')).toBe('url');
  });

  it('detects https:// urls', () => {
    expect(detectSource('https://anglebuild.com/promo')).toBe('url');
  });

  it('detects bare domains (no protocol)', () => {
    expect(detectSource('anglebuild.com')).toBe('url');
    expect(detectSource('solid.example.co.uk/page')).toBe('url');
  });

  it('detects existing files', () => {
    const tmp = path.join(os.tmpdir(), `nest-test-${Date.now()}.html`);
    fs.writeFileSync(tmp, '<div>hi</div>');
    try {
      expect(detectSource(tmp)).toBe('file');
    } finally {
      fs.unlinkSync(tmp);
    }
  });

  it('falls back to code for raw snippets', () => {
    expect(detectSource('<div class="hero">Hello</div>')).toBe('code');
  });

  it('treats multiline paste as code, not url', () => {
    expect(detectSource('line1\nline2.com')).toBe('code');
  });
});

describe('normalizeUrl', () => {
  it('leaves http(s) urls alone', () => {
    expect(normalizeUrl('https://x.com')).toBe('https://x.com');
    expect(normalizeUrl('http://x.com')).toBe('http://x.com');
  });

  it('adds https:// to bare domains', () => {
    expect(normalizeUrl('anglebuild.com')).toBe('https://anglebuild.com');
    expect(normalizeUrl('anglebuild.com/promo')).toBe('https://anglebuild.com/promo');
  });
});

describe('flagsToDestination', () => {
  it('defaults mode to sandbox', () => {
    expect(flagsToDestination({})).toEqual({ mode: 'sandbox' });
  });

  it('--live sets mode to place_now', () => {
    expect(flagsToDestination({ live: true }).mode).toBe('place_now');
  });

  it('--live wins over --sandbox if both given', () => {
    expect(flagsToDestination({ live: true, sandbox: true }).mode).toBe('place_now');
  });

  it('forwards --type as page_type', () => {
    expect(flagsToDestination({ type: 'landing' }).page_type).toBe('landing');
  });

  it('parses numeric --site as site_id', () => {
    expect(flagsToDestination({ site: '42' }).site_id).toBe(42);
  });

  it('ignores non-numeric --site (v1 limitation)', () => {
    // v1 doesn't resolve slugs → ids in the CLI. That's a follow-up.
    expect(flagsToDestination({ site: 'main' }).site_id).toBeUndefined();
  });

  it('trims --subdomain, --custom-domain, --campaign', () => {
    const d = flagsToDestination({
      subdomain: '  promo  ',
      customDomain: '  anglebuild.com  ',
      campaign: '  q2-launch  ',
      live: true,
    });
    expect(d.subdomain).toBe('promo');
    expect(d.custom_domain).toBe('anglebuild.com');
    expect(d.campaign_id).toBe('q2-launch');
  });

  it('drops empty optional fields so backend treats them as unset', () => {
    const d = flagsToDestination({ subdomain: '   ', customDomain: '   ' });
    expect(d).not.toHaveProperty('subdomain');
    expect(d).not.toHaveProperty('custom_domain');
  });

  it('forwards --goal as conversion_goal', () => {
    expect(flagsToDestination({ goal: 'form_submit' }).conversion_goal).toBe('form_submit');
  });

  it('end-to-end: vertically-trained dentistry agent shape', () => {
    // A dentistry agent calls the CLI to ship a customer's Invisalign promo.
    const d = flagsToDestination({
      type: 'landing',
      live: true,
      site: '5',
      subdomain: 'invisalign',
      campaign: 'q2-invisalign',
      goal: 'form_submit',
    });
    expect(d).toEqual({
      page_type: 'landing',
      mode: 'place_now',
      site_id: 5,
      subdomain: 'invisalign',
      campaign_id: 'q2-invisalign',
      conversion_goal: 'form_submit',
    });
  });
});

describe('guessPageType', () => {
  it('guesses landing for URLs under /lp/ or /promo/', () => {
    expect(guessPageType('url', 'https://x.com/lp/something')).toBe('landing');
    expect(guessPageType('url', 'https://x.com/promo/q2')).toBe('landing');
    expect(guessPageType('url', 'https://x.com/offer/summer')).toBe('landing');
  });

  it('guesses blog for /blog/ or /posts/ URLs', () => {
    expect(guessPageType('url', 'https://x.com/blog/my-post')).toBe('blog');
    expect(guessPageType('url', 'https://x.com/posts/123')).toBe('blog');
  });

  it('guesses product for /products/ or /shop/ URLs', () => {
    expect(guessPageType('url', 'https://x.com/products/widget')).toBe('product');
    expect(guessPageType('url', 'https://x.com/shop/item')).toBe('product');
  });

  it('returns undefined for unknown shapes (caller falls back to default)', () => {
    expect(guessPageType('url', 'https://x.com')).toBeUndefined();
    expect(guessPageType('code', '<div/>')).toBeUndefined();
    expect(guessPageType('file', undefined)).toBeUndefined();
  });
});

describe('flagsAsArgv (subcommand delegation)', () => {
  it('serializes empty flags to empty argv', () => {
    expect(flagsAsArgv({})).toEqual([]);
  });

  it('serializes known flags in the right order', () => {
    const argv = flagsAsArgv({
      type: 'landing',
      site: '5',
      subdomain: 'promo',
      customDomain: 'x.com',
      live: true,
      campaign: 'q2',
      goal: 'form_submit',
      json: true,
    });
    expect(argv).toEqual([
      '--type', 'landing',
      '--site', '5',
      '--subdomain', 'promo',
      '--custom-domain', 'x.com',
      '--live',
      '--campaign', 'q2',
      '--goal', 'form_submit',
      '--json',
    ]);
  });

  it('omits falsy booleans', () => {
    const argv = flagsAsArgv({ sandbox: false, live: false });
    expect(argv).toEqual([]);
  });
});
