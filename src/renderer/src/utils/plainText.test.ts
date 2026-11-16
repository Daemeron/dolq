import { describe, expect, it } from 'vitest';
import { plainText } from './plainText';

describe('plainText', () => {
  it('drops formatting and colour codes and keeps the words', () => {
    expect(plainText('\x02bold\x02 and \x0304,01red on black\x0f and \x1fplain\x1f')).toBe(
      'bold and red on black and plain',
    );
    expect(plainText('\x04ff0000hex\x04 colour')).toBe('hex colour');
  });
  it('leaves a plain line alone', () => {
    expect(plainText('just text, 12 of 345')).toBe('just text, 12 of 345');
  });
});
