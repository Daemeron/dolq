import { describe, expect, it } from 'vitest';
import { placeTip } from './placeTip';

const view = { width: 800, height: 600 };
const tip = { width: 100, height: 20 };
const at = (left: number, top: number) => ({ left, top, width: 30, height: 30 });

describe('placeTip', () => {
  it('centres below the anchor when there is room', () => {
    expect(placeTip(at(400, 100), tip, view, 'below')).toEqual({ left: 365, top: 136 });
  });
  it('slides back inside at the left and right edges', () => {
    expect(placeTip(at(0, 100), tip, view, 'below').left).toBe(4);
    expect(placeTip(at(780, 100), tip, view, 'below').left).toBe(696);
  });
  it('flips above at the bottom edge', () => {
    expect(placeTip(at(400, 570), tip, view, 'below').top).toBe(544);
  });
  it('opens to the right, and flips left at the right edge', () => {
    expect(placeTip(at(10, 100), tip, view, 'right')).toEqual({ left: 46, top: 105 });
    expect(placeTip(at(760, 100), tip, view, 'right').left).toBe(654);
  });
});
