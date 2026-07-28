import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { User } from '../types';
import { PRIVILEGE_RANK, highestPrivilege, type PrivilegeLevel } from '../../../shared/ipc';
import { useContextMenu } from '../hooks/useContextMenu';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

const GROUP_LABEL: Record<PrivilegeLevel, string> = {
  owner: 'Owners', admin: 'Admins', op: 'Operators', halfop: 'Half-Ops', voice: 'Voiced', none: 'Online',
};

const SYMBOL: Record<PrivilegeLevel, string> = {
  owner: '~', admin: '&', op: '@', halfop: '%', voice: '+', none: '',
};

const COLOR: Record<PrivilegeLevel, string> = {
  owner: '#ff92df', admin: '#ff5555', op: '#ffcb6b', halfop: '#8be9fd', voice: '#c792ea', none: '#909090',
};

type Row = { type: 'header'; privilege: PrivilegeLevel; count: number; first: boolean } | { type: 'user'; user: User };

// Flattened header+user rows (rather than nested groups) so the whole list is
// one virtualizer - a large channel is nearly all "user" rows anyway.
export function toRows(users: User[]): Row[] {
  const rows: Row[] = [];
  let first = true;
  for (const privilege of PRIVILEGE_RANK) {
    const members = users.filter((u) => highestPrivilege(u.privileges) === privilege);
    if (members.length === 0) continue;
    rows.push({ type: 'header', privilege, count: members.length, first });
    first = false;
    for (const user of members) rows.push({ type: 'user', user });
  }
  return rows;
}

function UserRow(
  { user, onOpenQuery, onContextMenu, ignored }: {
    user: User;
    onOpenQuery?: (nick: string) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    ignored: boolean;
  },
) {
  const privilege = highestPrivilege(user.privileges);
  const color = COLOR[privilege];
  return (
    <button
      onClick={onOpenQuery && (() => onOpenQuery(user.nick))}
      onContextMenu={onContextMenu}
      title={onOpenQuery ? `Message ${user.nick}` : undefined}
      className={`flex items-center gap-2 w-full px-2 py-1 rounded border-0 bg-transparent text-left hover:bg-[rgba(90,90,90,0.35)] cursor-pointer ${ignored ? 'opacity-40' : ''}`}
    >
      <div className="w-8 h-8 rounded-full bg-[#212121] text-[#e6e6e6] flex items-center justify-center text-[13px] font-semibold shrink-0">
        {user.nick[0]?.toUpperCase() ?? '?'}
      </div>
      <span className={`text-[14px] truncate ${ignored ? 'line-through text-[#6b6b6b]' : privilege === 'none' ? 'text-[#909090]' : 'text-[#e6e6e6]'}`}>
        {SYMBOL[privilege] && <span className="mr-0.5" style={{ color }}>{SYMBOL[privilege]}</span>}
        {user.nick}
      </span>
    </button>
  );
}

type ListProps = {
  users: User[];
  currentNick?: string;
  onOpenQuery?: (nick: string) => void;
  onWhois: (nick: string) => void;
  ignoredNicks: string[];
  onToggleIgnore: (nick: string) => void;
};

export function UserList({ users, currentNick, onOpenQuery, onWhois, ignoredNicks, onToggleIgnore }: ListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = toRows(users);
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();

  // Row heights are fixed by the markup (avatar/line height, no wrapping
  // text) but still measured rather than hardcoded, so padding/margin tweaks
  // to the rows below don't silently drift out of sync with a guessed number.
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 40,
    getItemKey: (index) => (rows[index].type === 'header' ? `h-${rows[index].privilege}` : rows[index].user.nick),
    overscan: 10,
  });

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-y-auto pt-4 pb-6 px-2 scroll-thin"
      onContextMenu={dismissIfUnhandled}
    >
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const row = rows[virtualRow.index];
          return (
            <div
              key={virtualRow.key}
              ref={rowVirtualizer.measureElement}
              data-index={virtualRow.index}
              style={{ position: 'absolute', top: 0, left: 0, right: 0, transform: `translateY(${virtualRow.start}px)` }}
            >
              {row.type === 'header' ? (
                <div className={row.first ? 'px-2 pb-1' : 'px-2 pb-1 mt-3'}>
                  <div className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#6b6b6b]">
                    {GROUP_LABEL[row.privilege]} — {row.count}
                  </div>
                </div>
              ) : (
                <UserRow
                  user={row.user}
                  onOpenQuery={row.user.nick === currentNick ? undefined : onOpenQuery}
                  onContextMenu={(e) => open(row.user.nick, e)}
                  ignored={ignoredNicks.includes(row.user.nick)}
                />
              )}
            </div>
          );
        })}
      </div>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y}>
          <ContextMenuHeader>{menu.target}</ContextMenuHeader>
          <ContextMenuItem onClick={() => { onWhois(menu.target); close(); }}>
            WHOIS
          </ContextMenuItem>
          <ContextMenuItem danger={!ignoredNicks.includes(menu.target)} onClick={() => { onToggleIgnore(menu.target); close(); }}>
            {ignoredNicks.includes(menu.target) ? 'Unignore' : 'Ignore'}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
