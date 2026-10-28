import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Channel } from '../types';
import { ChannelList } from './ChannelList';

const channel = (name: string, joined?: boolean): Channel => ({ id: `#${name}`, name, isLog: false, joined });

function renderList(channels: Channel[], handlers: Partial<Parameters<typeof ChannelList>[0]> = {}) {
  const props = {
    serverName: 'Libera',
    channels,
    selectedId: '',
    onSelect: vi.fn(),
    mentionedChannels: {},
    awayStats: {},
    mutedChannels: {},
    onToggleMuteChannel: vi.fn(),
    onJoinChannel: vi.fn(),
    onLeaveChannel: vi.fn(),
    onRemoveChannel: vi.fn(),
    onCloseQuery: vi.fn(),
    ...handlers,
  };
  render(<ChannelList {...props} />);
  return props;
}

describe('ChannelList: are we in the channel', () => {
  it('shows a joined channel normally', () => {
    renderList([channel('linux', true)]);
    expect(screen.queryByText('not joined')).toBeNull();
  });

  it('flags a channel as not joined when joined is false or unknown', () => {
    renderList([channel('linux', false), channel('go')]);
    expect(screen.getAllByText('not joined')).toHaveLength(2);
  });

  it('offers Leave for a joined channel and Join for one we are not in', () => {
    const { onLeaveChannel, onJoinChannel } = renderList([channel('in', true), channel('out', false)]);

    fireEvent.contextMenu(screen.getByText('in'));
    fireEvent.click(screen.getByText('Leave Channel'));
    expect(onLeaveChannel).toHaveBeenCalledWith('#in');

    fireEvent.contextMenu(screen.getByText('out'));
    fireEvent.click(screen.getByText('Join Channel'));
    expect(onJoinChannel).toHaveBeenCalledWith('#out');
  });

  it('selects a channel on click', () => {
    const { onSelect } = renderList([channel('linux', true)]);
    fireEvent.click(screen.getByText('linux'));
    expect(onSelect).toHaveBeenCalledWith('#linux');
  });
});
