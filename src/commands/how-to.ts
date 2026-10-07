/**
 * `solid how-to [question]` — plain-language discoverability.
 *
 * GPT's critique: nothing explains "how do I connect this to Claude/ChatGPT"
 * or "what can I actually do", and `solid help` is a command dump. This answers
 * those in plain language, offline (static product knowledge — no network).
 *
 * The matching logic is the pure `findHowTo()` so it's unit-testable.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { ui } from '../lib/ui';
import { howToBody } from '../lib/machine-extras';
import { protocolBody, protocolDocument } from '../lib/builder-protocol';

export interface HowToTopic {
  id: string;
  title: string;
  keywords: string[];
  body: string;
}

export const HOWTO_TOPICS: HowToTopic[] = [
  {
    id: 'connect',
    title: 'Connect Solid# to Claude, ChatGPT, or your terminal',
    keywords: ['connect', 'claude', 'chatgpt', 'openai', 'cursor', 'ai', 'mcp', 'connector', 'hook', 'integrate', 'setup', 'login'],
    body: [
      'Claude / ChatGPT (MCP connector):',
      '  Settings → Connectors → Add custom connector',
      '  URL: https://api.solidnumber.com/mcp/connector',
      '  Authorize (OAuth), pick your company — it only ever acts on that one.',
      '',
      'Your terminal / local AI tools:',
      '  solid auth login          # authenticate',
      '  solid context --claude    # give Claude Code this company’s context',
      '  solid ai                  # launch Claude / Gemini / Grok with context',
    ].join('\n'),
  },
  {
    id: 'start',
    title: 'Where to start as an operator',
    keywords: ['start', 'begin', 'today', 'first', 'brief', 'overview', 'what now', 'morning'],
    body: [
      'solid today        # daily brief: revenue, pipeline, urgent work, next actions',
      'solid doctor       # check auth, permissions, and connection health',
      'solid status       # your business setup at a glance',
      'solid crm          # contacts, deals, tasks, pipeline',
      'solid sales        # pipeline, forecasting, growth intelligence',
    ].join('\n'),
  },
  {
    id: 'capabilities',
    title: 'What the CLI can do',
    // ⛔ 'do' WAS HERE AND IT MATCHED ALMOST EVERY QUESTION. People ask "how DO
    // I …", so this topic won any question that did not match something else —
    // "how do I change which company I'm on" came back as "What the CLI can
    // do". Word-boundary matching does not save a keyword this common; the
    // keyword itself has to go. "what can" already carries the intent.
    keywords: ['what can', 'capabilities', 'commands', 'features', 'able to', 'list commands'],
    body: [
      'Run the business from the terminal:',
      '  solid today / crm / sales / leads / inbox    # see and work the pipeline',
      '  solid voice call|text|translate              # outbound voice + SMS',
      '  solid apply + solid publish                  # declare your site/products, take it live',
      '  solid embed <chat|form|paylink>              # paste-ready website snippets',
      '  solid agent dispatch <verb>                  # invoke any platform verb',
      '  solid pages / brand / seo / blog             # site, brand, content',
      '',
      'Full, persona-grouped list: solid --help',
    ].join('\n'),
  },
  {
    id: 'build',
    title: 'Build or bring a website or an app',
    keywords: ['design', 'designer', 'build a website', 'make a website', 'make an app', 'build an app',
      'figma', 'webflow', 'framer', 'lovable', 'bolt', 'import', 'bring', 'from scratch',
      // "how do I import my site" must land HERE. It used to land on the publish topic
      // (whose title holds the word "site") and be told to write a site.yaml.
      'import my site', 'import my website', 'my existing site', 'existing site', 'existing website',
      'clone', 'clone my site', 'copy my site', 'move my site', 'bring my site', 'bring my website',
      'already have a site', 'already have a website', 'nest',
      'page or app', 'app or page', 'javascript', 'backend', 'server code', 'structure', 'what format',
      'react', 'vite', 'hand coded', 'hand-coded'],
    body: [
      'solid bring                      # asks what you are bringing: nothing yet, a design, a site, an app',
      'solid bring <folder>             # reads the folder: a page, an app, or server code — and what to run',
      'solid nest <file|folder|url>     # a PAGE: import it (converted to editable blocks, or kept as designed)',
      '                                 #   the reply says which (import_mode), why, and the score out of 100',
      'solid drafts preview <page_id>   # a private link to look at it before anything is live',
      'solid app publish <built folder> --slug <name> --confirm   # an APP: publish its built files',
      'solid app github --slug <name>   # an APP: publish on every change (run once in the repo)',
      'solid schema pages               # the block structure a page is made of',
      'solid pull                       # this business\'s pages as local files (see the README it writes)',
      '',
      'Page or app? A visitor reads it and fills in a form → page (lives on <company>.solidnumber.com,',
      'the owner can edit it). A visitor does something in it — steps, the camera, a calculated result →',
      'app (lives on <company>.solidhost.app/<name>/, only its developer changes it). Server code is not',
      'run: forms, booking and chat are built in. The full rule: solid app --help',
    ].join('\n'),
  },
  {
    id: 'verbs',
    title: 'What a verb is',
    keywords: ['verb', 'verbs', 'what is a verb', 'action', 'actions', 'delete a verb', 'delete verb',
      'no verb', 'invoke', 'what can i call'],
    body: [
      'A verb is an ACTION the platform can perform — something you CALL, like page.publish.',
      'Tool, action, verb: the same thing. It is not a word, a record or a setting, and it cannot be',
      'created, edited or deleted. To remove or change a thing, call the verb that does it:',
      'kb.entry_delete deletes a knowledge entry. "There is no delete verb for X" means the platform',
      'has no action that deletes X.',
      '',
      "A name's LAST part is the action (create, update, publish); what comes before it is the NOUN",
      '(contact, page, app, kb). Most are two parts (page.publish); some carry an area first',
      '(crm.contacts.create). Reads answer at once; writes preview and need --confirm.',
      '',
      'solid map                        # everything, by class and noun',
      'solid verbs list <noun|prefix>   # one noun\'s verbs',
      'solid find "<plain words>"       # search by what you want to do',
      'solid verbs describe <name>      # one verb\'s inputs',
      'solid verbs invoke <name> -p \'{...}\' --confirm',
    ].join('\n'),
  },
  {
    // What `solid update` lists under "Optional", and how each one works — the
    // answer for a person, and for the AI they ask (lib/machine-extras.ts).
    id: 'extras',
    title: 'The optional extras on this computer, and how to turn one on',
    keywords: ['extras', 'optional', 'not set up', 'agent skills', 'skills', 'plugin', 'render browser',
      'render', 'browser', 'agent',
      'page screenshots', 'screenshots', 'chromium', 'session hook', 'shell completion', 'completion',
      'on this machine', 'turn on', 'set them up', 'set it up'],
    body: howToBody(),
  },
  {
    // Written once in the backend and carried here as a file (lib/builder-protocol.ts).
    // The connector's `how_to` answers the same questions with the same words.
    id: 'protocol',
    title: 'Check or build a project\'s process: tests, security, deploy, owner\'s manual',
    keywords: ['protocol', 'builder protocol', 'best practice', 'best practices', 'good process',
      'unit test', 'unit tests', 'regression', 'regression testing', 'testing', 'ci pipeline',
      'deploy process', 'deploy protocol', 'release process', 'security check', 'security checks',
      'secret scan', 'owners manual', 'quality gate', 'audit my project', 'check my project',
      // The title's own words carry punctuation ("tests,"), which a whole-word match never meets.
      'tests', 'security', 'process'],
    body: protocolBody(),
  },
  {
    id: 'publish',
    title: 'Get a site live',
    keywords: ['publish', 'website', 'site', 'live', 'deploy', 'launch', 'domain', 'page',
      'go live', 'take it live', 'make it live', 'preview', 'custom domain', 'dns'],
    body: [
      'You already have a site, a file or a folder (the usual case):',
      '  solid bring <folder>              # what is this, and which command?',
      '  solid nest <file|folder|url>      # import it — lands in your Sandbox, private',
      '  solid drafts preview <page_id>    # a private link to look at it first',
      '  solid nest promote <import_id>    # put it on your site, still a draft',
      '  solid publish <page_id>           # make it live   (everything pending: solid publish --all)',
      '  solid domains add <your-domain>   # your own domain; solid domains dns <id> lists the records',
      '  solid leads test                  # a labelled TEST lead through the live form',
      '',
      'A publish refused for fidelity (the import does not match its original closely enough) names',
      'a score: import again, or take it deliberately with solid publish <id> --accept-fidelity <score>.',
      '',
      'Starting from nothing, or declaring a whole site in one file:',
      '  solid bring --bringing nothing    # the steps, in order',
      '  solid apply site.yaml             # reconcile pages/products/site/agents/lines from one manifest',
      '  solid embed chat                  # wire live chat into any page',
    ].join('\n'),
  },
  {
    // The backend has had a test mode on its lead doors since 2026-09-30 (a hidden field
    // or JSON key, `_solid_test_lead`). It was named nowhere in this CLI, so an outside
    // agent checking a new site either put a real-looking lead in a real business's CRM or
    // skipped the step. `solid leads test` is that mode with a name.
    id: 'test-lead',
    title: 'Check a site\'s form works, without filing a real lead',
    keywords: ['test lead', 'test a lead', 'submit a test lead', 'test the form', 'test my form',
      'test form', 'form works', 'does the form work', 'lead test', 'check the form',
      'fake lead', 'dummy lead', 'try the form', 'end to end', 'test submission'],
    body: [
      'solid leads test                 # sends ONE lead through your live website form, labelled TEST',
      'solid leads test --json          # the same, machine-readable',
      '',
      'It runs the whole real path — the site\'s form address, the CRM record, and every alert the',
      'business has switched on — so it proves all three. Every alert says TEST, so nobody calls a',
      'customer who does not exist, and the contact is tagged (source website_contact_form_test) so',
      'it is easy to find and delete: solid crm contacts delete <id>.',
      '',
      'By hand, on any form or JSON post to the lead address: add the field _solid_test_lead=1.',
      'Do NOT type a made-up person into a client\'s live form to "see if it works" — that is a real',
      'lead in a real business\'s CRM, and someone will call it.',
    ].join('\n'),
  },
];

const DEFAULT_ID = 'start';

/**
 * Does this keyword appear as a WORD in the question?
 *
 * ⛔ SUBSTRING MATCHING MADE SHORT KEYWORDS MATCH EVERYTHING. `q.includes(kw)`
 * meant the `connect` topic's keyword `ai` fired on "expl-AI-n",
 * "em-AI-l", "av-AI-lable" and "f-AI-l", and the `capabilities` topic's
 * keyword `do` fired on any question containing the word "do" — which is most
 * of them, since people ask "how DO I…". Measured 2026-09-14:
 *
 *   "explain the pipeline"                     -> connect       (via expl-ai-n)
 *   "how do I change which company I'm on"     -> capabilities  (via do)
 *
 * Both answered confidently and neither question was about the topic
 * returned. A keyword is a word, so it is matched as one. Multi-word
 * keywords ("what can") still match as a phrase.
 */
