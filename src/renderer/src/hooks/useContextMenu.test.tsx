import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useContextMenu } from './useContextMenu';

function Harness() {
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: test harness
    <div onContextMenu={dismissIfUnhandled} data-testid="area">
      <button type="button" onContextMenu={(e) => open('target', e)}>
        row
      </button>
      {menu && (
        <div data-testid="menu">
          {menu.target} at {menu.x},{menu.y}
          <button type="button" onClick={close}>
            close
          </button>
        </div>
      )}
    </div>
  );
}

describe('useContextMenu', () => {
  it('opens at the pointer for the right-clicked target', () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 10, clientY: 20 });
    expect(screen.getByTestId('menu').textContent).toContain('target at 10,20');
  });

  it('closes on Escape, on any click, and from its own close()', () => {
    render(<Harness />);
    const openMenu = () => fireEvent.contextMenu(screen.getByText('row'), { clientX: 1, clientY: 1 });

    openMenu();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(screen.queryByTestId('menu')).toBeNull();

    openMenu();
    act(() => {
      fireEvent.click(window);
    });
    expect(screen.queryByTestId('menu')).toBeNull();

    openMenu();
    fireEvent.click(screen.getByText('close'));
    expect(screen.queryByTestId('menu')).toBeNull();
  });

  it('ignores other keys', () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 1, clientY: 1 });
    act(() => {
      fireEvent.keyDown(window, { key: 'a' });
    });
    expect(screen.getByTestId('menu')).toBeTruthy();
  });

  it('closes when the right-click lands where no row handled it', () => {
    render(<Harness />);
    fireEvent.contextMenu(screen.getByText('row'), { clientX: 1, clientY: 1 });
    fireEvent.contextMenu(screen.getByTestId('area'));
    expect(screen.queryByTestId('menu')).toBeNull();
  });
});
