/**
 * Where a CMS page lives on the public web, and which site a new page belongs to.
 *
 * Two facts from the public renderer (solid-public src/middleware.ts +
 * src/lib/cms/cms-page.ts) decide the URL:
 *
 *   /<slug>    on a site's host is looked up WITH that host's site_id. A page
 *              whose site_id is null, or belongs to another site, 404s there.
 *   /p/<slug>  is looked up by company only, so it serves any published page
 *              of the company — including one attached to no site.
 *
 * So a page attached to a site is at `<that site's canonical>/<slug>` (home →
 * the bare origin), and an unattached page is only reachable at
 * `<primary site's canonical>/p/<slug>`. When neither can be computed the
 * caller gets `url: null` AND a reason — a silent null reads as "not live".
 *
 * The pure helpers take already-fetched rows so they can be unit-tested.
 */

export type SiteRow = Record<string, any>;
export type PageRow = Record<string, any>;

/** The site's canonical origin (no trailing slash), or null. */
export function siteCanonicalOrigin(site: SiteRow | undefined | null): string | null {
  if (!site) return null;
  const fromAddresses = (site.addresses ?? []).find(
    (a: SiteRow) => a && a.is_canonical && a.is_active !== false && a.url,
  )?.url;
  const raw =
    site.canonical_url ||
    fromAddresses ||
    (site.canonical_host ? `https://${site.canonical_host}` : null);
  return raw ? String(raw).replace(/\/+$/, '') : null;
}

/**
 * The company's primary site: the one with site_type "company" (what the
 * backend's own generators attach pages to), else the only site there is.
 * Undefined when that is ambiguous — guessing between two sites would attach
 * a page to the wrong one.
 */
export function primarySite(sites: SiteRow[]): SiteRow | undefined {
  const live = sites.filter((s) => s && !s.deleted_at);
  const company = live.filter((s) => s.site_type === 'company');
  if (company.length === 1) return company[0];
  if (company.length > 1) return company.find((s) => s.is_live) ?? company[0];
  if (live.length === 1) return live[0];
  return undefined;
}

/**
 * Resolve `--site <id|slug>` against the site list. Returns the row, or an
 * error string naming what exists.
 */
export function resolveSiteRef(ref: string, sites: SiteRow[]): { site?: SiteRow; error?: string } {
  const r = String(ref).trim();
  if (/^\d+$/.test(r)) {
    const id = parseInt(r, 10);
    const site = sites.find((s) => Number(s.id) === id);
    return site ? { site } : { error: `No site with id ${id}. Sites: ${describeSites(sites)}` };
  }
  const lower = r.toLowerCase();
  const site =
    sites.find((s) => String(s.slug ?? '').toLowerCase() === lower) ??
    sites.find((s) => String(s.canonical_host ?? '').toLowerCase() === lower) ??
    sites.find((s) => String(s.name ?? '').toLowerCase() === lower);
  return site ? { site } : { error: `No site matching "${r}". Sites: ${describeSites(sites)}` };
}

function describeSites(sites: SiteRow[]): string {
  if (!sites.length) return '(none)';
  return sites.map((s) => `${s.id}${s.slug ? `=${s.slug}` : ''}`).join(', ');
}

export interface PublicUrlResult {
  url: string | null;
  /** Why url is null. Present only when it is. */
  url_unavailable_reason?: string;
  /** Which rule produced url: the page's own site, or /p/ on the primary site. */
  url_basis?: 'site' | 'company_permalink';
  site_id?: number | null;
}

/** Pure: compute the public URL for a page from the site list. */
export function publicUrlForPage(page: PageRow, sites: SiteRow[]): PublicUrlResult {
  const slug = String(page.slug ?? '').replace(/^\/+/, '');
  if (!slug) {
    return { url: null, url_unavailable_reason: 'page has no slug', site_id: page.site_id ?? null };
  }
  if (page.site_id) {
    const site = sites.find((s) => Number(s.id) === Number(page.site_id));
    if (!site) {
      return {
        url: null,
        url_unavailable_reason: `page.site_id ${page.site_id} is not in this company's site list`,
        site_id: page.site_id,
      };
    }
    const origin = siteCanonicalOrigin(site);
    if (!origin) {
      return {
        url: null,
        url_unavailable_reason: `site ${site.id} has no canonical address (no active subdomain or domain) — see: solid site list`,
        site_id: page.site_id,
      };
    }
    return {
      url: slug === 'home' ? origin : `${origin}/${slug}`,
      url_basis: 'site',
      site_id: page.site_id,
    };
  }
  // Not attached to any site: bare /<slug> 404s on every host; only the
  // company-scoped /p/<slug> permalink serves it.
  const primary = primarySite(sites);
  const origin = siteCanonicalOrigin(primary);
  if (!origin) {
    return {
      url: null,
      url_unavailable_reason: primary
        ? `page is not attached to a site, and primary site ${primary.id} has no canonical address`
        : 'page is not attached to a site, and the company has no single primary site to serve /p/<slug> from',
      site_id: null,
    };
  }
  return { url: `${origin}/p/${slug}`, url_basis: 'company_permalink', site_id: null };
}

/** Fetch the company's sites. Throws on HTTP failure (callers decide). */
export async function fetchSites(): Promise<SiteRow[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { apiClient } = require('./api-client') as typeof import('./api-client');
  const res = (await apiClient.get('/api/v1/sites')).data as Record<string, any>;
  return (res.sites ?? res.items ?? []) as SiteRow[];
}

/** Fetch page + sites and compute the URL. Never throws — failure becomes a reason. */
export async function resolvePublicUrl(pageId: number): Promise<PublicUrlResult & { page?: PageRow }> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { apiClient } = require('./api-client') as typeof import('./api-client');
    const raw = (await apiClient.get(`/api/v1/cms/pages/${pageId}`)).data as Record<string, any>;
    const page = (raw && raw.page) || raw;
    const sites = await fetchSites();
    return { ...publicUrlForPage(page, sites), page };
  } catch (e) {
    return { url: null, url_unavailable_reason: `could not look up page/site: ${(e as Error).message}` };
  }
}
