import { describe, it, expect } from 'vitest';
import { mentionsNick } from './mentions';

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
    // A bracket-edged nick is valid IRC (RFC 2812 allows []{}\|^_-`) and
    // wouldn't match at all under a naive \b-based approach - see the
    // comment on mentionsNick.
    expect(mentionsNick('hey [bot], status?', '[bot]')).toBe(true);
  });
});
