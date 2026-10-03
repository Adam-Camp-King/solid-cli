/**
 * The skills index — what Solid# teaches a coding agent about itself.
 *
 * ⛔ WHY AN INDEX AND NOT MORE ONE-OFFS. `solid-commerce` was installed by a
 * single call buried inside `solid context --claude`. It worked, but it meant
 * the only way to gain a skill was to add another hard-coded call at another
 * call site, and there was no way to ask "what skills are there?" — not from
 * the CLI, not from an agent, not from us. One more skill written that way
 * would have made three copies of the same install logic.
 *
 * A skill here is the Agent Skills standard and nothing invented: a directory
 * under `.claude/skills/<name>/` holding a `SKILL.md` whose YAML frontmatter
 * carries `name` and `description`. Claude Code and anything else that reads
 * that layout picks them up with no further wiring. Matching the standard is
 * the entire point — a bespoke format would need a bespoke reader.
 *
 * ⛔ ROLE-2 BOUNDARY. These files describe ONE company's platform and land in
 * a tenant-bound directory only. Callers must clear `requireTenantManifest`
 * first, exactly as `commerce-skill.ts` documents: never `$HOME`, never
 * `$HOME/.claude/`, never the platform monorepo.
 *
 * ⚠️ EVERY COMMAND NAMED IN A SKILL BELOW WAS CHECKED TO EXIST. A skill that
 * teaches an agent a command we do not ship is worse than no skill: the agent
 * runs it, gets "unknown command", and distrusts the rest of the file. `solid
 * pin` and `solid use` read naturally and are NOT real — they were cut for
 * that reason.
 */
import * as fs from 'fs';
import * as path from 'path';

import { COMMERCE_SKILL_CONTENT, COMMERCE_SKILL_DIRNAME } from '../commerce-skill';

export interface Skill {
  /** Directory name under `.claude/skills/`. Also the frontmatter `name`. */
  dirname: string;
  /** One line; this is what an agent reads to decide whether to open the file. */
  description: string;
  /** Full `SKILL.md` contents, frontmatter included. */
  content: string;
}

const VERBS_SKILL = `---
name: solid-verbs
description: Discover and call Solid# verbs correctly — read the manifest instead of guessing command names, check what a verb returns before chaining it, and know which calls mutate state. Use before running any solid command you have not run in this session.
---

# Calling Solid# verbs

## What a verb is

A verb is an **action the platform can perform** — something you CALL, like
\`page.publish\`. Tool, action, verb: the same thing under three names (the
connector says "action"). It is not a word, a record or a setting, and it
cannot be created, edited or deleted. To remove or change a *thing*, call the
verb that does it: \`kb.entry_delete\` deletes a knowledge entry. "There is no
delete verb for X" means the platform has no action that deletes X.

A name reads \`thing.action\`: before the dot is the noun (contact, page, app,
kb), after it what is done to it.

**Nothing is held back.** Any list you are shown is a starting set, not the
whole platform:

\`\`\`bash
solid map                        # everything, by class and noun
solid verbs list <prefix>        # one neighbourhood of the map
solid find "<plain words>"       # search by what you want to do
solid verbs describe <name>      # one verb's inputs
\`\`\`

Never tell a person the platform cannot do something until \`solid find\` and
\`solid map\` both came back without it.

This CLI is self-describing. **Read the contract, do not guess the command.**
Guessing produces "unknown command" and a wasted turn; the manifest is one call
away and is always current, because it is generated from the same registry the
server dispatches from.

## Find the verb

\`\`\`bash
solid schema verbs --json        # every command, its options and arguments
solid schema describe <verb>     # one verb: input, output, errors, mutates flag
solid schema contracts --json    # all contracts at once, for a tool manifest
\`\`\`

Use \`--reads-only\` or \`--mutates-only\` on \`contracts\` to separate the safe
calls from the ones that change something.

## Know what comes back before you chain

\`solid schema envelopes\` gives the response shape per command type. Individual
verbs also publish an \`output_schema\`.

⚠️ **An output schema is a hint, not a contract.** Where it is marked
\`x-solid-derivation: inferred-from-return-literals\`, the keys were recovered by
reading the verb's source, not by observing a response. So:

- no key is guaranteed present — check before you index into it;
- the list may be incomplete — \`additionalProperties\` is true;
- value types are unknown.

Treat those keys as "worth looking for", never as a promise. A verb with no
inferred schema is not broken; its shape simply could not be read statically.

## Reads and writes are not the same risk

Every contract carries a \`mutates\` flag. A mutating verb may also require an
explicit confirmation before it runs — the CLI will say so rather than doing it
quietly. Do not try to route around a confirmation prompt; it is the boundary
that makes an agent safe to run unattended.

## When something fails

\`\`\`bash
solid doctor        # what is broken about this environment, in order
\`\`\`

Run it before reporting a bug or retrying a failing call a third time.
`;

