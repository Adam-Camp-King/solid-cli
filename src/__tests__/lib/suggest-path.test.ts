/**
 * "Did you mean?" has to search the whole tree, not one level of it.
 *
 * Sprint VNP 2.4. `solid contacts` used to be matched only against top-level
 * siblings, so it offered `connect` and `context` while `crm contacts` — which
 * exists and is what was meant — was never a candidate. A user or agent that
 * half-remembers a command should not have to know its namespace to be found.
 */
import { flattenCommandTree, suggestPath } from '../../lib/suggest';

// Shaped like a commander tree, without pulling commander into a unit test.
const node = (name: string, kids: any[] = []) => ({ name: () => name, commands: kids });

const TREE = node('solid', [
  node('crm', [
    node('contacts', [node('get'), node('create'), node('import')]),
    node('deals', [node('get')]),
  ]),
  node('connect', []),
  node('context', []),
  node('verbs', [node('list'), node('describe'), node('invoke')]),
  node('find', []),
  // Phone routing. Effectful, and the exact leaf `call` that used to be
  // offered as the fix for `solid verbs call`.
  node('call', [node('simulate')]),
]);

describe('flattenCommandTree', () => {
  it('produces full space-joined paths at every depth', () => {
    const paths = flattenCommandTree(TREE);
    expect(paths).toContain('crm');
    expect(paths).toContain('crm contacts');
    expect(paths).toContain('crm contacts create');
    expect(paths).toContain('verbs invoke');
  });

  it('skips the wildcard handler commander installs', () => {
    const withStar = node('solid', [node('*'), node('real')]);
    expect(flattenCommandTree(withStar)).toEqual(['real']);
  });
});

describe('suggestPath', () => {
  const paths = flattenCommandTree(TREE);

  it('finds a nested command from its leaf name — the VNP case', () => {
    expect(suggestPath('contacts', paths)[0]).toBe('crm contacts');
  });

  it('prefers the shallower leaf over its own subcommands', () => {
    // `crm contacts` before `crm contacts get`: the user typed one word.
    const out = suggestPath('contacts', paths);
    expect(out.indexOf('crm contacts')).toBeLessThan(out.indexOf('crm contacts get'));
  });

  it('still handles a plain typo', () => {
    expect(suggestPath('conect', paths)).toContain('connect');
    expect(suggestPath('verb', paths)).toContain('verbs');
  });

  it('returns nothing for input that resembles nothing', () => {
    expect(suggestPath('xyzzy', paths)).toEqual([]);
  });

  it('does not fan out on a very short input', () => {
    // A 2-character typo must not match every 3-letter command.
    expect(suggestPath('zq', paths)).toEqual([]);
  });

  it('respects max', () => {
    expect(suggestPath('c', paths, { max: 2 }).length).toBeLessThanOrEqual(2);
  });
});

/**
 * A correction must not cross namespaces.
 *
 * `solid verbs call` was answered with `solid call` — phone routing, a
 * different namespace, and something that acts. String distance found an exact
 * leaf `call` at the top level; nothing under `verbs` scored at all. For an
 * agent driving the CLI a confidently wrong suggestion is worse than none,
 * because it will run it.
 */
describe('suggestPath — namespace awareness', () => {
  const paths = flattenCommandTree(TREE);

  it('never offers the top-level `call` for `solid verbs call`', () => {
    const out = suggestPath('call', paths, { group: 'verbs' });
    expect(out).not.toContain('call');
    expect(out).not.toContain('call simulate');
    // Nothing under `verbs` resembles "call" — say nothing, let the caller
    // print the group's real subcommands.
    expect(out).toEqual([]);
  });

  it('without a group the same input still reaches `call` — root is unrestricted', () => {
    // Proves the guard is the group, not a blanket ban: `solid call` typed at
    // the root is a legitimate match, and `solid contacts` must keep working.
    expect(suggestPath('call', paths)).toContain('call');
    expect(suggestPath('contacts', paths)[0]).toBe('crm contacts');
  });

  it('corrects a typo INSIDE the group it was typed in', () => {
    expect(suggestPath('invok', paths, { group: 'verbs' })).toEqual(['verbs invoke']);
    expect(suggestPath('contcts', paths, { group: 'crm' })).toContain('crm contacts');
  });

  it('`solid crm contexts` does not escape to the top-level `context`', () => {
    const out = suggestPath('contexts', paths, { group: 'crm' });
    expect(out).not.toContain('context');
    expect(out).toContain('crm contacts');
  });

  it('`solid verbs deals` does not escape to `crm deals`', () => {
    expect(suggestPath('deals', paths, { group: 'verbs' })).toEqual([]);
  });

  it('falls back to an ancestor group, never to the root', () => {
    // Typed under `crm contacts`; `deals` lives one level up, still in `crm`.
    expect(suggestPath('deals', paths, { group: 'crm contacts' })).toContain('crm deals');
    // But `call` is not in `crm` at any depth, so it is not an answer.
    expect(suggestPath('call', paths, { group: 'crm contacts' })).toEqual([]);
  });

  it('does not match the group segments the caller already typed', () => {
    // `solid crm crm` must not score every path in the namespace.
    expect(suggestPath('crm', paths, { group: 'crm' })).toEqual([]);
  });

  it('an empty group behaves exactly like no group', () => {
    expect(suggestPath('contacts', paths, { group: '' })).toEqual(suggestPath('contacts', paths));
  });
});
