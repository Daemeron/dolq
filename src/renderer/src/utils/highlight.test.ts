import { describe, expect, it } from 'vitest';
import { splitMatches } from './highlight';

describe('splitMatches', () => {
  it('marks every occurrence regardless of case and keeps the original casing', () => {
    expect(splitMatches('Release the release', 'release')).toEqual([
      { match: 'Release' },
      ' the ',
      { match: 'release' },
    ]);
  });

  it('returns the text untouched for an empty query or no match', () => {
    expect(splitMatches('hello', '  ')).toEqual(['hello']);
    expect(splitMatches('hello', 'x')).toEqual(['hello']);
  });

  it('treats regex characters in the query literally', () => {
    expect(splitMatches('a.b (c) a.b', 'a.b')).toEqual([{ match: 'a.b' }, ' (c) ', { match: 'a.b' }]);
    expect(splitMatches('1+1=2', '1+1')).toEqual([{ match: '1+1' }, '=2']);
  });
});
