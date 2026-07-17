import { describe, it, expect } from 'vitest';
import { toRows } from './UserList';
import { User } from '../types';

function user(nick: string, privileges: User['privileges']): User {
  return { nick, privileges };
}

describe('toRows', () => {
  it('groups users under one header per privilege, ordered by rank', () => {
    const rows = toRows([
      user('alice', ['voice']),
      user('bob', ['op']),
      user('carol', []),
    ]);
    expect(rows.map((r) => (r.type === 'header' ? `#${r.privilege}` : r.user.nick))).toEqual([
      '#op', 'bob',
      '#voice', 'alice',
      '#none', 'carol',
    ]);
  });

  it('omits headers for privilege levels with no members', () => {
    const rows = toRows([user('alice', [])]);
    expect(rows.filter((r) => r.type === 'header')).toHaveLength(1);
  });

  it('marks only the first header as first', () => {
    const rows = toRows([user('alice', ['op']), user('bob', [])]);
    const headers = rows.filter((r) => r.type === 'header');
    expect(headers.map((r) => r.type === 'header' && r.first)).toEqual([true, false]);
  });

  it('returns no rows for an empty user list', () => {
    expect(toRows([])).toEqual([]);
  });
});
