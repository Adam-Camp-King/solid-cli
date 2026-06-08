/**
 * Lighthouse driver for `solid audit a11y|perf|mobile` (A.5).
 *
 * Wraps the `lighthouse` npm package + the same Chromium that powers
 * `solid render` (via `lib/browser-install.ts`). Lighthouse expects to
 * connect to a Chrome with --remote-debugging-port; puppeteer-core
 * gives us that for free.
 *
 * Pure plumbing: launches Chrome, runs lighthouse, returns the trimmed
 * audit. No Commander, no UI — those live in `commands/audit.ts`.
 */

import { ensureChromium } from './browser-install';
import { importESM } from './esm-import';


export type LighthouseCategory = 'a11y' | 'perf' | 'mobile';


/** Map our short category names → Lighthouse's category IDs +
 *  configuration. `mobile` is special: it's not a separate category
 *  in Lighthouse — it's a form-factor toggle that runs the perf+a11y
 *  audit on a throttled mobile profile. */
function categoryConfig(cat: LighthouseCategory): { id: string; formFactor: 'mobile' | 'desktop'; label: string } {
  switch (cat) {
    case 'a11y':   return { id: 'accessibility', formFactor: 'desktop', label: 'Accessibility' };
    case 'perf':   return { id: 'performance',   formFactor: 'desktop', label: 'Performance' };
    case 'mobile': return { id: 'performance',   formFactor: 'mobile',  label: 'Mobile Performance' };
  }
}


export interface LighthouseIssue {
  rule: string;
  title: string;
  description: string;
  /** Lighthouse score 0..1, OR null if not applicable. */
  score: number | null;
  /** Numeric severity for sorting: 'serious'|'moderate'|'minor'|'pass'. */
  severity: 'serious' | 'moderate' | 'minor' | 'pass';
}


export interface LighthouseAuditResult {
  /** 0..100 — Lighthouse's category score, scaled. */
  score: number;
  /** Category we audited. */
  category: LighthouseCategory;
  /** URL we audited. */
  url: string;
  /** Issues sorted by severity (worst first). Capped at 50 to keep
   *  agent context budgets reasonable; full report is in `raw`. */
  issues: LighthouseIssue[];
  /** Optional raw Lighthouse JSON. Excluded by default; opt-in via
   *  `keepRaw: true` for callers that want the full ~5MB report. */
  raw?: unknown;
}


/** Map Lighthouse audit score → our 4-level severity bucket. */
function bucketSeverity(score: number | null): LighthouseIssue['severity'] {
  if (score === null) return 'minor';
  if (score >= 0.9) return 'pass';
  if (score >= 0.5) return 'minor';
  if (score >= 0.1) return 'moderate';
  return 'serious';
}


/**
 * Trim a full Lighthouse report down to the issues that matter for
 * the chosen category. Pure function — exported for unit testing.
 */
export function extractIssues(
  rawReport: { audits?: Record<string, { id?: string; title?: string; description?: string; score?: number | null; scoreDisplayMode?: string }>; categories?: Record<string, { auditRefs?: Array<{ id: string }> }> },
  categoryId: string,
): LighthouseIssue[] {
  const audits = rawReport.audits || {};
  const cat = (rawReport.categories || {})[categoryId];
  if (!cat || !cat.auditRefs) return [];

  const issues: LighthouseIssue[] = [];
  for (const ref of cat.auditRefs) {
    const audit = audits[ref.id];
    if (!audit) continue;
    // Skip "manual" / "notApplicable" / "informative" — only score-bearing
    if (audit.scoreDisplayMode && ['manual', 'notApplicable', 'informative'].includes(audit.scoreDisplayMode)) {
      continue;
    }
    issues.push({
      rule: audit.id || ref.id,
      title: audit.title || ref.id,
      description: audit.description || '',
      score: audit.score ?? null,
      severity: bucketSeverity(audit.score ?? null),
    });
  }

  // Sort: serious → moderate → minor → pass (we keep `pass` so the
  // caller can show "all green" if they want).
  const order = { serious: 0, moderate: 1, minor: 2, pass: 3 };
  issues.sort((a, b) => order[a.severity] - order[b.severity]);
  return issues.slice(0, 50);
}


/**
 * Run Lighthouse against a URL. Launches its own Chromium so the call
 * is self-contained; auto-installs Chromium if needed.
 *
 * @throws if the URL doesn't load, Chrome can't launch, or Lighthouse
 *   returns no result.
 */
export async function runLighthouse(
  url: string,
  category: LighthouseCategory,
  opts: { keepRaw?: boolean } = {},
): Promise<LighthouseAuditResult> {
  const config = categoryConfig(category);

  // Ensure Chromium is available; same lib as `solid render`. If
  // we're called in a non-interactive context (CI, agent) and the
  // browser isn't cached, ensureChromium throws — caller surfaces it.
  const browserResult = await ensureChromium();

  // Lazy-import puppeteer-core + lighthouse so unrelated commands
  // pay zero cost.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteer = require('puppeteer-core');
  // Lighthouse v13 is ESM-only — load it through importESM so tsc's CommonJS
  // transform doesn't downlevel it to require() (ERR_REQUIRE_ESM on Node<20.19).
  const lighthouseModule = await importESM<typeof import('lighthouse')>('lighthouse');
  const lighthouse = (lighthouseModule.default ?? lighthouseModule) as unknown as (
    url: string,
    flags?: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) => Promise<{ lhr: Record<string, unknown>; report: string | string[] } | undefined>;

  const browser = await puppeteer.launch({
    executablePath: browserResult.executablePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // Lighthouse needs the CDP port. Puppeteer's wsEndpoint embeds it.
    const wsEndpoint = browser.wsEndpoint();
    const portMatch = wsEndpoint.match(/:(\d+)\//);
    if (!portMatch) {
      throw new Error('Could not extract CDP port from puppeteer wsEndpoint');
    }
    const port = parseInt(portMatch[1], 10);

    const flags = {
      port,
      output: 'json' as const,
      logLevel: 'error' as const,
      onlyCategories: [config.id],
      formFactor: config.formFactor,
      // Lighthouse's "screenEmulation" picks defaults; specifying mobile
      // flips screen + UA. Defaults are fine for a v1.
      screenEmulation: config.formFactor === 'mobile' ? undefined : { disabled: true },
    };

    const result = await lighthouse(url, flags);
    if (!result || !result.lhr) {
      throw new Error('Lighthouse returned no result');
    }

    const lhr = result.lhr as { categories?: Record<string, { score?: number | null }> };
    const catResult = (lhr.categories || {})[config.id];
    const score = catResult && typeof catResult.score === 'number' ? Math.round(catResult.score * 100) : 0;

    const issues = extractIssues(lhr as Parameters<typeof extractIssues>[0], config.id);

    return {
      score,
      category,
      url,
      issues,
      raw: opts.keepRaw ? lhr : undefined,
    };
  } finally {
    await browser.close().catch(() => { /* swallow */ });
  }
}