const TENANCY_SKILL = `---
name: solid-tenancy
description: Confirm which business you are acting on before any Solid# write. This directory is bound to one company, and a command run against the wrong tenant writes real data to a real customer. Use before the first write of any session.
---

# Which business am I writing to?

Solid# is multi-tenant. Every write lands in **one real company's** data — its
CRM, its invoices, its customers. There is no staging shadow behind these
commands, and no undo for most of them.

## Check the pin before the first write

\`\`\`bash
solid scope whoami        # the effective scope contract for this session, as JSON
\`\`\`

Read it and confirm it names the company you mean. Do this once per session
before the first mutating call — not after something looks wrong.

## The binding lives in the directory

A tenant-bound directory holds \`.solid/manifest.json\`, and that binding is what
authorises tenant-specific context and skills to exist here at all. If it is
absent, this is not a tenant directory and you should not be generating
company-specific work in it.

## Rules that are not negotiable

- **Never assume the pin carried over** from an earlier session, another
  terminal, or another directory. Sessions are not the unit of tenancy;
  the directory and the credential are.
- **Never write to a company you did not confirm this session.** "It was right
  last time" is how data reaches the wrong customer.
- **A read is a fine way to check.** Prefer a read-only verb to confirm you are
  where you think you are before issuing the write.
- **If the scope contract and your intent disagree, stop and say so.** Do not
  pick the interpretation that lets the task continue.
`;

const BUILDING_SKILL = `---
name: solid-building
description: Build or bring a website or an app onto Solid# — decide page or app from the files, pick the one right import or publish command, and know what a kept design lets you change. Use before importing, publishing or hand-coding anything a visitor will see.
---

# Building or bringing a website or an app

## Start with the front door, every time

\`\`\`bash
solid bring <folder> --json          # reads the folder: page, app, or server code — and the next command
solid bring --bringing nothing --json   # starting from scratch: the steps, in order
\`\`\`

Do not ask the person whether it is a page or an app. The files say, and
\`solid bring\` reads them.

## Page or app — the rule

- **Page**: a visitor reads it and fills in a form. It lives on
  \`<company>.solidnumber.com\`, and the owner can change it afterwards.
- **App**: a visitor *does* something in it — steps, the camera, a calculated
  result, anything that needs its own JavaScript. It lives on
  \`<company>.solidhost.app/<name>/\`, and only its developer changes it.

Why two places: \`*.solidnumber.com\` shares the dashboard's sign-in, so no
outside JavaScript runs there. An app gets its own address so it can.
A company can have many apps; each takes its own \`<name>\`.

## A page

\`\`\`bash
solid nest <file|folder|url>     # the one import: previews, builds, scores, can be rolled back
\`\`\`

The reply says which way it went (\`import_mode\`):

- **convert** — rebuilt as native blocks. Edited block by block.
- **keep** — it could not be rebuilt faithfully, so it is stored as designed.
  It is changed through its **slots**: the marked spots (headline, images,
  buttons, phone). List and change them with the verbs \`page.slot_list\` and
  \`page.slot_update\`. The logo, name, phone and email follow the brand.
  Anything outside a slot is changed by importing a new version.

Hand-coding a page? Mark what the owner should be able to change with
\`data-editable="<name>"\`, and brand-following spots with
\`data-brand="logo|name|phone|email"\`.

## An app

\`\`\`bash
solid app publish <built folder> --slug <name> --confirm   # the BUILT files (dist/, build/), not the source
solid app github --slug <name>                             # publish on every change; run once in the repo
\`\`\`

## Server code is not run

No tenant server code runs here — no Node, PHP or database of your own. Use
what is built in instead: a form sends a lead, booking, chat and payment links
are platform features. \`solid bring\` names the replacement for what it finds.
`;

/**
 * Every skill Solid# installs, in install order.
 *
 * ⛔ `solid-commerce` is IMPORTED, never copied. One source of truth: a second
 * copy here would drift from the one `solid context --claude` writes, and two
 * files claiming to be the same skill is worse than one stale file.
 */
export const SKILLS: Skill[] = [
  {
    dirname: COMMERCE_SKILL_DIRNAME,
    description:
      'Wire generated websites to the real backend — forms, chat, payment links.',
    content: COMMERCE_SKILL_CONTENT,
  },
  {
    dirname: 'solid-verbs',
    description:
      'Discover and call verbs from the manifest; read output schemas as hints, not contracts.',
    content: VERBS_SKILL,
  },
  {
    dirname: 'solid-building',
    description:
      'Build or bring a website or an app: page or app, the one import, slots in a kept design.',
    content: BUILDING_SKILL,
  },
  {
    dirname: 'solid-tenancy',
    description:
      'Confirm which company a write lands on before making it.',
    content: TENANCY_SKILL,
  },
];

export interface InstalledSkill {
  dirname: string;
  path: string;
  /** 'written' — new or changed. 'unchanged' — byte-identical, left alone. */
  state: 'written' | 'unchanged';
}

/**
 * Write every skill into `<baseDir>/.claude/skills/<name>/SKILL.md`.
 *
 * ⛔ The caller is responsible for the tenant guard. This function does not
 * check, because the two call sites already have a verified manifest in hand
 * and re-deriving it here would invite a third caller that skips it.
 *
 * Byte-identical files are reported as `unchanged` and not rewritten, so
 * re-running is quiet and does not churn mtimes in a watched directory.
 */
export function installSkills(baseDir: string, skills: Skill[] = SKILLS): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  for (const skill of skills) {
    const dir = path.join(baseDir, '.claude', 'skills', skill.dirname);
    const file = path.join(dir, 'SKILL.md');
    let state: InstalledSkill['state'] = 'written';
    if (fs.existsSync(file)) {
      try {
        if (fs.readFileSync(file, 'utf8') === skill.content) state = 'unchanged';
      } catch {
        /* unreadable — fall through and rewrite it */
      }
    }
    if (state === 'written') {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, skill.content);
    }
    out.push({ dirname: skill.dirname, path: file, state });
  }
  return out;
}
