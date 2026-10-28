import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { UserPanel } from './UserPanel';

describe('UserPanel', () => {
  it('shows the nick and presence, and opens preferences', () => {
    const onOpenPreferences = vi.fn();
    render(<UserPanel currentNick="daemeron" away={false} onOpenPreferences={onOpenPreferences} />);
    expect(screen.getByText('daemeron')).toBeTruthy();
    expect(screen.getByText('Online')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Preferences' }));
    expect(onOpenPreferences).toHaveBeenCalled();
  });

  it('shows Away when away', () => {
    render(<UserPanel currentNick="daemeron" away onOpenPreferences={() => {}} />);
    expect(screen.getByText('Away')).toBeTruthy();
  });
});
