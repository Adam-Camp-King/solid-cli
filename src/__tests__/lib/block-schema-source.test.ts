import {
  loadBundledSchema,
  mergeLiveSchema,
  resolveBlockSchema,
  UNDESCRIBED_PROP_TYPE,
} from '../../lib/block-schema-source';

const LIVE = {
  version: 1,
  block_types: ['contact', 'hero', 'new-block'],
  block_schema: {
    hero: { required: [], optional: ['id', 'title', 'subtitle'] },
    contact: { required: [], optional: ['id', 'title', 'fields', 'post_url'] },
    'new-block': { required: ['html'], optional: ['id', 'mystery'] },
  },
  type_aliases: { hero: 'hero', contact_form: 'contact', form: 'contact', newblock: 'new-block' },
  universal_optional_props: ['mcp_tools', 'motion'],
};

describe('bundled cms-blocks.json (offline fallback)', () => {
  const bundled = loadBundledSchema();
  const types = bundled.blocks.map((b) => b.type);

  it('matches solid-backend schemas/block_schema.py: 29 types including raw_html', () => {
    expect(types).toHaveLength(29);
    expect(types).toContain('raw_html');
    expect(bundled.blocks.find((b) => b.type === 'raw_html')?.required).toEqual(['html']);
  });

  it('carries the props the backend accepts on contact / booking / chat-widget / products', () => {
    const props = (t: string) => Object.keys(bundled.blocks.find((b) => b.type === t)?.props || {});
    expect(props('contact')).toEqual(expect.arrayContaining(['fields', 'submit_text', 'post_url']));
    expect(props('booking')).toEqual(expect.arrayContaining(['calendar_url', 'slot_duration']));
    expect(props('chat-widget')).toEqual(expect.arrayContaining(['agent_id']));
    expect(props('products')).toEqual(expect.arrayContaining(['product_ids']));
  });

  it('labels itself as a fallback', () => {
    expect(bundled._meta.note).toMatch(/OFFLINE FALLBACK/);
  });
});

describe('mergeLiveSchema', () => {
  const merged = mergeLiveSchema(LIVE, loadBundledSchema());

  it('uses the live block list as authoritative', () => {
    expect(merged.blocks.map((b) => b.type)).toEqual(['contact', 'hero', 'new-block']);
  });

  it('borrows prop types from the bundle and marks undescribed props explicitly', () => {
    const hero = merged.blocks.find((b) => b.type === 'hero')!;
    expect(hero.props).toEqual({ title: 'string', subtitle: 'string' });
    expect(hero.component).toBe('Hero');
    const nb = merged.blocks.find((b) => b.type === 'new-block')!;
    expect(nb.props).toEqual({ html: UNDESCRIBED_PROP_TYPE, mystery: UNDESCRIBED_PROP_TYPE });
    expect(nb.required).toEqual(['html']);
    expect(nb.aliases).toEqual(['newblock']);
  });

  it('derives aliases from type_aliases and carries universal props', () => {
    expect(merged.blocks.find((b) => b.type === 'contact')!.aliases).toEqual(['contact_form', 'form']);
    expect(merged.envelope.universal_optional_props).toEqual(['mcp_tools', 'motion']);
  });
});

describe('resolveBlockSchema', () => {
  it('returns live when the fetch succeeds', async () => {
    const r = await resolveBlockSchema({ fetcher: async () => LIVE });
    expect(r.source.kind).toBe('live');
    expect(r.source.stale).toBe(false);
  });

  it('falls back to the bundle, flagged stale with the reason, when the fetch fails', async () => {
    const r = await resolveBlockSchema({ fetcher: async () => { throw new Error('ECONNREFUSED'); } });
    expect(r.source.kind).toBe('bundled');
    expect(r.source.stale).toBe(true);
    expect(r.source.fallback_reason).toContain('ECONNREFUSED');
    expect(r.schema.blocks.length).toBe(29);
  });

  it('falls back on an unexpected payload shape', async () => {
    const r = await resolveBlockSchema({ fetcher: async () => ({ detail: 'nope' }) });
    expect(r.source.kind).toBe('bundled');
  });

  it('--offline never calls the fetcher', async () => {
    const fetcher = jest.fn();
    const r = await resolveBlockSchema({ offline: true, fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.source.kind).toBe('bundled');
  });
});