function mentions(q: string, kw: string): boolean {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i').test(q);
}

function score(question: string, t: HowToTopic): number {
  const q = question.toLowerCase();
  if (!q) return 0;
  // A phrase is evidence; one common word is not. "what are the best practices" tied
  // the protocol topic (on the phrase) with capabilities (on "what", a title word) and
  // the earlier topic won. The backend's how_to weighs a phrase the same way.
  let s = t.keywords.reduce((acc, kw) => acc + (mentions(q, kw) ? (kw.includes(' ') ? 2 : 1) : 0), 0);
  s += t.title.toLowerCase().split(/\s+/).filter((w) => w.length > 3 && mentions(q, w)).length;
  return s;
}

/**
 * Pure: topics that actually match the question. MAY BE EMPTY.
 *
 * ⛔ AN UNMATCHED QUESTION USED TO RETURN THE "start" TOPIC, AND THE CALLER
 * COULD NOT TELL. That is the expensive failure for an agent: "how do I switch
 * company?" came back with a confident list of unrelated commands and no
 * signal that nothing had matched, so the agent reads it as answered and stops
 * looking. A tool that cannot answer has to say so — an empty result is a fact
 * the caller can act on, and a wrong one is not.
 */
export function findHowTo(question: string, limit = 2): HowToTopic[] {
  return HOWTO_TOPICS
    .map((t) => ({ t, s: score(question, t) }))
    .sort((a, b) => b.s - a.s)
    .filter((r) => r.s > 0)
    .slice(0, Math.max(1, limit))
    .map((r) => r.t);
}

