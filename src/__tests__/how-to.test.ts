/**
 * Unit tests for `solid how-to` matching (src/commands/how-to.ts). Pure.
 */
import { defaultHowTo, findHowTo, HOWTO_TOPICS } from '../commands/how-to';

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

  // ⛔ THIS TEST USED TO PIN THE BUG. It asserted that an unmatched question
  // "falls back to start (never empty)" — which is precisely the behaviour
  // that made `solid how-to "switch company"` answer with a confident, wrong,
  // unrelated topic and no signal that nothing had matched. An agent reads
  // that as answered and stops looking. Empty is the honest result.
  it('returns nothing for an unmatched question rather than a confident wrong topic', () => {
    expect(findHowTo('zzzz qqqq')).toEqual([]);
    expect(findHowTo('switch company')).toEqual([]);
  });

  it('does not match a keyword that merely sits inside another word', () => {
    // `ai` (a connect keyword) is inside "expl-ai-n", "em-ai-l", "f-ai-l".
    expect(findHowTo('explain the pipeline')).toEqual([]);
  });

  it('does not answer every "how do I ..." question with the capabilities topic', () => {
    // `do` was a capabilities keyword, so it won any question nothing else
    // matched — and people ask "how DO I ...".
    expect(findHowTo('how do I change which company I am working on')).toEqual([]);
  });

  it('still has a topic to show when asked with no question at all', () => {
    expect(defaultHowTo().id).toBe('start');
  });

  it('every topic has a title, keywords, and body', () => {
    for (const t of HOWTO_TOPICS) {
      expect(t.title.length).toBeGreaterThan(0);
      expect(t.keywords.length).toBeGreaterThan(0);
      expect(t.body.length).toBeGreaterThan(0);
    }
  });
});
