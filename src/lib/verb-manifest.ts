/**
 * Pure verb-manifest walker.
 *
 * Walks a Commander tree and emits a flat list of {path, description,
 * options, args, subcommands} entries. Used by `solid schema verbs
 * --json` so agents (Claude Code, Cursor) can discover every verb the
 * CLI exposes without scraping --help.
 *
 * No I/O, no commander parsing — just tree traversal + field
 * extraction. Unit-tested in src/__tests__/verb-manifest.test.ts.
 */
import type { Command } from 'commander';

export interface VerbOption {
  flags: string;
  description: string;
  required: boolean;
  default?: unknown;
}

export interface VerbArg {
  name: string;
  required: boolean;
  description?: string;
  variadic?: boolean;
}

export interface VerbEntry {
  /** Short name — e.g. "pages". */
  verb: string;
  /** Full invocation path — e.g. "solid schema pages". */
  path: string;
  /** One-line description from .description(). */
  description: string;
  /** How deep in the tree (0 = root children, 1 = grandchildren, ...). */
  depth: number;
  /** Options on this command (NOT inherited). */
  options: VerbOption[];
  /** Positional args declared on this command. */
  args: VerbArg[];
  /** Subcommand names (not full paths). */
  subcommands: string[];
  /** True when this command has no subcommands and can be invoked directly. */
  is_leaf: boolean;
}

interface MinimalOption {
  flags?: string;
  description?: string;
  required?: boolean;
  mandatory?: boolean;
  defaultValue?: unknown;
}

interface MinimalArg {
  _name?: string;
  name?: (() => string) | string;
  required?: boolean;
  description?: string;
  variadic?: boolean;
}

/** Safely extract option metadata, tolerant of both commander v7 and v10 shapes. */
function toOption(o: MinimalOption): VerbOption {
  const entry: VerbOption = {
    flags: o.flags ?? '',
    description: o.description ?? '',
    required: Boolean(o.required ?? o.mandatory ?? false),
  };
  if (o.defaultValue !== undefined) {
    entry.default = o.defaultValue;
  }
  return entry;
}

/** Safely extract arg metadata from commander's Argument class. */
function toArg(a: MinimalArg): VerbArg {
  // commander v7 stores args as { _name, required, description, variadic }
  // commander v10 Argument class has a .name() method
  let name = '';
  if (typeof a.name === 'function') {
    try {
      name = (a.name as () => string)();
    } catch {
      name = '';
    }
  } else if (typeof a.name === 'string') {
    name = a.name;
  } else if (a._name) {
    name = a._name;
  }
  const entry: VerbArg = {
    name,
    required: Boolean(a.required ?? false),
  };
  if (a.description) entry.description = a.description;
  if (a.variadic) entry.variadic = true;
  return entry;
}

export interface WalkOptions {
  /** Prefix prepended to every path. Defaults to "solid". */
  prefix?: string;
  /** Skip the root cmd itself — emit only its descendants. Default true. */
  skipRoot?: boolean;
  /** Include hidden commands (commander hides some with .hidden()). Default false. */
  includeHidden?: boolean;
}

/**
 * Recursively walk a Commander tree and return a flat manifest.
 *
 * Pure — depends only on properties accessible through Commander's public
 * surface plus tolerant fallbacks for its internal fields.
 */
export function walkVerbs(root: Command, opts: WalkOptions = {}): VerbEntry[] {
  const prefix = opts.prefix ?? 'solid';
  const skipRoot = opts.skipRoot ?? true;
  const includeHidden = opts.includeHidden ?? false;

  const out: VerbEntry[] = [];

  function visit(cmd: Command, pathPrefix: string, depth: number): void {
    // commander exposes _hidden (v7) or cmd._hidden — tolerant access.
    const hidden = Boolean((cmd as unknown as { _hidden?: boolean })._hidden);
    if (hidden && !includeHidden) return;

    const name = cmd.name();
    const thisPath = pathPrefix ? `${pathPrefix} ${name}` : name;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rawArgs: MinimalArg[] = (cmd as any)._args ?? (cmd as any).registeredArguments ?? [];
    const options = (cmd.options || []).map(toOption);
    const args = rawArgs.map(toArg);
    const subcommands = (cmd.commands || []).map((sc) => sc.name());

    out.push({
      verb: name,
      path: thisPath,
      description: cmd.description() || '',
      depth,
      options,
      args,
      subcommands,
      is_leaf: subcommands.length === 0,
    });

    for (const sc of cmd.commands || []) {
      visit(sc, thisPath, depth + 1);
    }
  }

  if (skipRoot) {
    // Emit the root's children only — typical for a CLI where the root IS
    // the program name and has no verb of its own.
    for (const sc of root.commands || []) {
      visit(sc, prefix, 0);
    }
  } else {
    visit(root, '', 0);
  }

  return out;
}

/** Build the wire payload for `solid schema verbs --json`. */
export interface VerbManifest {
  version: '1.0';
  cli_version: string;
  count: number;
  verbs: VerbEntry[];
}

export function buildVerbManifest(
  root: Command,
  cliVersion: string,
  opts?: WalkOptions,
): VerbManifest {
  const verbs = walkVerbs(root, opts);
  return {
    version: '1.0',
    cli_version: cliVersion,
    count: verbs.length,
    verbs,
  };
}
