/**
 * Block example synthesizer for `solid schema blocks --examples` (A.3).
 *
 * The block schema (cms-blocks.json) has a `props` map of `name → type`.
 * For blocks without a hand-written `example`, we synthesize one using
 * realistic placeholders so the agent gets shape AND context, not just
 * `{ "headline": "string" }`.
 *
 * Pure module — no side effects. Unit tested.
 */

import type { BlockDef } from './block-types';


const STRING_PLACEHOLDERS: Record<string, string> = {
  // Marketing copy patterns the agent recognizes immediately
  headline:    'Your business, on autopilot',
  subheadline: 'AI agents handle the work so you can focus on what matters',
  title:       'Section title',
  subtitle:    'Section subtitle',
  description: 'Short description that explains the value clearly',
  body:        'Longer body copy. Markdown is supported. Keep it tight.',
  text:        'Inline text content',
  caption:     'Image caption',
  cta_text:    'Get started',
  cta_url:     '/signup',
  link_text:   'Learn more',
  link_url:    '/about',

  // Identity / branding
  name:    'Acme, Inc.',
  brand:   'Acme',
  slug:    'home',
  category: 'general',

  // Contact / location
  email:        'hello@acme.com',
  phone:        '+1 (555) 123-4567',
  address:      '123 Main St, San Francisco, CA 94103',
  hours:        'Mon–Fri 9am–6pm',

  // Media URLs — use placehold.co so the example renders without
  // hitting a 404 in dev
  image:       'https://placehold.co/1200x600',
  image_url:   'https://placehold.co/1200x600',
  background:  'https://placehold.co/1920x1080',
  video:       'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  video_url:   'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
  logo:        'https://placehold.co/200x80',
  avatar:      'https://placehold.co/100x100',
  icon:        'sparkles',

  // Pricing / numbers
  price:       '99',
  currency:    'USD',
  amount:      '99',
  count:       '12',
};


/**
 * Generate a placeholder value for a single prop based on its type
 * declaration (e.g. "string", "number", "boolean", "string[]") and
 * its name.
 */
export function placeholderForProp(name: string, type: string): unknown {
  const lower = name.toLowerCase();
  const typeLower = type.toLowerCase().trim();

  // Arrays — recurse into element type if we can detect it
  if (typeLower.endsWith('[]')) {
    const inner = typeLower.slice(0, -2).trim();
    return [placeholderForProp(name, inner), placeholderForProp(name, inner)];
  }

  if (typeLower === 'boolean' || typeLower === 'bool') return true;
  if (typeLower === 'number' || typeLower === 'integer' || typeLower === 'int') {
    // Some props are obviously numeric — use the named placeholder if present
    const named = STRING_PLACEHOLDERS[lower];
    if (named && /^-?\d+$/.test(named)) return parseInt(named, 10);
    return 0;
  }

  // Object shorthand — return an empty object the agent can fill in
  if (typeLower === 'object' || typeLower.startsWith('{')) return {};

  // String + everything else — try the placeholder map, fall back to a
  // descriptive default
  const named = STRING_PLACEHOLDERS[lower];
  if (named) return named;

  // Match suffix patterns
  if (lower.endsWith('_url') || lower.endsWith('url')) return 'https://example.com';
  if (lower.endsWith('_email') || lower === 'email') return 'hello@example.com';
  if (lower.endsWith('_phone') || lower === 'phone') return '+1 (555) 000-0000';
  if (lower.endsWith('_image') || lower.endsWith('image') || lower.endsWith('_img')) return 'https://placehold.co/600x400';

  // Default: a descriptive placeholder mentioning the prop name so the
  // agent knows exactly what to fill in
  return `<${name}>`;
}


/** Pick a sensible value from an enum's allowed values. */
function pickEnumValue(values: string[]): string {
  if (values.length === 0) return '';
  // Prefer common-sense defaults if present
  const preferred = ['default', 'primary', 'medium', 'center', 'left', 'normal'];
  for (const p of preferred) {
    if (values.includes(p)) return p;
  }
  return values[0];
}


/**
 * Synthesize a JSON-LD-shaped block example from a BlockDef.
 *
 * Result shape: `{ type: <block type>, ...prop-defaults }`
 *
 * If the BlockDef already carries a hand-written `example`, that wins
 * — synthesized output is a fallback, not a replacement.
 */
export function synthesizeExample(block: BlockDef): Record<string, unknown> {
  // Hand-written examples beat synthesized ones every time
  if (block.example && typeof block.example === 'object' && !Array.isArray(block.example)) {
    return block.example as Record<string, unknown>;
  }

  const out: Record<string, unknown> = { type: block.type };

  if (block.props) {
    for (const [name, type] of Object.entries(block.props)) {
      // Enum-typed props get an enum value, not a free placeholder
      if (block.enums && block.enums[name]) {
        out[name] = pickEnumValue(block.enums[name]);
      } else {
        out[name] = placeholderForProp(name, type);
      }
    }
  }

  return out;
}


/**
 * Build the full {blockType: example} map for `--examples --json`.
 */
export function synthesizeAllExamples(blocks: BlockDef[]): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {};
  for (const block of blocks) {
    out[block.type] = synthesizeExample(block);
  }
  return out;
}
