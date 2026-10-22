import { describe, expect, it } from 'vitest';
import { LOG_MAX_PAGES, LOG_MIN_MESSAGES, wantsAnotherLogPage } from './logPaging';

describe('wantsAnotherLogPage', () => {
  it('fetches more for a Log page with too few lines to scroll', () => {
    expect(wantsAnotherLogPage(true, 3, 1, false)).toBe(true);
  });

  it('stops once there are enough lines', () => {
    expect(wantsAnotherLogPage(true, LOG_MIN_MESSAGES, 1, false)).toBe(false);
  });

  it('stops when the history is exhausted', () => {
    expect(wantsAnotherLogPage(true, 0, 1, true)).toBe(false);
  });

  it('stops after the page cap', () => {
    expect(wantsAnotherLogPage(true, 0, LOG_MAX_PAGES, false)).toBe(false);
  });

  it('never fetches extra pages for a channel', () => {
    expect(wantsAnotherLogPage(false, 0, 1, false)).toBe(false);
  });
});
