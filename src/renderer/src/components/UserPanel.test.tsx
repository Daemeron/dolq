import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserPanel } from './UserPanel';

describe('UserPanel', () => {
  it('shows the nick and presence, and sets away', () => {
    const onToggleAway = vi.fn();
    render(<UserPanel currentNick="daemeron" status="connected" away={false} onToggleAway={onToggleAway} />);
    expect(screen.getByText('daemeron')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set away' }));
    expect(onToggleAway).toHaveBeenCalled();
  });

  it('shows Away when away, and offers to come back', () => {
    render(<UserPanel currentNick="daemeron" status="connected" away onToggleAway={() => {}} />);
    expect(screen.getByText('Away')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back from away' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('does not claim to be online while the server is not connected', () => {
    const onToggleAway = vi.fn();
    const { rerender } = render(
      <UserPanel currentNick="daemeron" status="disconnected" away={false} onToggleAway={onToggleAway} />,
    );
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Online')).toBeNull();
    const away = screen.getByRole('button', { name: 'Set away' }) as HTMLButtonElement;
    expect(away.disabled).toBe(true);
    fireEvent.click(away);
    expect(onToggleAway).not.toHaveBeenCalled();

    rerender(<UserPanel currentNick="daemeron" status="connecting" away={false} onToggleAway={onToggleAway} />);
    expect(screen.getByText('Connecting…')).toBeTruthy();
  });

  it('says Offline even when away was set before the connection dropped', () => {
    render(<UserPanel currentNick="daemeron" status="disconnected" away onToggleAway={() => {}} />);
    expect(screen.getByText('Offline')).toBeTruthy();
    expect(screen.queryByText('Away')).toBeNull();
  });
});
