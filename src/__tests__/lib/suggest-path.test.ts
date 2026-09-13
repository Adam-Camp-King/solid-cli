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
