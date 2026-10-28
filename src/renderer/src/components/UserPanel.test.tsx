import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserPanel } from './UserPanel';

describe('UserPanel', () => {
  it('shows the nick and presence, and sets away', () => {
    const onToggleAway = vi.fn();
    render(<UserPanel currentNick="daemeron" away={false} onToggleAway={onToggleAway} />);
    expect(screen.getByText('daemeron')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Set away' }));
    expect(onToggleAway).toHaveBeenCalled();
  });

  it('shows Away when away, and offers to come back', () => {
    render(<UserPanel currentNick="daemeron" away onToggleAway={() => {}} />);
    expect(screen.getByText('Away')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Back from away' }).getAttribute('aria-pressed')).toBe('true');
  });
});
