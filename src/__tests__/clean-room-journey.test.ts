/**
 * The clean-room journey — every place an outside agent got stuck, pinned.
 *
 * 2026-10-06: a dry run of "a stranger's AI sets a client up with only the public CLI"
 * (ShowerPros was the client) found seven places the help text and the output lost the
 * thread. Each one is a test here. They are pure: the shaping, the matching and the
 * wording — the parts that decide whether an agent can follow the journey cold.
 */
import { shapeIntake } from '../commands/bring';
import { cliForNext, nestOutcome, nestOutcomeLines } from '../commands/nest-helpers';
import { nestCommand } from '../commands/nest';
import { fidelityRefusal, parseAcceptFidelity, publishCommand } from '../commands/publish';
import { cliHowToFor, findHowTo, HOWTO_TOPICS } from '../commands/how-to';
import { leadsCommand } from '../commands/leads';
import { siteLeadUrl, testLeadBody, TEST_LEAD_MARKER } from '../commands/leads-test';
import { domainsCommand } from '../commands/domains';

const help = (cmd: { helpInformation(): string }): string => {
  let out = cmd.helpInformation();
  // addHelpText('after', …) is emitted on the 'afterHelp' event, not in helpInformation().
  const chunks: string[] = [];
  (cmd as any).emit?.('afterHelp', { error: false, command: cmd, write: (s: string) => chunks.push(s) });
  out += chunks.join('');
  return out;
};

// 1 ── solid bring <folder> buried its answer ─────────────────────────────────────────
describe('1. bring leads with the verdict', () => {
  const sources = Array.from({ length: 16 }, (_, i) => ({ name: `tool-${i}`, how: 'x'.repeat(200) }));
  const verdict = { this_is: 'page', confidence: 'high', in_plain_words: 'A page.',
    next: { cli: 'solid nest <file or folder>' } };
  const raw = { ok: true, sources, any_website: 'a', page_or_app: { in_plain_words: 'b' },
    verdict, items: sources, total: 16, page: null, has_more: null };

  it('puts the verdict and the next command first, and never prints the catalogue twice', () => {
    const out = shapeIntake(raw);
    const keys = Object.keys(out);
    expect(keys.slice(0, 3)).toEqual(['ok', 'verdict', 'next']);
    expect(out.next).toEqual({ cli: 'solid nest <file or folder>' });
    expect(out.sources).toBeUndefined();
    expect(out.items).toBeUndefined();
    expect(out.sources_omitted).toMatch(/16 design tools/);
    // The verdict is inside the first 600 characters of the answer, not after 8 KB of tools.
    expect(JSON.stringify(out).indexOf('"verdict"')).toBeLessThan(40);
    expect(JSON.stringify(out).length).toBeLessThan(JSON.stringify(raw).length / 4);
  });

  it('still lists every tool, once, when the question is what can be brought', () => {
    const { verdict: _v, ...noFolder } = raw;
    const out = shapeIntake(noFolder);
    expect(out.sources).toHaveLength(16);
    expect(out.items).toBeUndefined();
  });
});

