/**
 * Unit tests for `solid how-to` matching (src/commands/how-to.ts). Pure.
 */
import { findHowTo, HOWTO_TOPICS } from '../commands/how-to';

describe('findHowTo', () => {
  it('answers "connect to claude" with the connect topic', () => {
    expect(findHowTo('how do I connect to claude')[0].id).toBe('connect');
  });

  it('answers "connect to chatgpt" with the connect topic', () => {
    expect(findHowTo('connect to chatgpt')[0].id).toBe('connect');
  });

  it('answers "what can the cli do" with capabilities', () => {
    expect(findHowTo('what can the cli do').some((t) => t.id === 'capabilities')).toBe(true);
  });

  it('answers "get my site live" with publish', () => {
    expect(findHowTo('get my website live').some((t) => t.id === 'publish')).toBe(true);
  });

  it('falls back to "start" for an unmatched question (never empty)', () => {
    const hits = findHowTo('zzzz qqqq');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].id).toBe('start');
  });

  it('every topic has a title, keywords, and body', () => {
    for (const t of HOWTO_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});
