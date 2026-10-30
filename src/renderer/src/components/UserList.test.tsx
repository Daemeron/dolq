import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../types';
import { type ListState, toRows, UserList } from './UserList';

const user = (nick: string, privileges: User['privileges'] = []): User => ({ nick, privileges });

const LIVE: ListState = { lastSeen: false, connected: true };

describe('toRows', () => {
  it('groups by highest privilege, ops before regular users', () => {
    const rows = toRows([user('b'), user('a', ['op'])]);
    expect(rows.map((r) => (r.type === 'header' ? `h:${r.privilege}` : r.user.nick))).toEqual([
      'h:op',
      'a',
      'h:none',
      'b',
    ]);
  });
});

describe('UserList', () => {
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 600,
      top: 0,
      left: 0,
      right: 200,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  it('colours a member with a nick palette token and opens a query on click', () => {
    withLayout();
    const onOpenQuery = vi.fn();
    render(
      <UserList
        users={[user('mira', ['op'])]}
        currentNick="me"
        onOpenQuery={onOpenQuery}
        onWhois={() => {}}
        ignoredNicks={[]}
        onToggleIgnore={() => {}}
        onDCCOffer={() => {}}
        onSendFile={() => {}}
        state={LIVE}
      />,
    );
    const row = screen.getByTitle('Message mira');
    expect(row.innerHTML).toMatch(/--dolq-nick-[1-8]/);
    fireEvent.click(row);
    expect(onOpenQuery).toHaveBeenCalledWith('mira');
  });
});

describe('UserList menu', () => {
  function withLayout() {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 600,
      top: 0,
      left: 0,
      right: 200,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
  }

  function setup(ignored: string[] = [], state: ListState = LIVE) {
    withLayout();
    const h = {
      onWhois: vi.fn(),
      onToggleIgnore: vi.fn(),
      onDCCOffer: vi.fn(),
      onSendFile: vi.fn(),
      onOpenQuery: vi.fn(),
    };
    render(
      <UserList users={[user('mira'), user('me')]} currentNick="me" ignoredNicks={ignored} state={state} {...h} />,
    );
    return h;
  }

  it('runs whois, DCC chat and ignore for the right-clicked nick', () => {
    const h = setup();
    fireEvent.contextMenu(screen.getByText('mira'));
    fireEvent.click(screen.getByText('WHOIS'));
    expect(h.onWhois).toHaveBeenCalledWith('mira');
    fireEvent.contextMenu(screen.getByText('mira'));
    fireEvent.click(screen.getByText('DCC Chat'));
    expect(h.onDCCOffer).toHaveBeenCalledWith('mira');
    fireEvent.contextMenu(screen.getByText('mira'));
    fireEvent.click(screen.getByText('Send File…'));
    expect(h.onSendFile).toHaveBeenCalledWith('mira');
    fireEvent.contextMenu(screen.getByText('mira'));
    fireEvent.click(screen.getByText('Ignore'));
    expect(h.onToggleIgnore).toHaveBeenCalledWith('mira');
  });

  it('offers Unignore for an ignored nick', () => {
    setup(['mira']);
    fireEvent.contextMenu(screen.getByText('mira'));
    expect(screen.getByText('Unignore')).toBeTruthy();
  });

  it('does not open a query with yourself', () => {
    const h = setup();
    fireEvent.click(screen.getByText('me'));
    expect(h.onOpenQuery).not.toHaveBeenCalled();
  });

  it('with the list only last seen but the server connected, keeps every command', () => {
    const h = setup([], { lastSeen: true, connected: true });
    fireEvent.contextMenu(screen.getByText('mira'));
    for (const name of ['WHOIS', 'DCC Chat', 'Send File…', 'Ignore']) expect(screen.getByText(name)).toBeTruthy();
    fireEvent.click(screen.getByTitle('Message mira'));
    expect(h.onOpenQuery).toHaveBeenCalledWith('mira');
  });

  it('with no server to ask, leaves only ignoring and no message on click', () => {
    const h = setup([], { lastSeen: true, connected: false });
    fireEvent.contextMenu(screen.getByText('mira'));
    expect(screen.getByText('Ignore')).toBeTruthy();
    for (const name of ['WHOIS', 'DCC Chat', 'Send File…']) expect(screen.queryByText(name)).toBeNull();
    expect(screen.queryByTitle('Message mira')).toBeNull();
    fireEvent.click(screen.getAllByText('mira')[0]);
    expect(h.onOpenQuery).not.toHaveBeenCalled();
  });
});

describe('UserList when the channel is only last seen', () => {
  function render_(state: ListState) {
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(600);
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      width: 200,
      height: 600,
      top: 0,
      left: 0,
      right: 200,
      bottom: 600,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    return render(
      <UserList
        users={[user('mira', ['op']), user('kai'), user('lu')]}
        currentNick="me"
        onOpenQuery={() => {}}
        onWhois={() => {}}
        ignoredNicks={[]}
        onToggleIgnore={() => {}}
        onDCCOffer={() => {}}
        onSendFile={() => {}}
        state={state}
      />,
    );
  }

  it('is faded out, and its groups show no counts', () => {
    const { container } = render_({ lastSeen: true, connected: false });
    expect(container.firstElementChild?.className).toContain('opacity-45');
    expect(screen.getByText('Operators')).toBeTruthy();
    expect(screen.getByText('Members')).toBeTruthy();
    expect(screen.queryByText(/·/)).toBeNull();
  });

  it('is at full strength, with counts, while live', () => {
    const { container } = render_(LIVE);
    expect(container.firstElementChild?.className).not.toContain('opacity-45');
    expect(screen.getByText('Operators · 1')).toBeTruthy();
    expect(screen.getByText('Members · 2')).toBeTruthy();
  });
});