/**
 * The how-to topics a search for a VERB should also point at. PURE.
 *
 * ⛔ WHY (clean-room dry run, 2026-10-06). `solid find` ranks backend verbs, and a class of
 * answers are CLI commands: `solid find "submit a test lead"` returned form.submit,
 * webhook.test and flows.test, while `solid leads test` did exactly that. `find` says
 * "CLI commands are not verbs" in a footer; it never said WHICH command.
 *
 * Only a phrase match counts here (score 2+) — one shared word is not evidence, and a
 * wrong pointer beside a right verb is worse than none.
 */
export function cliHowToFor(question: string): Array<{ topic: string; title: string; run: string }> {
  return HOWTO_TOPICS
    .map((t) => ({ t, s: score(question, t) }))
    .filter((r) => r.s >= 2)
    .sort((a, b) => b.s - a.s)
    .slice(0, 2)
    .map((r) => ({ topic: r.t.id, title: r.t.title, run: `solid how-to ${r.t.id}` }));
}

/** The topic shown when someone runs `how-to` with no question at all. */
export function defaultHowTo(): HowToTopic {
  return HOWTO_TOPICS.find((t) => t.id === DEFAULT_ID) as HowToTopic;
}

function renderTopic(t: HowToTopic): void {
  console.log('');
  console.log(chalk.bold.cyan(t.title));
  console.log(t.body);
}

