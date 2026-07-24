import { describe, it, expect } from 'vitest';
import { parseList } from './ConnectModal';

describe('parseList', () => {
  it('splits on commas', () => {
    expect(parseList('nick2,nick3')).toEqual(['nick2', 'nick3']);
  });

  it('splits on whitespace', () => {
    expect(parseList('#general #offtopic')).toEqual(['#general', '#offtopic']);
  });

  it('trims and drops empties from mixed commas, spaces, and trailing separators', () => {
    expect(parseList(' nick2, nick3 ,, nick4  ')).toEqual(['nick2', 'nick3', 'nick4']);
  });

  it('returns an empty array for blank input', () => {
    expect(parseList('')).toEqual([]);
    expect(parseList('   ')).toEqual([]);
  });
});
