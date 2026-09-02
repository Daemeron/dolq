import { describe, expect, it } from 'vitest';
import { insertAtCaret } from './insertAtCaret';

describe('insertAtCaret', () => {
  it('inserts at a collapsed caret mid-string', () => {
    expect(insertAtCaret('hi !', 3, 3, '😀')).toEqual({ text: 'hi 😀!', caret: 5 });
  });

  it('inserts at the very end', () => {
    expect(insertAtCaret('hi', 2, 2, '😀')).toEqual({ text: 'hi😀', caret: 4 });
  });

  it('replaces a real (non-collapsed) selection', () => {
    expect(insertAtCaret('hello world', 6, 11, '😀')).toEqual({ text: 'hello 😀', caret: 8 });
  });
});
