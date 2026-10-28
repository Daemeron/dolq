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