// 2 ── solid nest dropped the part the agent needs ────────────────────────────────────
describe('2. nest says whether the design was kept, why, the score and what next', () => {
  const kept = {
    import_id: 'imp_1', status: 'completed', created: { page: { id: 299, url: '/home' } },
    import_mode: 'keep', import_mode_why: 'kept as written scores 100, converted scores 58',
    fidelity_modes: { keep: { overall: 100 }, convert: { overall: 58 } },
    fidelity: { overall: 100, threshold: 80, dimensions: { layout: 100, palette: 100 } },
    summary: 'Your page was kept as written — your CSS, your markup, your form.',
    next: { verb: 'nest.promote', why: 'The clone is built in the sandbox.' },
  };

  it('carries every field through, in one shape', () => {
    const o = nestOutcome(kept, { importId: 'imp_1', mode: 'sandbox', pageType: 'home' });
    expect(o).toMatchObject({
      import_id: 'imp_1', status: 'completed', mode: 'sandbox', page_type: 'home', page_id: 299, url: '/home',
      import_mode: 'keep', import_mode_why: 'kept as written scores 100, converted scores 58',
      fidelity: { overall: 100, threshold: 80, passes: true },
      fidelity_modes: { keep: 100, convert: 58 },
      summary: kept.summary,
      preview: { cli: 'solid drafts preview 299' },
      next: { verb: 'nest.promote', cli: 'solid nest promote imp_1', why: 'The clone is built in the sandbox.' },
    });
  });

  it('prints it for a person: design, why, score, preview, next', () => {
    const text = nestOutcomeLines(nestOutcome(kept, { importId: 'imp_1', mode: 'sandbox' })).join('\n');
    expect(text).toMatch(/Design:\s+KEPT as written/);
    expect(text).toMatch(/Why:\s+kept as written scores 100/);
    expect(text).toMatch(/Fidelity: 100\/100 against the original \(a publish needs 80\)/);
    expect(text).toMatch(/Preview:\s+solid drafts preview 299/);
    expect(text).toMatch(/Next:\s+solid nest promote imp_1/);
  });

  it('says so when the design was converted, why it was not kept, and what is weakest', () => {
    const o = nestOutcome({ ...kept, import_mode: 'convert', fell_back_from_keep: { summary: 'its script cancels the form submit' },
      fidelity: { overall: 61, threshold: 80, dimensions: { palette: 40, layout: 55, text: 90 } } }, { mode: 'sandbox' });
    const text = nestOutcomeLines(o).join('\n');
    expect(o.fidelity).toMatchObject({ overall: 61, passes: false, weakest: [{ dimension: 'palette', score: 40 }, { dimension: 'layout', score: 55 }] });
    expect(text).toMatch(/CONVERTED to editable blocks/);
    expect(text).toMatch(/Not kept: its script cancels the form submit/);
    expect(text).toMatch(/61\/100 against the original \(a publish needs 80\) — weakest: palette 40, layout 55/);
  });

  it('a bare answer (an older backend) still gets a next step, and invents nothing', () => {
    const o = nestOutcome({ import_id: 'imp_2', status: 'completed' }, { mode: 'sandbox' });
    expect(o.import_mode).toBeNull();
    expect(o.fidelity).toBeNull();
    expect(o.preview).toBeNull();
    expect(o.next).toMatchObject({ verb: 'nest.promote', cli: 'solid nest promote imp_2' });
    expect(nestOutcomeLines(o).join('\n')).not.toMatch(/Design:|Fidelity:/);
  });

  it('names a CLI command for each next step the backend can name', () => {
    expect(cliForNext('page.publish', { pageId: 7 })).toBe('solid publish 7');
    expect(cliForNext('page.preview_url', { pageId: 7 })).toBe('solid drafts preview 7');
    expect(cliForNext('nest.rollback', { importId: 'imp_1' })).toBe('solid ant rollback imp_1');
    expect(cliForNext('something.new', {})).toBe('solid verbs describe something.new');
    expect(cliForNext(null, {})).toBeNull();
  });
});

// 3 + 4 ── nest --help: the folder case, keep vs convert, the score, the preview step ─────
describe('3 + 4. nest --help describes the folder case and names the preview step', () => {
  const text = help(nestCommand);
  it('has a folder example and says the default is the Sandbox, not a live page', () => {
    expect(text).toMatch(/solid nest \.\/my-site/);
    expect(text).toMatch(/Sandbox/);
    expect(nestCommand.description()).not.toMatch(/→ live page/);
  });
  it('explains keep and convert and the score', () => {
    expect(text).toMatch(/import_mode\s+keep/);
    expect(text).toMatch(/convert\s+rebuilt from our editable blocks/);
    expect(text).toMatch(/score out of 100/);
  });
  it('names the preview step and the whole journey in order', () => {
    const order = ['solid bring <folder>', 'solid nest <file|folder|url>', 'solid drafts preview <page_id>',
      'solid nest promote <import_id>', 'solid publish <page_id>', 'solid domains', 'solid leads test'];
    let at = -1;
    for (const step of order) {
      const i = text.indexOf(step, at + 1);
      expect(i).toBeGreaterThan(at);
      at = i;
    }
  });
});

