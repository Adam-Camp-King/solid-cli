/**
 * The README `solid pull` leaves in the folder.
 *
 * ⛔ WHY. `solid pull` wrote pages/, kb/, services/, products/ and a manifest and said
 * nothing about any of them. A designer (or their AI) opened the folder and had to guess:
 * is a page file the page? what is it made of? how does a change go back? where does an
 * app go? They guessed, or wrote us a note. The folder now answers.
 *
 * It is written as SOLID-README.md, never README.md — that name is the project's own.
 * Pure: the text is a function of the company's name and address only.
 */
import * as fs from 'fs';
import * as path from 'path';

export const PULL_README = 'SOLID-README.md';

export function pullReadme(company: { name?: string; slug?: string }): string {
  const name = company.name || 'this business';
  const host = company.slug ? `${company.slug}.solidnumber.com` : '<company>.solidnumber.com';
  const appHost = company.slug ? `${company.slug}.solidhost.app` : '<company>.solidhost.app';
  return `# ${name} on Solid#

This folder is ${name}'s website and business data as files. \`solid pull\` wrote it;
\`solid push\` sends your changes back. Written for a person or an AI opening it cold.

## What is here

| Folder | What it is | Change it by |
|---|---|---|
| \`pages/<slug>.json\` | One website page each | editing the file, then \`solid push\` |
| \`kb/<title>.md\` | What the AI knows and answers from | editing the file, then \`solid push\` |
| \`services/\`, \`products/\` | What the business sells | editing the file, then \`solid push\` — it sends a changed name, description or category. A **price** is never pushed (\`service.update\` / \`product.update_pricing\`), and a new file is not created |
| \`solid.config.json\` | Name, phone, hours, address, website settings | \`solid push\` sends \`website_settings\` only; the rest with the verb \`company.update_profile\` |
| \`.solid/manifest.json\` | Which business this folder belongs to | never by hand |

\`solid push --dry-run\` shows what would change before anything does.

## What a page is made of

A page file's \`layout_json.sections\` is a list. Each entry is one **block**:

\`\`\`json
{ "type": "hero", "title": "Roof repairs, done in a day", "ctaText": "Get a quote", "ctaLink": "/contact" }
\`\`\`

The props sit at the top level, next to \`type\`. Ask before you write one:

\`\`\`bash
solid schema pages                    # every block type
solid schema pages --block hero       # one block: its props, what each list item holds,
                                      #   and what it needs before it shows anything
solid schema blocks --type hero       # a section that renders, to copy
solid schema blocks --starter         # a whole page that renders
\`\`\`

A block with nothing to show renders **nothing, with no error**. "shows when" in
\`solid schema pages --block <type>\` names what it needs.

### A page with one \`raw_html\` section

That page was imported from a custom design and **kept as designed** instead of being
rebuilt as blocks. Do not edit its HTML block by block. It is changed through its marked
spots (slots) — headline, images, buttons, phone:

\`\`\`bash
solid verbs invoke page.slot_list -p '{"page_id": <id>}'
solid verbs invoke page.slot_update -p '{"page_id": <id>, "slot": "<name>", "text": "..."}' --confirm
\`\`\`

The logo, name, phone and email in it follow the brand. Anything outside a slot is
changed by importing a new version of the design.

## Bringing a design, a site or an app

\`\`\`bash
solid bring <folder>                  # reads it and says: a page, an app, or server code — and what to run
solid bring --bringing nothing        # starting from scratch: the steps, in order
\`\`\`

- **A page** — a visitor reads it and fills in a form. It lives on \`${host}\` and the
  owner can change it. Import one with \`solid nest <file|folder|url>\`.
- **An app** — a visitor does something in it (steps, the camera, a calculated result).
  It lives on \`${appHost}/<name>/\` and its developer changes it. Publish the BUILT
  files with \`solid app publish <folder> --slug <name> --confirm\`.

No outside JavaScript runs on \`${host}\` (it shares the dashboard's sign-in), which is
why an app has its own address. No server code of yours runs anywhere: forms, booking,
chat and payment links are built in.

## Verbs

A verb is an **action** the platform performs — something you call, like
\`page.publish\`. It is not a word or a record and cannot be deleted. Nothing is held back:

\`\`\`bash
solid map                             # everything, by class and noun
solid find "<plain words>"            # search by what you want to do
solid verbs describe <name>           # one verb's inputs
\`\`\`
`;
}

/** Write it. Returns false when it was already there and identical. */
export function writePullReadme(baseDir: string, company: { name?: string; slug?: string }): boolean {
  const file = path.join(baseDir, PULL_README);
  const text = pullReadme(company);
  try {
    if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text) return false;
  } catch { /* unreadable — rewrite it */ }
  fs.writeFileSync(file, text);
  return true;
}
