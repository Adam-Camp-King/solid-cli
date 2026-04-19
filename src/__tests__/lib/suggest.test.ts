/**
 * Suggestion engine tests — lock the "did you mean?" UX contract.
 *
 * Typos the user is most likely to make on the solid CLI surface.
 */

import { suggest, levenshtein } from '../../lib/suggest';

const SOLID_COMMANDS = [
  'auth', 'whoami', 'status', 'pull', 'push', 'diff', 'serve', 'open',
  'kb', 'pages', 'site', 'services', 'completion', 'integrations', 'vibe',
  'health', 'docs', 'train', 'clone', 'dev', 'droplet', 'company', 'switch',
  'agent', 'ant', 'connect', 'flows', 'brand', 'widgets', 'crm', 'voice',
  'inbox', 'schedule', 'reports', 'inventory', 'blog', 'explore', 'design',
  'visual', 'feedback', 'payment', 'context', 'analytics', 'seo', 'insights',
  'llms', 'accounting', 'webhooks', 'support', 'demo', 'init', 'doctor',
];

describe('levenshtein', () => {
  test('identity is zero', () => {
    expect(levenshtein('crm', 'crm')).toBe(0);
  });
  test('single-char typo is distance 1', () => {
    expect(levenshtein('crm', 'crn')).toBe(1);
    expect(levenshtein('auth', 'atuh')).toBe(2); // transposition = 2 edits
  });
  test('empty strings', () => {
    expect(levenshtein('', 'hello')).toBe(5);
    expect(levenshtein('hello', '')).toBe(5);
    expect(levenshtein('', '')).toBe(0);
  });
});

describe('suggest', () => {
  test('returns [] for empty or missing input', () => {
    expect(suggest('', SOLID_COMMANDS)).toEqual([]);
    expect(suggest('crm', [])).toEqual([]);
  });

  test('exact prefix wins over edit distance', () => {
    const out = suggest('cr', SOLID_COMMANDS);
    expect(out[0]).toBe('crm');
  });

  test('classic typo — frobnicate gets no help, returns [] or low-confidence', () => {
    const out = suggest('frobnicate', SOLID_COMMANDS);
    // No close match exists; threshold filters everything out.
    expect(out.length).toBeLessThanOrEqual(3);
  });

  test('single-char typo — auht → auth', () => {
    const out = suggest('auht', SOLID_COMMANDS);
    expect(out).toContain('auth');
  });

  test('single-char typo — comapny → company', () => {
    const out = suggest('comapny', SOLID_COMMANDS);
    expect(out).toContain('company');
  });

  test('short typo — psh → push', () => {
    const out = suggest('psh', SOLID_COMMANDS);
    expect(out).toContain('push');
  });

  test('deo → demo (single-char insertion)', () => {
    const out = suggest('deo', SOLID_COMMANDS);
    expect(out).toContain('demo');
  });

  test('dcotor → doctor (transposition)', () => {
    const out = suggest('dcotor', SOLID_COMMANDS);
    expect(out).toContain('doctor');
  });

  test('substring match — gent → agent', () => {
    const out = suggest('gent', SOLID_COMMANDS);
    expect(out).toContain('agent');
  });

  test('respects max option', () => {
    const out = suggest('a', SOLID_COMMANDS, { max: 2 });
    expect(out.length).toBeLessThanOrEqual(2);
  });

  test('case insensitive — AUTH → auth', () => {
    const out = suggest('AUTH', SOLID_COMMANDS);
    expect(out).toContain('auth');
  });

  test('no duplicates across match tiers', () => {
    // "agent" matches as substring AND as prefix when input is "agen"
    const out = suggest('agen', SOLID_COMMANDS);
    const unique = new Set(out);
    expect(unique.size).toBe(out.length);
  });

  test('nonsense input returns empty or very few candidates', () => {
    const out = suggest('xyzzxyz', SOLID_COMMANDS);
    expect(out.length).toBe(0);
  });
});
