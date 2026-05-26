import { Server } from '../DummyData';

type Props = {
  servers: Server[];
  selectedId: string;
  onSelect: (id: string) => void;
  onAddServer: () => void;
};

export function ServerList({ servers, selectedId, onSelect, onAddServer }: Props) {
  return (
    <aside className="flex flex-col items-center gap-2 px-3 py-3 w-18 bg-[#202225] shrink-0">
      {servers.map((s) => (
        <button
          key={s.id}
          title={s.name}
          onClick={() => onSelect(s.id)}
          className={`w-12 h-12 text-[18px] font-bold cursor-pointer select-none border-0 rounded-[30%] transition-[background] duration-150 ${
            s.id === selectedId
              ? 'bg-[#7289da] text-white'
              : 'bg-[#36393f] text-[#dcddde] hover:bg-[#7289da] hover:text-white'
          }`}
        >
          {s.initial}
        </button>
      ))}
      <div className="w-8 h-px bg-[#36393f] my-1" />
      <button
        title="Add server"
        onClick={onAddServer}
        className="w-12 h-12 rounded-full bg-[#36393f] text-[#3ba55d] text-[22px] flex items-center justify-center font-bold cursor-pointer border-0 hover:bg-[#3ba55d] hover:text-white transition-[border-radius,background] duration-150 select-none"
      >
        +
      </button>
    </aside>
  );
}
