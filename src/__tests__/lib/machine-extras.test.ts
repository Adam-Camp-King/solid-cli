/**
 * The optional extras — what each is, who it is for, how it works, the one command.
 *
 * ⛔ WHY. An AI asked "what does 'Agent skills: not set up' mean?" had nowhere to
 * look, read the CLI's installed files, then searched a home folder and pulled a
 * business's data to disk to "set it up" (2026-10-05). This table is the answer
 * the CLI now gives — to a person, and to whichever AI they ask — and these hold
 * it to what the CLI really does.
 */
import { Command } from 'commander';

import { EXTRAS, FOR_AI, describe as describeExtra, howToBody } from '../../lib/machine-extras';
import { SKILLS } from '../../lib/skills/index';
import { findHowTo } from '../../commands/how-to';

describe('each extra', () => {
  it.each(Object.values(EXTRAS))('$id says what it is, who it is for, the command, and how it works', (e) => {
    for (const text of [e.name, e.what, e.useful_when, e.turn_on, e.how_it_works]) expect(text.length).toBeGreaterThan(5);
    expect(e.turn_on.startsWith('solid ')).toBe(true);
    expect(e.useful_when.startsWith('Useful if you ')).toBe(true);
    expect(e.set_up.length).toBeGreaterThan(0);
    expect(`${e.what} ${e.useful_when}`).not.toMatch(/broken|missing|required|must/i);
  });

  it('every turn-on command is a real command of this CLI', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const commands: Record<string, Command> = {
      agent: require('../../commands/agent').agentCommand,
      render: require('../../commands/render').renderCommand,
      install: require('../../commands/install').installCommand,
      completion: require('../../commands/completion').completionCommand,
    };
    for (const e of Object.values(EXTRAS)) {
      const [, top, sub] = e.turn_on.split(' ');
      const cmd = commands[top];
      expect(cmd).toBeDefined();
      if (sub && sub.startsWith('--')) {
        expect(cmd.options.map((o) => o.long)).toContain(sub);
      } else if (sub) {
        expect(cmd.commands.map((c) => c.name())).toContain(sub);
      }
    }
  });

  it('the skills count it states is the number the CLI installs', () => {
    expect(SKILLS.length).toBe(4);
    expect(EXTRAS.project_kits.how_it_works).toContain('four short skill files');
  });
});

describe('what an AI is told', () => {
  it('an AI asked to set up the skills is told to ASK for the folder and to get a yes before any download', () => {
    const steps = EXTRAS.project_kits.set_up.join(' ');
    expect(steps).toContain('Ask the person which folder');
    expect(steps).toContain('Do not search the disk');
    expect(steps).toContain('DOWNLOADS');
    expect(steps).toContain('get a yes first');
    expect(steps).toContain('they do not need this');
  });

  it('the rules name the three things that went wrong', () => {
    const rules = FOR_AI.join(' ');
    expect(rules).toContain("Do not read the CLI's installed files");
    expect(rules).toContain('Do not search the disk');
    expect(rules).toContain('Do not download');
    expect(rules).toContain('do not fix anything unasked');
  });

  it('a part that is on carries what it is but nothing to run', () => {
    expect(describeExtra('browser', true)).not.toHaveProperty('turn_on');
    expect(describeExtra('browser', true).what).toBe(EXTRAS.browser.what);
    expect(describeExtra('browser', false)).toMatchObject({ turn_on: 'solid render --install', optional: true });
  });
});

describe('solid how-to', () => {
  it.each([
    'what does the render and agent mean in the cli?',   // the question that was actually asked
    'what does agent skills not set up mean',
    'what is the render browser',
    'set up the optional extras',
    'page screenshots',
  ])('answers %j with the extras topic', (q) => {
    expect(findHowTo(q)[0].id).toBe('extras');
  });

  it('the answer holds every extra and the rules for an AI', () => {
    const body = howToBody();
    for (const e of Object.values(EXTRAS)) {
      expect(body).toContain(e.name);
      expect(body).toContain(e.turn_on);
      expect(body).toContain(e.how_it_works);
    }
    expect(body).toContain('If you are an AI reading this for someone:');
    for (const rule of FOR_AI) expect(body).toContain(rule);
  });
});
