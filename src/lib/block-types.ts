/**
 * Shared block-schema types so `commands/schema.ts`, the synthesizer
 * (`block-example-synth.ts`), and any future consumer agree on shape.
 */

export interface BlockDef {
  type: string;
  component: string;
  category: string;
  aliases?: string[];
  props?: Record<string, string>;
  enums?: Record<string, string[]>;
  notes?: string;
  example?: unknown;
}

export interface SchemaDoc {
  _meta: { version: string; source: string; note: string; extracted_from: string };
  envelope: { sections: string; notes: string[] };
  blocks: BlockDef[];
}
