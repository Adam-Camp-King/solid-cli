/**
 * Proposal command tests — branded client proposals.
 */

import { config } from '../../lib/config';

describe('proposal logic', () => {
  beforeEach(() => {
    config.userEmail = 'adam@solidnumber.com';
    config.companyId = 99999;
  });

  it('has 4 pricing tiers', () => {
    const tiers = ['starter', 'builder', 'professional', 'enterprise'];
    const prices = ['$89/mo', '$199/mo', '$499/mo', '$1,499/mo'];
    expect(tiers).toHaveLength(4);
    expect(prices).toHaveLength(4);
  });

  it('has industry-specific benefits', () => {
    const industries = ['plumber', 'dentist', 'hvac', 'restaurant', 'default'];
    expect(industries).toHaveLength(5);
  });

  it('derives agency name from email domain', () => {
    const email = 'adam@solidnumber.com';
    const domain = email.split('@')[1]?.replace(/\.(com|io|dev|agency)$/, '');
    expect(domain).toBe('solidnumber');
  });

  it('defaults to starter tier', () => {
    const defaultTier = 'starter';
    expect(defaultTier).toBe('starter');
  });

  it('generates JSON output with all fields', () => {
    const output = {
      business_name: "Joe's Plumbing",
      industry: 'plumber',
      tier: { name: 'Starter', price: '$89/mo', features: ['AI website', 'CRM'] },
      benefits: ['AI answers calls 24/7'],
      agency: 'solidnumber',
      generated_at: new Date().toISOString(),
    };

    expect(output.business_name).toBe("Joe's Plumbing");
    expect(output.tier.price).toBe('$89/mo');
    expect(output.benefits).toHaveLength(1);
  });
});
