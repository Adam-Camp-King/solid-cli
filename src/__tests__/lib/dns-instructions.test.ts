/**
 * `solid domains add/verify` print the backend's DNS records verbatim.
 * Shapes below are copied from solid-backend models/domain.py::dns_instructions_for
 * and controllers/domains.py::verify_dns_records.
 */
import { hasDnsInstructions, renderDnsInstructions, renderVerifyDetails } from '../../lib/dns-instructions';

const APEX = {
  domain: 'angl.net',
  records: [
    { type: 'A', name: '@', value: '134.199.179.65', ttl: 3600 },
    { type: 'TXT', name: '_solid-verify', value: 'solid-verify-abc', ttl: 3600 },
  ],
  instructions: [
    '1. Log in to your domain registrar (angl.net)',
    '2. Find DNS settings or DNS management',
    '3. Add the A record above',
    '   (If your DNS provider supports ALIAS/ANAME records, you may point an ALIAS @ at proxy.solidnumber.com instead of the A record)',
    '4. Add the TXT record for verification',
  ],
};

const SUB = {
  domain: 'ai.angl.net',
  records: [
    { type: 'CNAME', name: 'ai', value: 'proxy.solidnumber.com', ttl: 3600 },
    { type: 'TXT', name: '_solid-verify.ai', value: 'solid-verify-xyz', ttl: 3600 },
  ],
  instructions: ['3. Add the CNAME record above'],
};

describe('renderDnsInstructions', () => {
  it('apex domain: prints the A record + TXT, never a CNAME to proxy', () => {
    const out = renderDnsInstructions(APEX).join('\n');
    expect(out).toContain('Type:  A');
    expect(out).toContain('Value: 134.199.179.65');
    expect(out).toContain('Name:  _solid-verify');
    expect(out).toContain('Value: solid-verify-abc');
    expect(out).not.toMatch(/Type:\s+CNAME/);
    expect(out).toContain('ALIAS/ANAME');
  });

  it('subdomain: prints the CNAME with the leading label + scoped TXT name', () => {
    const out = renderDnsInstructions(SUB).join('\n');
    expect(out).toContain('Type:  CNAME');
    expect(out).toContain('Name:  ai');
    expect(out).toContain('Value: proxy.solidnumber.com');
    expect(out).toContain('Name:  _solid-verify.ai');
  });

  it('renders unknown record and top-level fields instead of dropping them', () => {
    const out = renderDnsInstructions({
      records: [{ type: 'TXT', name: '_solid-verify', value: '(issued by add_domain)', ttl: 3600, pending: true }],
      instructions: [],
      stray_a_records: ['1.2.3.4'],
    }).join('\n');
    expect(out).toContain('pending: true');
    expect(out).toContain('stray_a_records: ["1.2.3.4"]');
  });

  it('hasDnsInstructions rejects null/empty payloads', () => {
    expect(hasDnsInstructions(null)).toBe(false);
    expect(hasDnsInstructions({ records: [], instructions: [] })).toBe(false);
    expect(hasDnsInstructions(APEX)).toBe(true);
  });
});

describe('renderVerifyDetails', () => {
  it('shows every check, arrays expanded, errors last — including fields added later', () => {
    const out = renderVerifyDetails({
      cname_valid: false,
      a_valid: false,
      routing_valid: false,
      txt_valid: true,
      a_value: '10.0.0.1',
      stray_a_records: ['10.0.0.1', '10.0.0.2'],
      errors: ['No CNAME record found for angl.net'],
    });
    expect(out).toContain('a_valid: false');
    expect(out).toContain('txt_valid: true');
    expect(out).toContain('a_value: 10.0.0.1');
    expect(out).toContain('stray_a_records:');
    expect(out).toContain('  - 10.0.0.2');
    expect(out[out.length - 2]).toBe('errors:');
    expect(out[out.length - 1]).toBe('  - No CNAME record found for angl.net');
  });

  it('returns nothing for a missing details object', () => {
    expect(renderVerifyDetails(undefined)).toEqual([]);
  });
});
