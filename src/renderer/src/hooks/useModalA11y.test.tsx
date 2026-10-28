import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useModalA11y } from './useModalA11y';

function Dialog() {
  const ref = useModalA11y<HTMLDivElement>();
  return (
    <div ref={ref} tabIndex={-1} data-testid="dialog">
      <button type="button">first</button>
      <button type="button">last</button>
    </div>
  );
}

describe('useModalA11y', () => {
  it('focuses the first control on open', () => {
    render(<Dialog />);
    expect(document.activeElement).toBe(screen.getByText('first'));
  });

  it('wraps Tab from the last control to the first and Shift+Tab the other way', () => {
    render(<Dialog />);
    const dialog = screen.getByTestId('dialog');
    screen.getByText('last').focus();
    fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByText('first'));
    fireEvent.keyDown(dialog, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(screen.getByText('last'));
  });

  it('leaves Tab alone in the middle and ignores other keys', () => {
    render(<Dialog />);
    const dialog = screen.getByTestId('dialog');
    const notPrevented = fireEvent.keyDown(dialog, { key: 'Tab' });
    expect(notPrevented).toBe(true);
    expect(fireEvent.keyDown(dialog, { key: 'a' })).toBe(true);
  });

  it('returns focus to what had it before the dialog closed', () => {
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();
    const { unmount } = render(<Dialog />);
    unmount();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('does nothing on Tab when the dialog has nothing focusable', () => {
    function Empty() {
      const ref = useModalA11y<HTMLDivElement>();
      return (
        <div ref={ref} tabIndex={-1} data-testid="empty">
          just text
        </div>
      );
    }
    render(<Empty />);
    const empty = screen.getByTestId('empty');
    expect(document.activeElement).toBe(empty);
    expect(fireEvent.keyDown(empty, { key: 'Tab' })).toBe(true);
    expect(document.activeElement).toBe(empty);
  });
});
