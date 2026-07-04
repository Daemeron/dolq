import { User } from '../DummyData';

function UserRow({ user }: { user: User }) {
  return (
    <div className="flex items-center gap-2 px-2 py-1 rounded hover:bg-[rgba(79,84,92,0.4)] cursor-default">
      <div className="w-8 h-8 rounded-full bg-[#36393f] text-[#dcddde] flex items-center justify-center text-[13px] font-semibold shrink-0">
        {user.nick[0]?.toUpperCase() ?? '?'}
      </div>
      <span className={`text-[14px] truncate ${user.isOp ? 'text-[#dcddde]' : 'text-[#8e9297]'}`}>
        {user.isOp && <span className="text-[#faa61a] mr-0.5">@</span>}
        {user.nick}
      </span>
    </div>
  );
}

export function UserList({ users }: { users: User[] }) {
  const ops = users.filter((u) => u.isOp);
  const regular = users.filter((u) => !u.isOp);

  return (
    <aside className="w-52 bg-[#2f3136] border-l border-[#26282d] shrink-0 overflow-y-auto py-4 px-2">
      {ops.length > 0 && (
        <>
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
            Operators — {ops.length}
          </div>
          {ops.map((u) => <UserRow key={u.nick} user={u} />)}
          {regular.length > 0 && <div className="my-3" />}
        </>
      )}
      {regular.length > 0 && (
        <>
          <div className="px-2 pb-1 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
            Online — {regular.length}
          </div>
          {regular.map((u) => <UserRow key={u.nick} user={u} />)}
        </>
      )}
    </aside>
  );
}
