/**
 * Unit tests for the block-example synthesizer (A.3).
 */
import {
  placeholderForProp,
  synthesizeExample,
  synthesizeAllExamples,
} from '../../lib/block-example-synth';
import type { BlockDef } from '../../lib/block-types';


describe('placeholderForProp — type handling', () => {
  it('boolean → true', () => {
    expect(placeholderForProp('enabled', 'boolean')).toBe(true);
    expect(placeholderForProp('show', 'bool')).toBe(true);
  });

  it('number → 0 by default', () => {
    expect(placeholderForProp('order', 'number')).toBe(0);
    expect(placeholderForProp('rank', 'integer')).toBe(0);
  });

  it('object → empty object', () => {
    expect(placeholderForProp('config', 'object')).toEqual({});
  });

  it('array recurses on element type', () => {
    const out = placeholderForProp('tags', 'string[]');
    expect(Array.isArray(out)).toBe(true);
    expect(out).toHaveLength(2);
  });
});


describe('placeholderForProp — name-based mapping', () => {
  it('headline → marketing copy', () => {
    expect(placeholderForProp('headline', 'string')).toMatch(/business/i);
  });

  it('cta_url → /signup', () => {
    expect(placeholderForProp('cta_url', 'string')).toBe('/signup');
  });

  it('image → placehold.co URL', () => {
    expect(placeholderForProp('image', 'string')).toMatch(/placehold/);
  });

  it('email → an email-shaped string', () => {
    expect(placeholderForProp('email', 'string')).toMatch(/@/);
  });

  it('phone → a phone-shaped string', () => {
    expect(placeholderForProp('phone', 'string')).toMatch(/\d/);
  });

  it('unknown name with _url suffix → example.com URL', () => {
    expect(placeholderForProp('frobnicator_url', 'string')).toMatch(/^https:\/\//);
  });

  it('unknown name with image suffix → placehold.co URL', () => {
    expect(placeholderForProp('hero_image', 'string')).toMatch(/placehold/);
  });

  it('truly unknown name → wrapped placeholder mentioning the name', () => {
    expect(placeholderForProp('frobnicator', 'string')).toBe('<frobnicator>');
  });

  it('numeric placeholders override default 0 for known names', () => {
    expect(placeholderForProp('count', 'number')).toBe(12);
    expect(placeholderForProp('price', 'number')).toBe(99);
  });
});


describe('synthesizeExample', () => {
  it('uses hand-written example when present', () => {
    const block: BlockDef = {
      type: 'hero',
      component: 'Hero',
      category: 'Above the fold',
      example: { type: 'hero', headline: 'CUSTOM' },
    };
    expect(synthesizeExample(block)).toEqual({ type: 'hero', headline: 'CUSTOM' });
  });

  it('synthesizes from props when no example is provided', () => {
    const block: BlockDef = {
      type: 'hero',
      component: 'Hero',
      category: 'Above the fold',
      props: { headline: 'string', cta_text: 'string', cta_url: 'string' },
    };
    const ex = synthesizeExample(block);
    expect(ex.type).toBe('hero');
    expect(ex.headline).toBeTruthy();
    expect(ex.cta_text).toBe('Get started');
    expect(ex.cta_url).toBe('/signup');
  });

  it('uses enum first value when prop is enum-typed', () => {
    const block: BlockDef = {
      type: 'hero',
      component: 'Hero',
      category: 'Above the fold',
      props: { variant: 'string' },
      enums: { variant: ['primary', 'secondary', 'ghost'] },
    };
    const ex = synthesizeExample(block);
    expect(ex.variant).toBe('primary');
  });

  it('prefers "default"/"medium"/"normal" enum values over alphabetical first', () => {
    const block: BlockDef = {
      type: 'x',
      component: 'X',
      category: 'X',
      props: { align: 'string' },
      enums: { align: ['right', 'left', 'center'] },
    };
    const ex = synthesizeExample(block);
    expect(ex.align).toBe('center');
  });

  it('returns at least the type field for a block with no props', () => {
    const block: BlockDef = { type: 'divider', component: 'Divider', category: 'Layout' };
    expect(synthesizeExample(block)).toEqual({ type: 'divider' });
  });
});


describe('synthesizeAllExamples', () => {
  it('emits one example per block, keyed by type', () => {
    const blocks: BlockDef[] = [
      { type: 'hero', component: 'Hero', category: 'X', props: { headline: 'string' } },
      { type: 'cta', component: 'Cta', category: 'X', props: { cta_text: 'string' } },
    ];
    const out = synthesizeAllExamples(blocks);
    expect(Object.keys(out)).toEqual(['hero', 'cta']);
    expect(out.hero.type).toBe('hero');
    expect(out.cta.type).toBe('cta');
  });

  it('every example has a `type` field', () => {
    const blocks: BlockDef[] = [
      { type: 'a', component: 'A', category: 'X' },
      { type: 'b', component: 'B', category: 'X', props: { x: 'string' } },
    ];
    const out = synthesizeAllExamples(blocks);
    for (const ex of Object.values(out)) {
      expect(ex.type).toBeDefined();
    }
  });
});
