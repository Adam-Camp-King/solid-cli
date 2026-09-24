/**
 * Atlas addresses are 1 to 3 digits, and a retired one is reported with the
 * nouns that replaced it — mirrors solid-backend
 * tests/unit/test_atlas_retired_addresses.py.
 */
import {
  isAtlasAddress,
  isRetiredAddressResponse,
  retiredAddressEnvelope,
} from '../../lib/atlas-address';

describe('isAtlasAddress', () => {
  it.each(['5', '53', '531'])('accepts %s', (a) => expect(isAtlasAddress(a)).toBe(true));
  // The backend rejects the same four with a 400.
  it.each(['5a', '', '1234', '-1'])('rejects %p', (a) => expect(isAtlasAddress(a)).toBe(false));
});

describe('isRetiredAddressResponse', () => {
  it('is true only for a 410 carrying address_retired', () => {
    expect(isRetiredAddressResponse(410, { error: 'address_retired' })).toBe(true);
    expect(isRetiredAddressResponse(404, { error: 'address_retired' })).toBe(false);
    expect(isRetiredAddressResponse(410, { detail: 'Gone' })).toBe(false);
    expect(isRetiredAddressResponse(410, null)).toBe(false);
  });
});

describe('retiredAddressEnvelope', () => {
  it('puts each candidate in did_you_mean as a runnable command', () => {
    const env = retiredAddressEnvelope('51', {
      error: 'address_retired', address: '51', was: ['5:payment'],
      candidates: [{ address: '531', noun: 'refund', title: 'Refund' }],
    }).error;
    expect(env.did_you_mean).toEqual(['solid verbs list 531']);
    // Exactly one candidate: the fix is that command.
    expect(env.fix).toBe('solid verbs list 531');
    expect(env.status).toBe(410);
    expect(env.reason).toBe('address_retired');
    expect(env.retryable).toBe(false);
  });

  it('falls back to the nouns now under the prefix when there is no retirement record', () => {
    const env = retiredAddressEnvelope('55', {
      error: 'address_retired', candidates: [],
      now_a_prefix_for: { domain: 'Fees', nouns: [
        { address: '550', noun: 'fee_program', title: 'Fee programme' },
        { address: '551', noun: 'fee_law', title: 'Fee law' },
      ] },
    }).error;
    expect(env.did_you_mean).toEqual(['solid verbs list 550', 'solid verbs list 551']);
    expect(env.fix).toBe('solid map');
    expect(env.address).toBe('55');
  });

  it('still names a real fix with no candidates at all', () => {
    const env = retiredAddressEnvelope('59', { error: 'address_retired' }).error;
    expect(env.did_you_mean).toEqual([]);
    expect(env.fix).toBe('solid map');
    expect(env.message).toMatch(/59/);
  });
});
