/**
 * Shared block-schema types so `commands/schema.ts`, the synthesizer
 * (`block-example-synth.ts`), and any future consumer agree on shape.
 */

export interface BlockDef {
  type: string;
  component: string;
  category: string;
  aliases?: string[];
  /** Prop names the backend validator requires (from schemas/block_schema.py). */
  required?: string[];
  props?: Record<string, string>;
  enums?: Record<string, string[]>;
  notes?: string;
  example?: unknown;
  /** The props without which the block renders NOTHING (live: schemas/block_shapes.py). */
  shows_when?: string;
  /** The fields of each entry in a list prop (live). */
  items?: Record<string, string>;
  /** Where the example came from: read out of the renderer, or made up from prop types. */
  example_source?: 'live' | 'bundled' | 'synthesized';
}

export interface SchemaDoc {
  _meta: { version: string; source: string; note: string; extracted_from: string; synced_at?: string };
  envelope: { sections: string; notes: string[]; universal_optional_props?: string[]; motion_schema?: unknown;
    rules?: string[]; starter_page?: unknown };
  blocks: BlockDef[];
}
