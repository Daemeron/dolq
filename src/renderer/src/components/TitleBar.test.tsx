import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TitleBar } from './TitleBar';

function setup(over: Partial<React.ComponentProps<typeof TitleBar>> = {}) {
  const props = {
    title: 'Dashboard',
    canGoBack: true,
    canGoForward: true,
    onGoBack: vi.fn(),
    onGoForward: vi.fn(),
    onOpenSearch: vi.fn(),
    onOpenPreferences: vi.fn(),
    away: false,
    awayDisabled: false,
    onToggleAway: vi.fn(),
    transferCount: 0,
    showTransfers: false,
    onToggleTransfers: vi.fn(),
    ...over,
  };
  render(<TitleBar {...props} />);
  return props;
}

describe('TitleBar', () => {
  it('is the draggable strip across the top', () => {
    setup();
    expect(screen.getByRole('banner')).toHaveClass('titlebar-drag');
  });

  it('names where you are, in the middle', () => {
    setup({ title: '#dolq · Libera' });
    expect(screen.getByText('#dolq · Libera')).toBeTruthy();
  });

  it('goes back and forward, and shows a direction that has nowhere to go as unavailable', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    expect(p.onGoBack).toHaveBeenCalled();
    expect(p.onGoForward).toHaveBeenCalled();
    cleanup();
    setup({ canGoBack: false, canGoForward: false });
    expect(screen.getByRole('button', { name: 'Back' }).parentElement).toHaveClass('pointer-events-none');
    expect(screen.getByRole('button', { name: 'Forward' }).parentElement).toHaveClass('pointer-events-none');
  });

  it('holds the app-wide actions', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Search everywhere' }));
    fireEvent.click(screen.getByRole('button', { name: 'Away on all servers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    fireEvent.click(screen.getByRole('button', { name: 'Transfers' }));
    expect(p.onOpenSearch).toHaveBeenCalled();
    expect(p.onToggleAway).toHaveBeenCalled();
    expect(p.onOpenPreferences).toHaveBeenCalled();
    expect(p.onToggleTransfers).toHaveBeenCalled();
  });

  it('shows transfers as pressed with a badge while there are some', () => {
    setup({ showTransfers: true, transferCount: 2 });
    expect(screen.getByRole('button', { name: 'Transfers' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('icon-badge')).toBeTruthy();
  });

  it('offers to come back when away, and does nothing with no connected server', () => {
    const p = setup({ away: true, awayDisabled: true });
    const button = screen.getByRole('button', { name: 'Back from away on all servers' });
    expect(button).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(button);
    expect(p.onToggleAway).not.toHaveBeenCalled();
  });
});