// 5 ── the fidelity refusal had no CLI answer ─────────────────────────────────────────
describe('5. a fidelity refusal is answered with the command to run', () => {
  const refusal = { response: { status: 409, data: { detail: {
    reason: 'fidelity_below_threshold',
    message: 'This conversion scores 62/100 against the site you gave us (needs 80).',
    fidelity: { overall: 62, threshold: 80, dimensions: { palette: 41, fonts: 50, text: 95 } },
    next: { verb: 'nest.import' } } } } };

  it('reads the score and names both ways through', () => {
    const r = fidelityRefusal(refusal, 299)!;
    expect(r).toMatchObject({ overall: 62, threshold: 80,
      accept_with: 'solid publish 299 --accept-fidelity 62',
      weakest: [{ dimension: 'palette', score: 41 }, { dimension: 'fonts', score: 50 }] });
    expect(r.or_reimport).toMatch(/^solid nest /);
  });
  it('is not triggered by any other refusal', () => {
    expect(fidelityRefusal({ response: { status: 403, data: { detail: { reason: 'blocked_by_guardrails' } } } }, 1)).toBeNull();
    expect(fidelityRefusal(new Error('network'), 1)).toBeNull();
  });
  it('solid publish has the flag, and it takes only a whole score', () => {
    expect(publishCommand.options.map((o) => o.long)).toContain('--accept-fidelity');
    expect(parseAcceptFidelity('62')).toBe(62);
    expect(parseAcceptFidelity(undefined)).toBeUndefined();
    for (const bad of ['yes', '62.5', '-1', '101', '']) expect(() => parseAcceptFidelity(bad)).toThrow(/whole number/);
  });
});

// 6 ── how-to led with the wrong path, and help cited files a client cannot read ──────
describe('6. how-to sends an import to the import topic, and publish leads with the real journey', () => {
  it.each(['import my site', 'how do I import my site', 'clone my website', 'I already have a website'])(
    '"%s" lands on the build topic first', (q) => {
      expect(findHowTo(q)[0].id).toBe('build');
    });
  it('the publish topic opens with bring → nest → preview → publish, not a manifest', () => {
    const body = HOWTO_TOPICS.find((t) => t.id === 'publish')!.body;
    const first = body.split('\n').find((l) => l.trim().startsWith('solid '))!;
    expect(first).toMatch(/solid bring <folder>/);
    expect(body.indexOf('solid nest')).toBeLessThan(body.indexOf('solid apply site.yaml'));
    expect(body).toMatch(/--accept-fidelity/);
    expect(body).toMatch(/solid leads test/);
  });
  it('no help or output a client sees cites an internal document path', () => {
    expect(help(domainsCommand)).not.toMatch(/Owners-Manual/);
    for (const t of HOWTO_TOPICS) expect(t.body).not.toMatch(/Owners-Manual/);
  });
});

// 7 ── test-lead mode was undiscoverable ──────────────────────────────────────────────
describe('7. a test lead has a command, a how-to, and find points at it', () => {
  it('solid leads test exists and says what it proves', () => {
    const test = leadsCommand.commands.find((c) => c.name() === 'test')!;
    expect(test).toBeDefined();
    expect(test.description()).toMatch(/TEST lead/);
  });
  it('the body always carries the marker and can always be answered', () => {
    expect(testLeadBody({})).toMatchObject({ name: 'Test Lead', [TEST_LEAD_MARKER]: '1', phone: '+1 801 555 0100' });
    expect(testLeadBody({}, 'me@example.com')).toMatchObject({ email: 'me@example.com' });
    expect(testLeadBody({}, 'me@example.com').phone).toBeUndefined();
    expect(testLeadBody({ name: 'Dana', email: 'd@x.com', phone: '8015550147' }, 'me@example.com'))
      .toMatchObject({ name: 'Dana', email: 'd@x.com', phone: '8015550147', [TEST_LEAD_MARKER]: '1' });
  });
  it('posts to the site\'s own form address — the hop a real visitor uses', () => {
    const sites = [{ id: 1, site_type: 'company', canonical_url: 'https://showerpros.example/' }];
    expect(siteLeadUrl(sites, 81)).toBe('https://showerpros.example/api/cms-contact?company_id=81');
    expect(siteLeadUrl([], 81)).toBeNull();
  });
  it.each(['submit a test lead', 'test the form', 'how do I check the form works'])(
    'how-to answers "%s"', (q) => {
      expect(findHowTo(q)[0].id).toBe('test-lead');
    });
  it('find names the CLI command for it, and stays quiet on ordinary verb searches', () => {
    expect(cliHowToFor('submit a test lead')).toEqual([
      expect.objectContaining({ topic: 'test-lead', run: 'solid how-to test-lead' })]);
    for (const q of ['refund a payment', 'book an appointment', 'send an invoice', 'create a contact']) {
      expect(cliHowToFor(q)).toEqual([]);
    }
  });
  it('the how-to tells an agent not to type a made-up person into a live form', () => {
    const body = HOWTO_TOPICS.find((t) => t.id === 'test-lead')!.body;
    expect(body).toMatch(/solid leads test/);
    expect(body).toMatch(/_solid_test_lead=1/);
    expect(body).toMatch(/Do NOT type a made-up person/);
  });
});

