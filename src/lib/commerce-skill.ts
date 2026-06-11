/**
 * The solid-commerce Claude Code skill — installed into a tenant-bound
 * directory's `.claude/skills/` by `solid context --claude` (both ladder and
 * legacy-full modes). Teaches a coding agent to wire the sites it generates
 * to the company's REAL backend instead of emitting dead markup.
 *
 * Role-2 boundary: callers reach this only after requireTenantManifest /
 * tenantManifestForHook has passed, so the skill can never land in $HOME or
 * the platform monorepo (CLAUDE-CONTEXT-CANONICAL-TRUTH.md).
 */
import * as fs from 'fs';
import * as path from 'path';

export const COMMERCE_SKILL_DIRNAME = 'solid-commerce';

export const COMMERCE_SKILL_CONTENT = `---
name: solid-commerce
description: Wire generated websites to the Solid# backend — live contact forms (CRM + lead scoring), AI chat widget, payment-link checkout, declarative publish. Use whenever building or editing a website in this directory.
---

# Solid# Commerce Wiring

This directory is bound to a Solid# company (\`.solid/manifest.json\`). Every
form, chat bubble, or payment button you generate can be REAL — backed by the
company's CRM, AI agents, and payment links — instead of dead markup. Prefer
wiring to inventing placeholders.

## Contact / lead forms

Never emit a \`<form>\` that goes nowhere. Wire it to a Solid# lead form —
submissions create CRM contacts, score the lead, and trigger follow-up:

1. Find a form id: \`solid forms list\` (or the company context shelves).
2. Emit the snippet: \`solid embed form <id>\` (add \`--react\` for a component).
3. Or hand-wire: POST \`{ data: {<fields>}, attribution: {referrer, url} }\`
   to \`<api>/api/v1/public/forms/<id>/submit\` (public, no auth).

## AI chat widget

One script tag gives the site a live AI agent trained on this company:

\`solid embed chat <integration_id>\`   (ids: \`solid chat-widgets list\`)

## Payments

Payment links render processor-hosted checkout pages — the site only needs a
link. \`solid embed paylink <link_id> --label "Pay deposit"\`. Creating links
moves money-adjacent state: the human approves it (typed phrase when asked).

## Publish

Declarative, one file for the whole surface (pages, site, domain, survey,
products): write \`site.yaml\`, then

\`solid apply site.yaml --dry-run\`  →  \`solid apply site.yaml\`  →  \`solid publish --all\`

Pages go live on the company's subdomain immediately; custom domains need
\`solid domains verify <id>\` after DNS is set. Format reference:
\`solid apply --kinds\` and Owners-Manual/45-Developer-CLI/APPLY-DECLARATIVE-MANIFESTS.md.

## Rules

- Stay inside this directory — context and writes are scoped to THIS company.
- Don't hardcode company ids; the CLI session carries the binding.
- Financial actions (payment links, charges) always preview first; the human
  types the approval phrase. Never compose that phrase yourself.
`;

/** Write the skill into <baseDir>/.claude/skills/solid-commerce/SKILL.md. */
export function installCommerceSkill(baseDir: string): string {
  const skillDir = path.join(baseDir, '.claude', 'skills', COMMERCE_SKILL_DIRNAME);
  fs.mkdirSync(skillDir, { recursive: true });
  const skillPath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(skillPath, COMMERCE_SKILL_CONTENT);
  return skillPath;
}
