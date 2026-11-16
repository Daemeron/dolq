import { describe, expect, it } from 'vitest';
import { placeMenu } from './placeMenu';

const view = { width: 800, height: 600 };
const menu = { width: 160, height: 120 };

describe('placeMenu', () => {
  it('puts the corner of the menu at the pointer when there is room', () => {
    expect(placeMenu({ x: 100, y: 200 }, menu, view)).toEqual({ left: 100, top: 200 });
  });
  it('opens to the left of the pointer at the right edge', () => {
    expect(placeMenu({ x: 780, y: 200 }, menu, view).left).toBe(620);
  });
  it('opens above the pointer at the bottom edge', () => {
    expect(placeMenu({ x: 100, y: 590 }, menu, view).top).toBe(470);
  });
  it('stays inside the window when it is bigger than the room either way', () => {
    expect(placeMenu({ x: 50, y: 50 }, { width: 900, height: 700 }, view)).toEqual({ left: 4, top: 4 });
    expect(placeMenu({ x: 3, y: 3 }, menu, view)).toEqual({ left: 4, top: 4 });
  });
});
