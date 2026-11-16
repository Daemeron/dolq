import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextMenu, ContextMenuItem } from './ContextMenu';

describe('ContextMenu', () => {
  afterEach(() => vi.restoreAllMocks());

  function open(x: number, y: number) {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 160,
      height: 120,
      top: 0,
      left: 0,
      right: 160,
      bottom: 120,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    window.innerWidth = 800;
    window.innerHeight = 600;
    render(
      <ContextMenu x={x} y={y}>
        <ContextMenuItem onClick={() => {}}>Item</ContextMenuItem>
      </ContextMenu>,
    );
    return screen.getByRole('presentation');
  }

  it('opens at the pointer when it fits', () => {
    const menu = open(100, 200);
    expect(menu.style.left).toBe('100px');
    expect(menu.style.top).toBe('200px');
    expect(menu.style.visibility).toBe('visible');
  });

  it('opens up and to the left at the bottom right corner of the window, so it is never cut off', () => {
    const menu = open(790, 590);
    expect(menu.style.left).toBe('630px');
    expect(menu.style.top).toBe('470px');
  });
});
