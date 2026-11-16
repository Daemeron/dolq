import { describe, expect, it } from 'vitest';
import { estimateRowSize, LOG_LINE_HEIGHT, SUMMARY_HEIGHT } from './rowSize';

const plain = { isLog: false, compact: false, hidden: false, run: null } as const;

describe('estimateRowSize', () => {
  it('guesses a line by the view it is in', () => {
    expect(estimateRowSize({ ...plain, isLog: true })).toBe(LOG_LINE_HEIGHT);
    expect(estimateRowSize({ ...plain, compact: true })).toBe(24);
    expect(estimateRowSize(plain)).toBe(30);
  });
  it('gives a line folded away no height at all', () => {
    expect(estimateRowSize({ ...plain, hidden: true })).toBe(0);
    expect(estimateRowSize({ ...plain, isLog: true, hidden: true })).toBe(0);
  });
  it('gives the head of a closed run the height of its summary, in every view', () => {
    for (const view of [{ isLog: true }, { compact: true }, {}]) {
      expect(estimateRowSize({ ...plain, ...view, run: 'closed' })).toBe(SUMMARY_HEIGHT);
    }
  });
  it('adds the head line under the summary once the run is open', () => {
    expect(estimateRowSize({ ...plain, isLog: true, run: 'open' })).toBe(SUMMARY_HEIGHT + LOG_LINE_HEIGHT);
    expect(estimateRowSize({ ...plain, run: 'open' })).toBe(SUMMARY_HEIGHT + 30);
  });
});
