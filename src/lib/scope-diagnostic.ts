/**
 * Scope/feature-gap diagnostic (Sprint 1 T1.6).
 *
 * Compares the scopes currently granted on an API key against the scopes
 * the tenant's enabled features *should* grant (per backend service
 * services/scope_expansion.py, Sprint 0 T0.5). Surfaces mismatches so
 * `solid doctor` can tell the operator: "your key is missing agents:read
 * because your tenant enabled the agents feature after the key was
 * issued — rotate the key and you'll pick up the new scopes."
 *
 * Pure — takes primitives, returns primitives. No HTTP, no fs. The
 * backend has the same map in services/scope_expansion.py; this is a
 * narrow client-side mirror so operators see drift without a round-trip.
 * Kept small on purpose: if it diverges from the backend map, the only
 * impact is a diagnostic miss — enforcement is still server-side.
 */

/**
 * Feature key → scopes it should grant on issuance.
 * MUST stay in lock-step with solid-backend/services/scope_expansion.py
 * FEATURE_TO_SCOPES. Keep small — every entry is a permission decision.
 */
export const FEATURE_TO_SCOPES: Readonly<Record<string, readonly string[]>> = {
  agents: ['agents:read', 'agents:write', 'agents:data', 'agents:converse'],
  'ai-agents-platform': ['agents:read', 'agents:write', 'agents:data', 'agents:converse'],
};

function isTruthy(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return /^(1|true|yes|on)$/i.test(v.trim());
  return false;
}

/**
 * Given the key's current scopes and the tenant's feature flags, return
 * a sorted list of scopes that SHOULD be granted but aren't.
 *
 * Pure — no I/O.
 */
export function computeScopeGap(
  currentScopes: readonly string[] | null | undefined,
  featureSettings: Record<string, unknown> | null | undefined,
  featureToScopes: Readonly<Record<string, readonly string[]>> = FEATURE_TO_SCOPES,
): string[] {
  const current = new Set(currentScopes ?? []);
  const implied = new Set<string>();
  if (featureSettings) {
    for (const [feature, scopes] of Object.entries(featureToScopes)) {
      if (isTruthy(featureSettings[feature])) {
        for (const s of scopes) implied.add(s);
      }
    }
  }
  const gap: string[] = [];
  for (const s of implied) {
    if (!current.has(s)) gap.push(s);
  }
  gap.sort();
  return gap;
}

export interface ScopeDiagnosticFinding {
  severity: 'ok' | 'warn' | 'fail';
  code: 'SCOPE_GAP' | 'NO_FEATURES' | 'NO_SCOPES' | 'ALL_GRANTED';
  message: string;
  missing_scopes: string[];
  hint?: string;
}

/**
 * Wrap computeScopeGap with a pre-canned diagnostic payload — the shape
 * `solid doctor` surfaces to the operator. Pure.
 */
export function diagnoseScopeGap(
  currentScopes: readonly string[] | null | undefined,
  featureSettings: Record<string, unknown> | null | undefined,
): ScopeDiagnosticFinding {
  if (!featureSettings || Object.keys(featureSettings).length === 0) {
    return {
      severity: 'warn',
      code: 'NO_FEATURES',
      message: 'Tenant feature flags not available; cannot check scope gap.',
      missing_scopes: [],
    };
  }
  const gap = computeScopeGap(currentScopes, featureSettings);
  if (gap.length === 0) {
    return {
      severity: 'ok',
      code: 'ALL_GRANTED',
      message: 'Key scopes match tenant features.',
      missing_scopes: [],
    };
  }
  if (!currentScopes || currentScopes.length === 0) {
    return {
      severity: 'fail',
      code: 'NO_SCOPES',
      message: 'Current API key has no scopes — every tenant feature is under-privileged.',
      missing_scopes: gap,
      hint: 'Rotate with: solid keys rotate --scopes "' + gap.join(',') + '"',
    };
  }
  return {
    severity: 'fail',
    code: 'SCOPE_GAP',
    message: `API key is missing ${gap.length} scope(s) that tenant features imply.`,
    missing_scopes: gap,
    hint: 'Rotate with: solid keys rotate --add-scope ' + gap.join(' --add-scope '),
  };
}