export const howToCommand = new Command('how-to')
  .description('Plain-language answers: how to connect to Claude/ChatGPT, where to start, what the CLI can do')
  .argument('[question...]', 'What you want to do, e.g. "connect to claude"')
  .option('--full', 'With `protocol`: print the whole builder protocol as Markdown, ready to save into a project')
  .action((questionParts: string[] = [], opts: { full?: boolean } = {}) => {
    const question = (questionParts || []).join(' ').trim();

    if (opts.full) {
      // The one topic long enough to have a whole form. Printed bare, so it can be
      // redirected into a file and handed to the project's own AI.
      const top = question ? findHowTo(question)[0] : undefined;
      const doc = top?.id === 'protocol' ? protocolDocument() : null;
      if (!doc) {
        console.error(chalk.yellow('--full prints the builder protocol: solid how-to protocol --full'));
        process.exitCode = 1;
        return;
      }
      process.stdout.write(doc);
      return;
    }

    if (!question) {
      console.log('');
      console.log(ui.header('Solid# — how-to'));
      console.log(chalk.dim('Ask in plain language, e.g. `solid how-to connect to claude`. Topics:'));
      for (const t of HOWTO_TOPICS) {
        console.log(`  ${chalk.cyan(t.id.padEnd(14))} ${t.title}`);
      }
      console.log('');
      return;
    }

    const hits = findHowTo(question);

    if (hits.length === 0) {
      // ⛔ SAY SO. The previous behaviour printed the "start" topic here, which
      // reads exactly like an answer. Point at the two surfaces that DO cover
      // the whole CLI, so a miss still ends with the caller knowing where to go.
      console.log('');
      console.log(chalk.yellow(`No how-to topic matches ${JSON.stringify(question)}.`));
      console.log(chalk.dim('  how-to covers a few common topics only:'));
      for (const t of HOWTO_TOPICS) {
        console.log(`    ${chalk.cyan(t.id.padEnd(14))} ${t.title}`);
      }
      console.log('');
      console.log(chalk.dim('  For anything else, these cover the whole surface:'));
      console.log(chalk.dim('    solid schema verbs --json     every command, flag and description'));
      console.log(chalk.dim('    solid find "<what you want>"  rank backend verbs by intent'));
      console.log(chalk.dim('    solid --help                  the full command list'));
      console.log('');
      process.exitCode = 1;
      return;
    }

    for (const t of hits) renderTopic(t);
    console.log('');
  });
