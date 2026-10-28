import { describe, expect, it } from 'vitest';
import { mentionsAny, mentionsNick } from './mentions';

describe('mentionsNick', () => {
  it('matches a whole-word, case-insensitive mention', () => {
    expect(mentionsNick('hey Bob, got a sec?', 'bob')).toBe(true);
  });

  it('does not match a nick that is only a substring of a word', () => {
    expect(mentionsNick('bobby was here', 'bob')).toBe(false);
    expect(mentionsNick('abob was here', 'bob')).toBe(false);
  });

  it('matches at the start or end of the text', () => {
    expect(mentionsNick('bob: hello', 'bob')).toBe(true);
    expect(mentionsNick('hello bob', 'bob')).toBe(true);
  });

  it('returns false for an empty nick', () => {
    expect(mentionsNick('hello', '')).toBe(false);
  });

  it('treats regex special characters in the nick literally, matching even at punctuation boundaries', () => {
    expect(mentionsNick('hey [bot], status?', '[bot]')).toBe(true);
  });
});

describe('mentionsAny', () => {
  it('matches the nick or any highlight word', () => {
    expect(mentionsAny('bob: hi', 'bob', [])).toBe(true);
    expect(mentionsAny('time to release', 'bob', ['release'])).toBe(true);
    expect(mentionsAny('nothing here', 'bob', ['release'])).toBe(false);
  });

  it('ignores empty words', () => {
    expect(mentionsAny('anything', 'bob', [''])).toBe(false);
  });
});
