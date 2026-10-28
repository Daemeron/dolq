import { describe, expect, it } from 'vitest';
import { serverInitials } from './server';

describe('serverInitials', () => {
  it('takes the first letters of the first two words', () => {
    expect(serverInitials('Libera.Chat')).toBe('LC');
    expect(serverInitials('My Test Server')).toBe('MT');
  });

  it('takes the first two characters of a single word, keeping the second as written', () => {
    expect(serverInitials('OFTC')).toBe('OF');
    expect(serverInitials('Rizon')).toBe('Ri');
    expect(serverInitials('a')).toBe('A');
  });

  it('copes with names that have no letters or digits', () => {
    expect(serverInitials('...')).toBe('?');
    expect(serverInitials('')).toBe('?');
  });
});
