import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopicBar } from './TopicBar';

function renderBar(extra: Partial<Parameters<typeof TopicBar>[0]> = {}) {
  const props = {
    channelName: 'dolq',
    topic: 'A self-hosted IRC client',
    isLog: false,
    onOpenSearch: vi.fn(),
    connectionStatus: 'connected' as const,
    onToggleConnection: vi.fn(),
    ...extra,
  };
  render(<TopicBar {...props} />);
  return props;
}

describe('TopicBar toolbar', () => {
  it('titles a channel with its hash, a query with the nick and the log as Server log', () => {
    renderBar();
    expect(screen.getByRole('heading').textContent).toBe('#dolq');
  });

  it('titles the log and hides its topic', () => {
    renderBar({ isLog: true });
    expect(screen.getByRole('heading').textContent).toBe('Server log');
    expect(screen.queryByText('A self-hosted IRC client')).toBeNull();
  });

  it('runs search and connection actions', () => {
    const { onOpenSearch, onToggleConnection } = renderBar();
    fireEvent.click(screen.getByRole('button', { name: 'Search history' }));
    fireEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
    expect(onOpenSearch).toHaveBeenCalled();
    expect(onToggleConnection).toHaveBeenCalled();
  });

  it('offers Connect when disconnected', () => {
    renderBar({ connectionStatus: 'disconnected' });
    expect(screen.getByRole('button', { name: 'Connect' })).toBeTruthy();
  });

  it('shows mute and members toggles only when handlers exist, with their pressed state', () => {
    const { onToggleMute, onToggleMembers } = renderBar({
      onToggleMute: vi.fn(),
      onToggleMembers: vi.fn(),
      muted: true,
      showMembers: false,
    });
    const mute = screen.getByRole('button', { name: 'Unmute channel' });
    expect(mute.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Members' }).getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(mute);
    fireEvent.click(screen.getByRole('button', { name: 'Members' }));
    expect(onToggleMute).toHaveBeenCalled();
    expect(onToggleMembers).toHaveBeenCalled();
  });

  it('omits mute, members and export when the view cannot use them', () => {
    renderBar({ isLog: true });
    expect(screen.queryByRole('button', { name: /mute/i })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Members' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Export log' })).toBeNull();
  });

  it('exports in the chosen format', () => {
    const onExport = vi.fn();
    renderBar({ onExport });
    fireEvent.click(screen.getByRole('button', { name: 'Export log' }));
    fireEvent.click(screen.getByText('Export as JSON'));
    expect(onExport).toHaveBeenCalledWith('json');
  });
});
