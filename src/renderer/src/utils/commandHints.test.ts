import { describe, expect, it } from 'vitest';
import { helpText, suggestCommands } from './commandHints';

const names = (v: string, q = false, a: string[] = []) => suggestCommands(v, q, a).map((c) => c.name);

describe('suggestCommands', () => {
  it('lists everything for a lone slash and narrows by prefix', () => {
    expect(names('/').length).toBeGreaterThan(10);
    expect(names('/ki')).toEqual(['kick', 'kickban']);
  });
  it('stops once arguments start or it is not a command', () => {
    expect(names('/join #a')).toEqual([]);
    expect(names('hello')).toEqual([]);
    expect(names('//join')).toEqual([]);
  });
  it('offers xdcc only in a query, and the user aliases', () => {
    expect(names('/xd')).toEqual([]);
    expect(names('/xd', true)).toEqual(['xdcc']);
    expect(names('/gr', false, ['greet'])).toEqual(['greet']);
  });
});

describe('helpText', () => {
  it('explains one command or lists them all', () => {
    expect(helpText('/kick', false)).toContain('Remove someone');
    expect(helpText('', false)).toContain('/join');
    expect(helpText('', false)).not.toContain('/xdcc');
    expect(helpText('', true)).toContain('/xdcc');
  });
});
