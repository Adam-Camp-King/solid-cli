/**
 * The builder protocol, as the CLI carries it.
 *
 * ⛔ The wording is NOT written here. It is written once, in the backend
 * (solid-backend/services/builder_protocol.py), and saved into this package as
 * platform-docs/BUILDER-PROTOCOL.md by scripts/sync-builder-protocol.ts. This
 * file only reads that copy, so `solid how-to protocol` and the connector's
 * `how_to` cannot drift apart sentence by sentence.
 */
import * as fs from 'fs';
import * as path from 'path';

export const PROTOCOL_FILE = path.join(__dirname, '..', '..', 'platform-docs', 'BUILDER-PROTOCOL.md');
const CHECK_HEADING = '## The ten-question check';

/** The whole document, or null when this install does not carry it. */
export function protocolDocument(file: string = PROTOCOL_FILE): string | null {
  try {
    return fs.readFileSync(file, 'utf-8');
  } catch {
    return null;
  }
}

/** One `## ` section of the document, heading included. */
function section(doc: string, heading: string): string | null {
  const start = doc.indexOf(heading);
  if (start < 0) return null;
  const next = doc.indexOf('\n## ', start + heading.length);
  return doc.slice(start, next < 0 ? undefined : next).trim();
}

/** The short form `solid how-to protocol` prints: what it is, and the check. */
export function protocolBody(file: string = PROTOCOL_FILE): string {
  const doc = protocolDocument(file);
  const check = doc ? section(doc, CHECK_HEADING) : null;
  if (!doc || !check) {
    // Say so. An empty answer here would read as "there is no protocol".
    return [
      'The builder protocol is not in this install of the CLI.',
      'Update it (solid update), or ask the connector: how_to with topic="builder-protocol-full".',
    ].join('\n');
  }
  return [
    'Solid#\'s recommended process for anything built and connected to Solid#:',
    '  tests → security → build → held version → the owner\'s yes → live → verified → recorded',
    'It is optional. Solid# does not enforce it, and no publish is refused for lacking it.',
    '',
    check.replace(/^## /, ''),
    '',
    'solid how-to protocol --full     # the whole document: phases, decisions, pipeline, owner\'s manual',
    'solid how-to protocol --full > SOLID-BUILDER-PROTOCOL.md    # save it into the project for its AI',
    'solid feedback                   # a step that is wrong for your stack, or something that works better',
  ].join('\n');
}
