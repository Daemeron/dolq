import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, type Mock, vi } from 'vitest';
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

describe('ChannelList: groups and badges', () => {
  it('groups the log, channels, direct messages and DCC chats', () => {
    renderList([
      { id: 's:__log__', name: 'Log', isLog: true },
      channel('linux', true),
      { id: 'mira', name: 'mira', isLog: false, isQuery: true },
      { id: 'dcc:1', name: 'kestrel', isLog: false, isQuery: true, isDCC: true },
    ]);
    expect(screen.getByText('Server log')).toBeTruthy();
    expect(screen.getByText('Channels')).toBeTruthy();
    expect(screen.getByText('Direct messages')).toBeTruthy();
    expect(screen.getByText('DCC chats')).toBeTruthy();
    expect(screen.getByText('mira')).toBeTruthy();
    expect(screen.getByText('kestrel')).toBeTruthy();
  });

  it('selects the log, a direct message and a DCC chat on click', () => {
    const { onSelect } = renderList([
      { id: 's:__log__', name: 'Log', isLog: true },
      { id: 'mira', name: 'mira', isLog: false, isQuery: true },
      { id: 'dcc:1', name: 'kestrel', isLog: false, isQuery: true, isDCC: true },
    ]);
    fireEvent.click(screen.getByText('Server log'));
    fireEvent.click(screen.getByText('mira'));
    fireEvent.click(screen.getByText('kestrel'));
    expect((onSelect as Mock).mock.calls.map((c: unknown[]) => c[0])).toEqual(['s:__log__', 'mira', 'dcc:1']);
  });

  it('shows the unread count, flagging a mention, and caps it at 99+', () => {
    renderList([channel('a', true), channel('b', true)], {
      awayStats: { '#a': { count: 5, people: 2 }, '#b': { count: 250, people: 1 } },
      mentionedChannels: { '#a': true },
    });
    expect(screen.getByText('5')).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    expect(screen.getByTitle('5 messages from 2 people since you last looked')).toBeTruthy();
    expect(screen.getByTitle('250 messages from 1 person since you last looked')).toBeTruthy();
  });

  it('shows a muted channel with its mute icon', () => {
    renderList([channel('a', true)], { mutedChannels: { '#a': true } });
    expect(screen.getByTitle('Muted')).toBeTruthy();
  });

  it('mutes, unmutes, removes channels and closes direct messages from the menu', () => {
    const p = renderList([channel('a', true), { id: 'mira', name: 'mira', isLog: false, isQuery: true }], {
      mutedChannels: { '#a': true },
    });
    fireEvent.contextMenu(screen.getByText('a'));
    fireEvent.click(screen.getByText('Unmute Channel'));
    expect(p.onToggleMuteChannel).toHaveBeenCalledWith('#a');
    fireEvent.contextMenu(screen.getByText('a'));
    fireEvent.click(screen.getByText('Remove Channel'));
    expect(p.onRemoveChannel).toHaveBeenCalledWith('#a');
    fireEvent.contextMenu(screen.getByText('mira'));
    fireEvent.click(screen.getByText('Close'));
    expect(p.onCloseQuery).toHaveBeenCalledWith('mira');
  });

  it('offers Mute for a channel that is not muted', () => {
    renderList([channel('a', true)]);
    fireEvent.contextMenu(screen.getByText('a'));
    expect(screen.getByText('Mute Channel')).toBeTruthy();
  });

  it('closes a DCC chat from its menu', () => {
    const p = renderList([{ id: 'dcc:1', name: 'kestrel', isLog: false, isQuery: true, isDCC: true }]);
    fireEvent.contextMenu(screen.getByText('kestrel'));
    fireEvent.click(screen.getByText('Close'));
    expect(p.onCloseQuery).toHaveBeenCalledWith('dcc:1');
  });
});
