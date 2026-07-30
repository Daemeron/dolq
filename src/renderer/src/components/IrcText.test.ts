import { describe, it, expect } from 'vitest';
import { splitLinks } from './IrcText';

describe('splitLinks', () => {
  it('returns the whole string unchanged when there is no URL', () => {
    expect(splitLinks('hello there')).toEqual(['hello there']);
  });

  it('extracts a URL that is the entire text', () => {
    expect(splitLinks('https://example.com')).toEqual([{ url: 'https://example.com' }]);
  });

  it('extracts a URL in the middle of a sentence, with text on both sides', () => {
    expect(splitLinks('see https://example.com for details')).toEqual([
      'see ',
      { url: 'https://example.com' },
      ' for details',
    ]);
  });

  it('does not swallow trailing sentence punctuation', () => {
    expect(splitLinks('check out https://example.com.')).toEqual([
      'check out ',
      { url: 'https://example.com' },
      '.',
    ]);
  });

  it('matches http as well as https', () => {
    expect(splitLinks('http://example.com')).toEqual([{ url: 'http://example.com' }]);
  });

  it('extracts multiple URLs from the same text', () => {
    expect(splitLinks('https://a.example and https://b.example')).toEqual([
      { url: 'https://a.example' },
      ' and ',
      { url: 'https://b.example' },
    ]);
  });

  it('ignores a non-http(s) scheme entirely', () => {
    expect(splitLinks('run javascript:alert(1) please')).toEqual(['run javascript:alert(1) please']);
  });
});
