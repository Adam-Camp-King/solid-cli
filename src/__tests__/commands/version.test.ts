/**
 * solid version — capabilities probe contract.
 *
 * Locks the wire shape agents will branch on:
 *   - {version, schema_version, node, capabilities[], verbs[], verb_count}
 *   - capabilities is a stable list of feature flags
 *   - verbs[] is the full path list (slim — no flags/args, that's `schema --json`)
 */
import {
  buildCapabilitiesResponse,
  buildVersionResponse,
  CLI_CAPABILITIES,
} from '../../commands/version';

describe('buildVersionResponse', () => {
  it('returns version + schema_version + node', () => {
    const out = buildVersionResponse();
    expect(out).toHaveProperty('version');
    expect(out).toHaveProperty('schema_version', '1.0');
    expect(out).toHaveProperty('node');
    expect(out.node).toMatch(/^v\d+/);
  });
});

describe('buildCapabilitiesResponse', () => {
  it('includes the stable capability list', () => {
    const out = buildCapabilitiesResponse([]);
    expect(out.capabilities).toEqual([...CLI_CAPABILITIES]);
  });

  it('exposes the verb path list and a verb_count that matches', () => {
    const verbs = ['solid pages', 'solid pages list', 'solid kb', 'solid kb search'];
    const out = buildCapabilitiesResponse(verbs);
    expect(out.verbs).toEqual(verbs);
    expect(out.verb_count).toBe(verbs.length);
  });

  it('advertises the AI-first capabilities the feedback called for', () => {
    const out = buildCapabilitiesResponse([]);
    // Each of these is a Tier-1 feedback item now in-flight or shipped.
    expect(out.capabilities).toContain('auto-json-non-tty');
    expect(out.capabilities).toContain('structured-errors');
    expect(out.capabilities).toContain('structured-errors-retryable');
    expect(out.capabilities).toContain('verb-manifest');
    expect(out.capabilities).toContain('schema-default-verbs');
    expect(out.capabilities).toContain('capabilities-probe');
  });
});
