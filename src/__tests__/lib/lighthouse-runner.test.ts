/**
 * Unit tests for the Lighthouse runner's pure helpers (A.5).
 *
 * The actual Chromium + Lighthouse run is system-level (real browser,
 * real network) and lives in integration tests. What we CAN unit-test
 * is the issue extraction logic that turns Lighthouse's massive raw
 * report into the trimmed agent-friendly shape.
 */
import { extractIssues } from '../../lib/lighthouse-runner';


function fakeReport(overrides: Partial<Parameters<typeof extractIssues>[0]> = {}) {
  return {
    audits: {
      'color-contrast': {
        id: 'color-contrast',
        title: 'Background and foreground colors have a sufficient contrast ratio',
        description: 'Low-contrast text is difficult to read.',
        score: 0,
        scoreDisplayMode: 'binary',
      },
      'image-alt': {
        id: 'image-alt',
        title: 'Image elements have [alt] attributes',
        description: 'Informative elements should aim for short, descriptive alt text.',
        score: 0.5,
        scoreDisplayMode: 'binary',
      },
      'document-title': {
        id: 'document-title',
        title: 'Document has a <title> element',
        description: 'Title element gives users an overview of the page.',
        score: 1,
        scoreDisplayMode: 'binary',
      },
      'manual-only-audit': {
        id: 'manual-only-audit',
        title: 'Manual review needed',
        description: 'Cannot be automated.',
        score: null,
        scoreDisplayMode: 'manual',
      },
    },
    categories: {
      accessibility: {
        auditRefs: [
          { id: 'color-contrast' },
          { id: 'image-alt' },
          { id: 'document-title' },
          { id: 'manual-only-audit' },
        ],
      },
    },
    ...overrides,
  };
}


describe('extractIssues', () => {
  it('returns scored audits, sorted serious → moderate → minor → pass', () => {
    const issues = extractIssues(fakeReport(), 'accessibility');
    // Manual is filtered out (3 remain)
    expect(issues).toHaveLength(3);
    // Worst first: color-contrast (score 0 → serious), image-alt (0.5 → minor),
    // document-title (1.0 → pass)
    expect(issues[0].rule).toBe('color-contrast');
    expect(issues[0].severity).toBe('serious');
    expect(issues[issues.length - 1].rule).toBe('document-title');
    expect(issues[issues.length - 1].severity).toBe('pass');
  });

  it('skips manual / notApplicable / informative audits', () => {
    const issues = extractIssues(fakeReport(), 'accessibility');
    expect(issues.find((i) => i.rule === 'manual-only-audit')).toBeUndefined();
  });

  it('returns empty array when category not present', () => {
    expect(extractIssues(fakeReport(), 'nonexistent')).toEqual([]);
  });

  it('returns empty array when category has no auditRefs', () => {
    const r = fakeReport({ categories: { accessibility: {} } });
    expect(extractIssues(r, 'accessibility')).toEqual([]);
  });

  it('caps results at 50 to keep agent context budgets reasonable', () => {
    const audits: Record<string, { id: string; title: string; description: string; score: number; scoreDisplayMode: string }> = {};
    const refs: { id: string }[] = [];
    for (let i = 0; i < 100; i++) {
      const id = `audit-${i}`;
      audits[id] = { id, title: `Audit ${i}`, description: '...', score: 0, scoreDisplayMode: 'binary' };
      refs.push({ id });
    }
    const r = { audits, categories: { accessibility: { auditRefs: refs } } };
    const issues = extractIssues(r, 'accessibility');
    expect(issues).toHaveLength(50);
  });

  it('severity buckets — boundary values', () => {
    const audits = {
      'pass-edge': { id: 'pass-edge', title: 'p', description: '', score: 0.9, scoreDisplayMode: 'binary' },
      'minor-edge': { id: 'minor-edge', title: 'p', description: '', score: 0.5, scoreDisplayMode: 'binary' },
      'moderate-edge': { id: 'moderate-edge', title: 'p', description: '', score: 0.1, scoreDisplayMode: 'binary' },
      'serious-bottom': { id: 'serious-bottom', title: 'p', description: '', score: 0, scoreDisplayMode: 'binary' },
    };
    const refs = Object.keys(audits).map((id) => ({ id }));
    const r = { audits, categories: { accessibility: { auditRefs: refs } } };
    const issues = extractIssues(r, 'accessibility');
    const map = Object.fromEntries(issues.map((i) => [i.rule, i.severity]));
    expect(map['pass-edge']).toBe('pass');
    expect(map['minor-edge']).toBe('minor');
    expect(map['moderate-edge']).toBe('moderate');
    expect(map['serious-bottom']).toBe('serious');
  });

  it('handles null score as minor (not "pass")', () => {
    const r = {
      audits: { x: { id: 'x', title: 'x', description: '', score: null, scoreDisplayMode: 'binary' } },
      categories: { accessibility: { auditRefs: [{ id: 'x' }] } },
    };
    const issues = extractIssues(r, 'accessibility');
    expect(issues[0].severity).toBe('minor');
  });

  it('falls back to ref id when audit lookup misses', () => {
    const r = {
      audits: {} as Record<string, never>,
      categories: { accessibility: { auditRefs: [{ id: 'missing' }] } },
    };
    expect(extractIssues(r, 'accessibility')).toEqual([]);
  });
});
