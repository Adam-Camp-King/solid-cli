/**
 * The optional things the CLI can put on a machine — what each one is, who it
 * is for, how it works, and the exact way to turn it on. Written ONCE, here.
 *
 * ⛔ WHY THIS EXISTS. `solid update` printed "Agent skills + plugin: not set up"
 * and "Render browser: not set up" and nothing else. The owner asked his AI
 * what they meant (2026-10-05). The AI had nowhere to look it up, so it read
 * the CLI's installed files to work it out; asked to "set them both up", it
 * searched the whole home folder for somewhere to put the skills, created a
 * folder and downloaded the business's data into it. Nobody had asked for any
 * of that — the CLI had named a thing and explained nothing.
 *
 * So an extra is never named without three facts beside it — what it is, who
 * it is for, the one command — and an AI asked "what is this?" or "set it up"
 * is TOLD how it works and what to do (and what not to), by the CLI itself:
 * `solid update` prints it, `--json` carries it, `solid how-to extras` says it.
 *
 * ⛔ OPTIONAL MEANS OPTIONAL. Different people use the CLI differently: one runs
 * a whole business from a folder, another only publishes an app from their own
 * repo. `useful_when` lets each reader decide; nothing here is a to-do list.
 *
 * PURE: text and table lookups only.
 */

export type ExtraId = 'claude_hook' | 'completion' | 'project_kits' | 'browser';

export interface Extra {
  id: ExtraId;
  /** What a person calls it. */
  name: string;
  /** What it does, in one sentence. */
  what: string;
  /** Who would want it. */
  useful_when: string;
  /** The one command, as typed. */
  turn_on: string;
  /** Where that command must be run, when it matters. */
  turn_on_where?: string;
  /** For an AI: what it writes, where, and what it needs first. */
  how_it_works: string;
  /** For an AI asked to set it up: the steps, in order. */
  set_up: string[];
}

export const EXTRAS: Record<ExtraId, Extra> = {
  project_kits: {
    id: 'project_kits',
    name: 'Agent skills',
    what: 'Teaches your AI how to use Solid# correctly.',
    useful_when: 'Useful if you work on your business from a folder on this computer.',
    turn_on: 'solid agent setup',
    turn_on_where: 'run it inside that folder',
    how_it_works:
      'Writes four short skill files to .claude/skills/solid-* and a plugin package to .solid/plugin/ ' +
      'in ONE folder. That folder must already belong to one business: it carries .solid/manifest.json, ' +
      'which `solid pull` writes. It is never written to the home folder. `solid update` keeps it current.',
    set_up: [
      'Ask the person which folder holds their business\'s files. Do not search the disk for one.',
      'If they have one (it contains .solid/manifest.json): cd into it and run `solid agent setup`.',
      'If they have none: ask where they want it. `solid pull` in an empty folder creates it — and ' +
        'DOWNLOADS the business\'s pages and knowledge to disk and installs the skills, so say that and ' +
        'get a yes first.',
      'If they only publish an app from their own repository, they do not need this. Say so and stop.',
    ],
  },
  browser: {
    id: 'browser',
    name: 'Page screenshots',
    what: 'Lets you or your AI take a picture of a page to see how it looks.',
    useful_when: 'Useful if you check page designs from this computer.',
    turn_on: 'solid render --install',
    how_it_works:
      '`solid render <page>` needs a browser. It uses Google Chrome when Chrome is installed and nothing ' +
      'else is needed. Only on a machine with no Chrome does `solid render --install` download a private ' +
      'copy (about 150 MB) to ~/.solid/chromium/.',
    set_up: [
      'If `solid update` says screenshots are working, there is nothing to set up.',
      'Otherwise tell the person it is a 150 MB download, and on a yes run `solid render --install`.',
    ],
  },
  claude_hook: {
    id: 'claude_hook',
    name: 'Claude Code session hook',
    what: 'Hands Claude Code your business\'s context each time it starts in that business\'s folder.',
    useful_when: 'Useful if you use Claude Code on this computer.',
    turn_on: 'solid install',
    how_it_works:
      'Adds one SessionStart command to ~/.claude/settings.json. It prints context only inside a folder ' +
      'that belongs to a business, and nothing anywhere else. `solid install --uninstall` removes it.',
    set_up: ['Run `solid install`. `solid install --preview` shows the change without making it.'],
  },
  completion: {
    id: 'completion',
    name: 'Shell completion',
    what: 'Finishes solid commands when you press Tab.',
    useful_when: 'Useful if you type solid commands yourself.',
    turn_on: 'solid completion install',
    how_it_works:
      'Writes one completion file in the home folder for the shell in use and one line in that shell\'s ' +
      'startup file. `solid completion uninstall` removes both.',
    set_up: ['Run `solid completion install`, then open a new terminal.'],
  },
};

/**
 * What an AI is told when the person it works for asks "what is this?" or
 * "set it up". Addressed to the model, in the imperative.
 */
export const FOR_AI: string[] = [
  'Every item under "Optional" is an extra. Nothing is missing or broken; do not fix anything unasked.',
  'Asked what one is: say what it does and who it is for, from this text. Then ask if they want it.',
  'Asked to set one up: follow its steps exactly, and run its command as written. Nothing more.',
  'Do not read the CLI\'s installed files to find out how it works. `solid how-to extras` is the answer.',
  'Do not search the disk for a folder. Ask the person where their business\'s folder is.',
  'Do not download the business\'s data (`solid pull`) unless the person asked for it or said yes to it.',
];

export const HOWTO_COMMAND = 'solid how-to extras';

/** The fields a report carries for one extra. `turn_on` only while it is not on. */
export function describe(id: ExtraId, on: boolean): {
  optional: true; name: string; what: string; useful_when: string; how_it_works: string;
  turn_on?: string; turn_on_where?: string; set_up?: string[];
} {
  const e = EXTRAS[id];
  return {
    optional: true,
    name: e.name,
    what: e.what,
    useful_when: e.useful_when,
    how_it_works: e.how_it_works,
    ...(on ? {} : {
      turn_on: e.turn_on,
      ...(e.turn_on_where ? { turn_on_where: e.turn_on_where } : {}),
      set_up: e.set_up,
    }),
  };
}

/** The whole of it as plain text — the `solid how-to extras` answer. */
export function howToBody(): string {
  const out: string[] = [
    'Optional extras the CLI can put on this computer. None is required, and which ones are worth',
    'having depends on how you use Solid#. `solid update` shows which are on.',
    '',
  ];
  for (const e of Object.values(EXTRAS)) {
    out.push(`${e.name} — ${e.what}`);
    out.push(`  ${e.useful_when}`);
    out.push(`  Turn on:  ${e.turn_on}${e.turn_on_where ? `   (${e.turn_on_where})` : ''}`);
    out.push(`  How:      ${e.how_it_works}`);
    out.push('  To set it up:');
    for (const [i, step] of e.set_up.entries()) out.push(`    ${i + 1}. ${step}`);
    out.push('');
  }
  out.push('If you are an AI reading this for someone:');
  for (const line of FOR_AI) out.push(`  - ${line}`);
  return out.join('\n');
}
