/**
 * Unit tests for `solid render` (A.1).
 *
 * The actual screenshot integration is system-level (real Chromium,
 * real network). What we CAN test in jest is the pure logic:
 *   - viewport parsing (named + custom)
 *   - breakpoint resolution
 *   - URL construction
 *   - error messages on bad input
 */
import {
  buildRenderUrl,
  outputPath,
  parseViewport,
  resolveBreakpoints,
} from '../../lib/render-utils';


describe('parseViewport', () => {
  it('parses WxH form', () => {
    expect(parseViewport('1280x720')).toEqual({ width: 1280, height: 720, name: '1280x720' });
  });

  it('accepts uppercase X', () => {
    expect(parseViewport('1920X1080')).toEqual({ width: 1920, height: 1080, name: '1920x1080' });
  });

  it('trims whitespace', () => {
    expect(parseViewport('  800x600  ')).toEqual({ width: 800, height: 600, name: '800x600' });
  });

  it.each(['', 'abc', '1280', '1280x', 'x720', '1280x720x500', '1280-720'])(
    'rejects malformed input %s',
    (bad) => {
      expect(() => parseViewport(bad)).toThrow(/Invalid viewport/);
    },
  );

  it('rejects out-of-range dimensions', () => {
    expect(() => parseViewport('50x600')).toThrow(/out of range/);
    expect(() => parseViewport('9000x600')).toThrow(/out of range/);
    expect(() => parseViewport('1280x99')).toThrow(/out of range/);
    expect(() => parseViewport('1280x9000')).toThrow(/out of range/);
  });
});


describe('resolveBreakpoints', () => {
  it('defaults to full HD when no spec given', () => {
    const out = resolveBreakpoints(undefined);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ width: 1920, height: 1080, name: 'full' });
  });

  it('resolves a single named breakpoint', () => {
    const out = resolveBreakpoints('mobile');
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe('mobile');
    expect(out[0].width).toBe(375);
  });

  it('resolves comma-separated breakpoints in order', () => {
    const out = resolveBreakpoints('mobile,tablet,desktop');
    expect(out.map((v) => v.name)).toEqual(['mobile', 'tablet', 'desktop']);
  });

  it('is case-insensitive', () => {
    const out = resolveBreakpoints('Mobile,DESKTOP');
    expect(out).toHaveLength(2);
    expect(out[0].name).toBe('mobile');
    expect(out[1].name).toBe('desktop');
  });

  it('skips empty entries', () => {
    const out = resolveBreakpoints('mobile,,tablet');
    expect(out).toHaveLength(2);
  });

  it('throws on unknown breakpoint with valid list in error', () => {
    expect(() => resolveBreakpoints('phablet')).toThrow(/Unknown breakpoint 'phablet'/);
    expect(() => resolveBreakpoints('phablet')).toThrow(/Valid:.*mobile.*tablet.*desktop.*full/);
  });

  it('all four named breakpoints have sane dimensions', () => {
    for (const name of ['mobile', 'tablet', 'desktop', 'full']) {
      const [vp] = resolveBreakpoints(name);
      expect(vp.width).toBeGreaterThan(100);
      expect(vp.height).toBeGreaterThan(100);
      expect(vp.width).toBeLessThan(4000);
      expect(vp.height).toBeLessThan(4000);
    }
  });
});


describe('buildRenderUrl', () => {
  it('maps "home" to the bare base URL', () => {
    expect(buildRenderUrl('https://acme.com', 'home')).toBe('https://acme.com/');
  });

  it('maps "/" to the bare base URL', () => {
    expect(buildRenderUrl('https://acme.com', '/')).toBe('https://acme.com/');
  });

  it('appends a leading slash when the slug lacks one', () => {
    expect(buildRenderUrl('https://acme.com', 'about')).toBe('https://acme.com/about');
  });

  it('preserves the slash when the slug already has one', () => {
    expect(buildRenderUrl('https://acme.com', '/pricing')).toBe('https://acme.com/pricing');
  });

  it('strips trailing slashes from the base', () => {
    expect(buildRenderUrl('https://acme.com//', 'about')).toBe('https://acme.com/about');
  });

  it('handles nested slugs', () => {
    expect(buildRenderUrl('https://acme.com', 'blog/2024/post')).toBe('https://acme.com/blog/2024/post');
  });
});


describe('outputPath', () => {
  it('joins dir + slug + viewport into a stable filename', () => {
    expect(outputPath('/tmp/r', 'home', { width: 375, height: 667, name: 'mobile' }))
      .toBe('/tmp/r/home-375x667.png');
  });

  it('strips leading/trailing slashes from slug', () => {
    expect(outputPath('/tmp/r', '/about/', { width: 1920, height: 1080, name: 'full' }))
      .toBe('/tmp/r/about-1920x1080.png');
  });

  it('replaces inner slashes with underscores so we can store nested slugs flat', () => {
    expect(outputPath('/tmp/r', 'blog/post', { width: 1440, height: 900, name: 'desktop' }))
      .toBe('/tmp/r/blog_post-1440x900.png');
  });

  it('maps empty slug to "home"', () => {
    expect(outputPath('/tmp/r', '/', { width: 1920, height: 1080, name: 'full' }))
      .toBe('/tmp/r/home-1920x1080.png');
  });

  it('handles dirs with or without trailing separator', () => {
    const vp = { width: 800, height: 600, name: 'x' };
    expect(outputPath('/tmp/r/', 'p', vp)).toBe('/tmp/r/p-800x600.png');
    expect(outputPath('/tmp/r', 'p', vp)).toBe('/tmp/r/p-800x600.png');
  });
});
