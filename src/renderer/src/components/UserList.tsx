import { useVirtualizer } from '@tanstack/react-virtual';
import { useRef } from 'react';
import { highestPrivilege, PRIVILEGE_RANK, type PrivilegeLevel } from '../../../shared/ipc';
import { useContextMenu } from '../hooks/useContextMenu';
import type { User } from '../types';
import { nickColor, nickInitial } from '../utils/nickColor';
import { ContextMenu, ContextMenuHeader, ContextMenuItem } from './ContextMenu';

const GROUP_LABEL: Record<PrivilegeLevel, string> = {
  owner: 'Owners',
  admin: 'Admins',
  op: 'Operators',
  halfop: 'Half-Ops',
  voice: 'Voiced',
  none: 'Members',
};

const SYMBOL: Record<PrivilegeLevel, string> = {
  owner: '~',
  admin: '&',
  op: '@',
  halfop: '%',
  voice: '+',
  none: '',
};

type Row = { type: 'header'; privilege: PrivilegeLevel; count: number; first: boolean } | { type: 'user'; user: User };

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

function UserRow({
  user,
  onOpenQuery,
  onContextMenu,
  ignored,
}: {
  user: User;
  onOpenQuery?: (nick: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
  ignored: boolean;
}) {
  const privilege = highestPrivilege(user.privileges);
  const color = nickColor(user.nick);
  return (
    <button
      type="button"
      onClick={onOpenQuery && (() => onOpenQuery(user.nick))}
      onContextMenu={onContextMenu}
      title={onOpenQuery ? `Message ${user.nick}` : undefined}
      className={`flex items-center gap-2 w-full px-2 py-1 rounded-lg border-0 bg-transparent text-left hover:bg-(--dolq-bg-row-hover) cursor-pointer ${ignored || user.away ? 'opacity-50' : ''}`}
    >
      <div
        className="w-7 h-7 rounded-full text-white flex items-center justify-center text-[12px] font-semibold shrink-0"
        style={{ background: color }}
      >
        {nickInitial(user.nick)}
      </div>
      <span
        className={`flex-1 min-w-0 text-[14px] font-medium truncate ${ignored ? 'line-through' : ''}`}
        style={{ color: ignored ? 'var(--dolq-text-faint)' : color }}
      >
        {user.nick}
        {user.away && !ignored && <span className="text-(--dolq-text-dim) font-normal"> (away)</span>}
      </span>
      {SYMBOL[privilege] && <span className="text-[12px] font-medium text-(--dolq-text-dim)">{SYMBOL[privilege]}</span>}
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
  onDCCOffer: (nick: string) => void;
  onSendFile: (nick: string) => void;
};

export function UserList({
  users,
  currentNick,
  onOpenQuery,
  onWhois,
  ignoredNicks,
  onToggleIgnore,
  onDCCOffer,
  onSendFile,
}: ListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rows = toRows(users);
  const { menu, open, close, dismissIfUnhandled } = useContextMenu<string>();

  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => containerRef.current,
    estimateSize: () => 36,
    getItemKey: (index) => (rows[index].type === 'header' ? `h-${rows[index].privilege}` : rows[index].user.nick),
    overscan: 10,
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: context menu has no keyboard equivalent here
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0 overflow-y-auto pt-1 pb-3 px-2"
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
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {row.type === 'header' ? (
                <div className={row.first ? 'px-2 pb-1' : 'px-2 pb-1 mt-3'}>
                  <div className="text-[12px] font-medium text-(--dolq-text-dim)">
                    {GROUP_LABEL[row.privilege]} · {row.count}
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
          <ContextMenuItem
            onClick={() => {
              onWhois(menu.target);
              close();
            }}
          >
            WHOIS
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onDCCOffer(menu.target);
              close();
            }}
          >
            DCC Chat
          </ContextMenuItem>
          <ContextMenuItem
            onClick={() => {
              onSendFile(menu.target);
              close();
            }}
          >
            Send File…
          </ContextMenuItem>
          <ContextMenuItem
            danger={!ignoredNicks.includes(menu.target)}
            onClick={() => {
              onToggleIgnore(menu.target);
              close();
            }}
          >
            {ignoredNicks.includes(menu.target) ? 'Unignore' : 'Ignore'}
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}
