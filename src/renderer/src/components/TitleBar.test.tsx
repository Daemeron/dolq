import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TitleBar } from './TitleBar';

const bot = { nick: 'bot', filename: 'pack.iso', received: 512, total: 2048, speedBps: 1024 };

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
    transfers: {},
    update: null,
    onUpdate: vi.fn(),
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
    setup({ showTransfers: true, transfers: { a: bot, b: { ...bot, done: true } } });
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

  describe('the transfers peek', () => {
    const hover = () =>
      fireEvent.mouseEnter(screen.getByRole('button', { name: 'Transfers' }).parentElement as Element);

    it('shows what is transferring while the pointer is over the button, and only then', () => {
      setup({
        transfers: {
          a: bot,
          b: { ...bot, filename: 'done.iso', done: true },
          c: { ...bot, filename: 'bad.iso', error: 'x' },
        },
      });
      expect(screen.queryByRole('tooltip')).toBeNull();
      hover();
      const tip = screen.getByRole('tooltip');
      expect(tip.textContent).toContain('pack.iso');
      expect(tip.textContent).toContain('bot · 25% of 2.0 KB · 1.0 KB/s');
      expect(tip.textContent).not.toContain('done.iso');
      expect(tip.textContent).not.toContain('bad.iso');
      fireEvent.mouseLeave(screen.getByRole('button', { name: 'Transfers' }).parentElement as Element);
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('also shows on keyboard focus', () => {
      setup({ transfers: { a: bot } });
      fireEvent.focus(screen.getByRole('button', { name: 'Transfers' }));
      expect(screen.getByRole('tooltip')).toBeTruthy();
      fireEvent.blur(screen.getByRole('button', { name: 'Transfers' }));
      expect(screen.queryByRole('tooltip')).toBeNull();
    });

    it('says when nothing is transferring', () => {
      setup();
      hover();
      expect(screen.getByRole('tooltip').textContent).toContain('Nothing is transferring');
    });

    it('lists a few and counts the rest', () => {
      const many = Object.fromEntries(
        Array.from({ length: 6 }, (_, i) => [`t${i}`, { ...bot, filename: `f${i}.iso`, paused: i === 0 }]),
      );
      setup({ transfers: many });
      hover();
      expect(screen.getByRole('tooltip').textContent).toContain('+2 more');
      expect(screen.queryByText('f5.iso')).toBeNull();
    });

    it('stays hidden while the Transfers panel is open', () => {
      setup({ transfers: { a: bot }, showTransfers: true });
      hover();
      expect(screen.queryByRole('tooltip')).toBeNull();
    });
  });

  describe('the update notice', () => {
    it('is absent when there is nothing newer', () => {
      setup();
      expect(screen.queryByRole('button', { name: /update/i })).toBeNull();
    });

    it.each([
      ['available', 'Update to 0.8.0', false],
      ['downloading', 'Downloading 0.8.0…', true],
      ['downloaded', 'Restart to update', false],
    ] as const)('says what a %s version offers', (state, label, disabled) => {
      const p = setup({ update: { state, version: '0.8.0', canInstall: true } });
      const button = screen.getByRole('button', { name: label });
      expect((button as HTMLButtonElement).disabled).toBe(disabled);
      fireEvent.click(button);
      expect(p.onUpdate).toHaveBeenCalledTimes(disabled ? 0 : 1);
    });
  });
});
