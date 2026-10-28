import { describe, expect, it } from 'vitest';
import { nickColor, nickInitial } from './nickColor';

describe('nickColor', () => {
  it('is stable for the same nick', () => {
    expect(nickColor('mira')).toBe(nickColor('mira'));
  });

  it('always lands on one of the eight palette tokens', () => {
    for (const nick of ['a', 'mira', 'tomas', 'x'.repeat(50), '']) {
      expect(nickColor(nick)).toMatch(/^var\(--dolq-nick-[1-8]\)$/);
    }
  });
});

describe('nickInitial', () => {
  it('upper-cases the first letter and falls back for an empty nick', () => {
    expect(nickInitial('mira')).toBe('M');
    expect(nickInitial('')).toBe('?');
  });
});
