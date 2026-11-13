import { describe, expect, it } from 'vitest';
import { INPUT_HISTORY_MAX, pushInputHistory, stepInputHistory } from './inputHistory';

describe('input history', () => {
  it('keeps newest first and skips an immediate repeat', () => {
    expect(pushInputHistory(['b'], 'a')).toEqual(['a', 'b']);
    expect(pushInputHistory(['a', 'b'], 'a')).toEqual(['a', 'b']);
  });
  it('caps the list', () => {
    const full = Array.from({ length: INPUT_HISTORY_MAX }, (_, i) => String(i));
    expect(pushInputHistory(full, 'new')).toHaveLength(INPUT_HISTORY_MAX);
  });
  it('steps within bounds', () => {
    expect(stepInputHistory(-1, 1, 2)).toBe(0);
    expect(stepInputHistory(1, 1, 2)).toBe(1);
    expect(stepInputHistory(0, -1, 2)).toBe(-1);
    expect(stepInputHistory(-1, -1, 2)).toBe(-1);
    expect(stepInputHistory(-1, 1, 0)).toBe(-1);
  });
});
