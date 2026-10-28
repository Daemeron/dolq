import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { User } from '../types';
import { toRows, UserList } from './UserList';

const user = (nick: string, privileges: User['privileges'] = []): User => ({ nick, privileges });

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

  function setup(ignored: string[] = []) {
    withLayout();
    const h = {
      onWhois: vi.fn(),
      onToggleIgnore: vi.fn(),
      onDCCOffer: vi.fn(),
      onSendFile: vi.fn(),
      onOpenQuery: vi.fn(),
    };
    render(<UserList users={[user('mira'), user('me')]} currentNick="me" ignoredNicks={ignored} {...h} />);
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
});
