/**
 * Pure helpers for `solid render` (A.1).
 *
 * Lives in `lib/` (not `commands/render.ts`) so unit tests can import
 * the pure functions without dragging in ora / puppeteer / commander
 * — those are ESM-flaky under jest. Same module structure used
 * everywhere else in the CLI: business logic → lib, wiring → commands.
 */

export interface Viewport {
  width: number;
  height: number;
  name: string;
}

export const NAMED_BREAKPOINTS: Record<string, Viewport> = {
  mobile:  { width: 375,  height: 667,  name: 'mobile'  },
  tablet:  { width: 768,  height: 1024, name: 'tablet'  },
  desktop: { width: 1440, height: 900,  name: 'desktop' },
  full:    { width: 1920, height: 1080, name: 'full'    },
};


/**
 * Parse a `--viewport WxH` value.
 *
 * @throws Error with a clear message on bad input.
 */
export function parseViewport(spec: string): Viewport {
  const m = spec.trim().match(/^(\d+)x(\d+)$/i);
  if (!m) {
    throw new Error(`Invalid viewport '${spec}'. Use the form WIDTHxHEIGHT, e.g. 1280x720.`);
  }
  const width = parseInt(m[1], 10);
  const height = parseInt(m[2], 10);
  if (width < 100 || height < 100 || width > 8000 || height > 8000) {
    throw new Error(`Viewport ${width}x${height} is out of range (100..8000 each axis).`);
  }
  return { width, height, name: `${width}x${height}` };
}


/**
 * Resolve `--breakpoint <list>` (comma-separated names) to viewports.
 * Empty input → desktop default.
 */
export function resolveBreakpoints(spec: string | undefined): Viewport[] {
  if (!spec) return [NAMED_BREAKPOINTS.full];
  const names = spec.split(',').map((s) => s.trim()).filter(Boolean);
  return names.map((name) => {
    const bp = NAMED_BREAKPOINTS[name.toLowerCase()];
    if (!bp) {
      const valid = Object.keys(NAMED_BREAKPOINTS).join(', ');
      throw new Error(`Unknown breakpoint '${name}'. Valid: ${valid}.`);
    }
    return bp;
  });
}


/**
 * Build the URL to render. Special-cases 'home' / '/' to the bare base.
 */
export function buildRenderUrl(baseUrl: string, slug: string): string {
  const cleanBase = baseUrl.replace(/\/+$/, '');
  if (slug === 'home' || slug === '/') return cleanBase + '/';
  const cleanSlug = slug.startsWith('/') ? slug : `/${slug}`;
  return cleanBase + cleanSlug;
}


/**
 * Output filename for a screenshot. Stable + predictable so agents can
 * compute it before the command runs.
 */
export function outputPath(outDir: string, slug: string, viewport: Viewport): string {
  // path.join is platform-aware; we keep this lib std-only so importers
  // need to pass `path.join` through opts if they want strict separators.
  // For our use case the simple template is enough.
  const cleanSlug = slug.replace(/^\/+|\/+$/g, '').replace(/\//g, '_') || 'home';
  const sep = outDir.endsWith('/') || outDir.endsWith('\\') ? '' : '/';
  return `${outDir}${sep}${cleanSlug}-${viewport.width}x${viewport.height}.png`;
}
