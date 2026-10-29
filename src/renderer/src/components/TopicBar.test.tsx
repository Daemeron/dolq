import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TopicBar } from './TopicBar';

function barProps(extra: Partial<Parameters<typeof TopicBar>[0]> = {}) {
  return {
    channelName: 'dolq',
    topic: 'A self-hosted IRC client',
    isLog: false,
    onOpenSearch: vi.fn(),
    connectionStatus: 'connected' as const,
    onToggleConnection: vi.fn(),
    ...extra,
  };
}

function renderBar(extra: Partial<Parameters<typeof TopicBar>[0]> = {}) {
  const props = barProps(extra);
  render(<TopicBar {...props} />);
  return props;
}

describe('TopicBar toolbar', () => {
  it('titles a channel with its hash, coloured with the server colour', () => {
    renderBar({ serverColor: 'rgb(1, 2, 3)' });
    const heading = screen.getByRole('heading');
    expect(heading.textContent).toBe('#dolq');
    expect((heading.firstChild as HTMLElement).style.color).toBe('rgb(1, 2, 3)');
  });

  it('leaves room for the window controls only when it is the rightmost header', () => {
    const { unmount } = render(<TopicBar {...barProps()} />);
    expect(screen.getByRole('heading').parentElement).not.toHaveClass('titlebar-end');
    unmount();
    render(<TopicBar {...barProps({ clearsWindowControls: true })} />);
    expect(screen.getByRole('heading').parentElement).toHaveClass('titlebar-end');
  });

  it('titles a query with an at sign and a DCC chat with a bolt', () => {
    const { unmount } = render(
      <TopicBar
        channelName="mira"
        topic={undefined}
        isLog={false}
        isQuery
        onOpenSearch={() => {}}
        connectionStatus="connected"
        onToggleConnection={() => {}}
      />,
    );
    expect(screen.getByRole('heading').textContent).toBe('@mira');
    unmount();
    render(
      <TopicBar
        channelName="mira"
        topic={undefined}
        isLog={false}
        isQuery
        isDCC
        dccStatus="connected"
        onOpenSearch={() => {}}
        connectionStatus="connected"
        onToggleConnection={() => {}}
      />,
    );
    expect(screen.getByRole('heading').textContent).toBe('mira');
    expect(screen.getByText('connected')).toBeTruthy();
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

  it('lists channels that mentioned you, marks the button, and jumps to the chosen one', () => {
    const onSelectMention = vi.fn();
    renderBar({
      mentions: [
        { id: '#a', label: '#a' },
        { id: '#b', label: '#b' },
      ],
      onSelectMention,
    });
    expect(screen.getByTestId('icon-badge')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Mentions' }));
    expect(screen.getByText('Mentioned in')).toBeTruthy();
    fireEvent.click(screen.getByText('#b'));
    expect(onSelectMention).toHaveBeenCalledWith('#b');
  });

  it('says so when there are no mentions, and shows no badge', () => {
    renderBar({ mentions: [], onSelectMention: vi.fn() });
    expect(screen.queryByTestId('icon-badge')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Mentions' }));
    expect(screen.getByText('No new mentions')).toBeTruthy();
  });

  it('toggles the transfers panel and badges the button while transfers exist', () => {
    const onToggleTransfers = vi.fn();
    renderBar({ onToggleTransfers, transferCount: 2, showTransfers: true });
    expect(screen.getByTestId('icon-badge')).toBeTruthy();
    const button = screen.getByRole('button', { name: 'Transfers' });
    expect(button.getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button);
    expect(onToggleTransfers).toHaveBeenCalled();
  });

  it('omits mentions and transfers when the host does not provide them', () => {
    renderBar();
    expect(screen.queryByRole('button', { name: 'Mentions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Transfers' })).toBeNull();
  });
});
