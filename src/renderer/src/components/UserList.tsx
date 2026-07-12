import { User } from '../types';
import { PRIVILEGE_RANK, type PrivilegeLevel } from '../../../shared/ipc';

const GROUP_LABEL: Record<PrivilegeLevel, string> = {
  owner: 'Owners', admin: 'Admins', op: 'Operators', halfop: 'Half-Ops', voice: 'Voiced', none: 'Online',
};

const SYMBOL: Record<PrivilegeLevel, string> = {
  owner: '~', admin: '&', op: '@', halfop: '%', voice: '+', none: '',
};

const COLOR: Record<PrivilegeLevel, string> = {
  owner: '#e91e63', admin: '#f04747', op: '#faa61a', halfop: '#1abc9c', voice: '#7289da', none: '#8e9297',
};

function UserRow({ user }: { user: User }) {
  const color = COLOR[user.privilege];
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[rgba(79,84,92,0.4)] cursor-default">
      <div className="w-8 h-8 rounded-full bg-[#36393f] text-[#dcddde] flex items-center justify-center text-[13px] font-semibold shrink-0">
        {user.nick[0]?.toUpperCase() ?? '?'}
      </div>
      <span className={`text-[14px] truncate ${user.privilege === 'none' ? 'text-[#8e9297]' : 'text-[#dcddde]'}`}>
        {SYMBOL[user.privilege] && <span className="mr-0.5" style={{ color }}>{SYMBOL[user.privilege]}</span>}
        {user.nick}
      </span>
    </div>
  );
}

export function UserList({ users }: { users: User[] }) {
  const groups = PRIVILEGE_RANK
    .map((privilege) => ({ privilege, members: users.filter((u) => u.privilege === privilege) }))
    .filter((g) => g.members.length > 0);

  return (
    <>
      {groups.map((g, i) => (
        <div key={g.privilege}>
          {i > 0 && <div className="my-3" />}
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
            {GROUP_LABEL[g.privilege]} — {g.members.length}
          </div>
          {g.members.map((u) => <UserRow key={u.nick} user={u} />)}
        </div>
      ))}
    </>
  );
}
