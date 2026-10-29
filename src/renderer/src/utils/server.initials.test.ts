import { describe, expect, it } from 'vitest';
import { serverColor, serverIconText, serverInitials } from './server';

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

describe('server icon', () => {
  it('prefers the chosen colour and letters over the derived ones', () => {
    expect(serverColor({ id: 'a:1', color: '#123456' })).toBe('#123456');
    expect(serverColor({ id: 'a:1' })).toMatch(/^var\(--dolq-nick-[1-8]\)$/);
    expect(serverColor({ id: 'a:1' })).toBe(serverColor({ id: 'a:1', color: '' }));
    expect(serverIconText({ name: 'Libera.Chat', initials: 'LIB' })).toBe('LIB');
    expect(serverIconText({ name: 'Libera.Chat' })).toBe('LC');
  });
});
