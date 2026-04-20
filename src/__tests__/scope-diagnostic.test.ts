/**
 * Unit tests for src/lib/scope-diagnostic.ts (Sprint 1 T1.6).
 * Pure — no HTTP.
 */
import {
  FEATURE_TO_SCOPES,
  computeScopeGap,
  diagnoseScopeGap,
} from '../lib/scope-diagnostic';

describe('computeScopeGap', () => {
  it('returns empty array when no features are enabled', () => {
    expect(computeScopeGap(['kb:read'], { agents: false })).toEqual([]);
    expect(computeScopeGap(['kb:read'], {})).toEqual([]);
  });

  it('returns all implied scopes when the key has none of them', () => {
    const gap = computeScopeGap(['kb:read'], { agents: true });
    expect(gap.sort()).toEqual([
      'agents:converse',
      'agents:data',
      'agents:read',
      'agents:write',
    ]);
  });

  it('returns the partial gap when the key has some implied scopes', () => {
    const gap = computeScopeGap(
      ['kb:read', 'agents:read'],
      { agents: true },
    );
    expect(gap.sort()).toEqual(['agents:converse', 'agents:data', 'agents:write']);
  });

  it('returns empty when the key has every implied scope', () => {
    const gap = computeScopeGap(
      ['agents:read', 'agents:write', 'agents:data', 'agents:converse'],
      { agents: true },
    );
    expect(gap).toEqual([]);
  });

  it('ai-agents-platform produces the same implied scopes as agents', () => {
    const a = computeScopeGap([], { agents: true });
    const b = computeScopeGap([], { 'ai-agents-platform': true });
    expect(a.sort()).toEqual(b.sort());
  });

  it.each(['true', 'yes', 'on', '1', 1, true])('truthy feature value %s enables implied scopes', (v) => {
    expect(computeScopeGap([], { agents: v as any }).length).toBeGreaterThan(0);
  });

  it.each(['false', 'no', 'off', '0', 0, false, undefined, null, 'banana'])(
    'falsy feature value %s does NOT enable implied scopes',
    (v) => {
      expect(computeScopeGap([], { agents: v as any })).toEqual([]);
    },
  );

  it('does not mutate inputs', () => {
    const scopes = ['kb:read'];
    const features = { agents: true };
    const snapA = [...scopes];
    const snapB = { ...features };
    computeScopeGap(scopes, features);
    expect(scopes).toEqual(snapA);
    expect(features).toEqual(snapB);
  });

  it('handles null / undefined gracefully', () => {
    expect(computeScopeGap(null, null)).toEqual([]);
    expect(computeScopeGap(undefined, undefined)).toEqual([]);
    expect(computeScopeGap(null, { agents: true }).sort()).toEqual([
      'agents:converse',
      'agents:data',
      'agents:read',
      'agents:write',
    ]);
  });

  it('accepts a custom feature→scopes map', () => {
    const custom = { vibe: ['vibe:execute'] };
    expect(computeScopeGap([], { vibe: true }, custom)).toEqual(['vibe:execute']);
    expect(computeScopeGap(['vibe:execute'], { vibe: true }, custom)).toEqual([]);
    // With custom map, the default agents feature isn't known
    expect(computeScopeGap([], { agents: true }, custom)).toEqual([]);
  });
});

describe('diagnoseScopeGap', () => {
  it('NO_FEATURES when feature_settings is empty/missing', () => {
    expect(diagnoseScopeGap([], null).code).toBe('NO_FEATURES');
    expect(diagnoseScopeGap([], undefined).code).toBe('NO_FEATURES');
    expect(diagnoseScopeGap([], {}).code).toBe('NO_FEATURES');
  });

  it('ALL_GRANTED when no implied scopes are missing', () => {
    const d = diagnoseScopeGap(
      ['agents:read', 'agents:write', 'agents:data', 'agents:converse'],
      { agents: true },
    );
    expect(d.severity).toBe('ok');
    expect(d.code).toBe('ALL_GRANTED');
    expect(d.missing_scopes).toEqual([]);
  });

  it('NO_SCOPES when key has zero scopes AND features imply some', () => {
    const d = diagnoseScopeGap([], { agents: true });
    expect(d.severity).toBe('fail');
    expect(d.code).toBe('NO_SCOPES');
    expect(d.hint).toContain('solid keys rotate');
    expect(d.missing_scopes.length).toBeGreaterThan(0);
  });

  it('SCOPE_GAP when key has SOME scopes but is missing implied ones', () => {
    const d = diagnoseScopeGap(['kb:read'], { agents: true });
    expect(d.severity).toBe('fail');
    expect(d.code).toBe('SCOPE_GAP');
    expect(d.message).toMatch(/missing \d+ scope/);
    expect(d.hint).toMatch(/--add-scope/);
    expect(d.missing_scopes).toContain('agents:read');
  });
});

describe('FEATURE_TO_SCOPES map integrity', () => {
  it('every entry has a non-empty scopes tuple', () => {
    for (const [feature, scopes] of Object.entries(FEATURE_TO_SCOPES)) {
      expect(scopes.length).toBeGreaterThan(0);
      expect(feature).toBe(feature.trim().toLowerCase());
    }
  });

  it('agents and ai-agents-platform grant the same scopes', () => {
    expect([...FEATURE_TO_SCOPES.agents].sort()).toEqual(
      [...FEATURE_TO_SCOPES['ai-agents-platform']].sort(),
    );
  });
});
