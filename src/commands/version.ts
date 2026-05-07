/**
 * solid version — capabilities probe for AI agents.
 *
 * Plain `--version` (commander built-in) just prints "2.3.2". That's
 * fine for humans but useless for an agent that needs to ask:
 *   "Is the verb I'm about to call actually in this CLI build?"
 *
 * `solid version --capabilities` returns a slim JSON probe — version,
 * schema_version, every verb path, and a list of capability flags an
 * agent can branch on. Cheaper than `solid schema --json` (which dumps
 * the full tree with every option/arg) when all the agent needs is
 * "does this command exist."
 *
 *   solid version                       → "@solidnumber/cli 2.3.2"
 *   solid version --json                → {version, node, schema_version}
 *   solid version --capabilities        → {version, verbs: [...], capabilities: [...]}
 */
import { Command } from 'commander';
import { CLI_VERSION } from '../lib/api-client';
import { isJsonOutput } from '../lib/json-output';
import { getProgram } from '../lib/program-registry';
import { walkVerbs } from '../lib/verb-manifest';

/** Stable list of capability flags the CLI advertises. Agents branch on this string. */
export const CLI_CAPABILITIES = [
  'json-output',
  'auto-json-non-tty',
  'structured-errors',
  'structured-errors-retryable',
  'verb-manifest',
  'schema-default-verbs',
  'capabilities-probe',
  'dry-run',
  'offline-queue',
  'pull-push-diff',
  'agent-broker',
  'mcp-client-config',
  'tenant-context-warning',
] as const;

export type CliCapability = (typeof CLI_CAPABILITIES)[number];

export interface CapabilitiesResponse {
  version: string;
  schema_version: string;
  node: string;
  capabilities: CliCapability[];
  verbs: string[];
  verb_count: number;
}

export interface VersionResponse {
  version: string;
  schema_version: string;
  node: string;
}

export function buildVersionResponse(): VersionResponse {
  return {
    version: CLI_VERSION,
    schema_version: '1.0',
    node: process.version,
  };
}

export function buildCapabilitiesResponse(verbPaths: string[]): CapabilitiesResponse {
  return {
    version: CLI_VERSION,
    schema_version: '1.0',
    node: process.version,
    capabilities: [...CLI_CAPABILITIES],
    verbs: verbPaths,
    verb_count: verbPaths.length,
  };
}

export const versionCommand = new Command('version')
  .description('Print CLI version + capabilities (agent-friendly probe)')
  .option('--json', 'Emit JSON')
  .option('--capabilities', 'Include the full capability + verb-path probe (implies --json)')
  .action((opts) => {
    if (opts.capabilities) {
      const program = getProgram();
      const verbs = program ? walkVerbs(program, { skipRoot: true, includeHidden: false }).map((v) => v.path) : [];
      process.stdout.write(JSON.stringify(buildCapabilitiesResponse(verbs), null, 2) + '\n');
      return;
    }
    if (isJsonOutput(opts)) {
      process.stdout.write(JSON.stringify(buildVersionResponse(), null, 2) + '\n');
      return;
    }
    console.log(`@solidnumber/cli ${CLI_VERSION}`);
  });
