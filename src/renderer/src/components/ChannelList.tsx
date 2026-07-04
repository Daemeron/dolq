import { Channel } from '../DummyData';

type Props = {
  serverName: string;
  channels: Channel[];
  selectedId: string;
  onSelect: (id: string) => void;
  currentNick: string;
};

export function ChannelList({ serverName, channels, selectedId, onSelect, currentNick }: Props) {
  const logChannel = channels.find((c) => c.isLog);
  const regularChannels = channels.filter((c) => !c.isLog);

  return (
    <aside className="flex flex-col w-60 bg-[#2f3136] shrink-0 overflow-hidden">
      <div className="px-4 h-12 flex items-center font-bold text-[15px] text-white border-b border-[#26282d] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
        {serverName}
      </div>

      {logChannel && (
        <div className="pt-3 pb-1 px-2">
          <button
            onClick={() => onSelect(logChannel.id)}
            className={`flex items-center gap-2 w-full py-1.5 px-2 rounded border-0 text-[14px] cursor-pointer text-left font-medium transition-[background,color] duration-100 ${
              selectedId === logChannel.id
                ? 'bg-[rgba(79,84,92,0.6)] text-white'
                : 'bg-transparent text-[#8e9297] hover:bg-[rgba(79,84,92,0.4)] hover:text-[#dcddde]'
            }`}
          >
            <span className="font-mono text-[11px] opacity-60">▤</span>
            Log
          </button>
        </div>
      )}

      <div className="pt-3 pb-1 px-4 text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d]">
        Text Channels
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {regularChannels.map((ch) => (
          <button
            key={ch.id}
            onClick={() => onSelect(ch.id)}
            className={`flex items-center w-full py-1.5 px-2 my-px rounded border-0 text-[15px] cursor-pointer text-left transition-[background,color] duration-100 ${
              ch.id === selectedId
                ? 'bg-[rgba(79,84,92,0.6)] text-white'
                : 'bg-transparent text-[#8e9297] hover:bg-[rgba(79,84,92,0.4)] hover:text-[#dcddde]'
            }`}
          >
            <span className="text-[16px] mr-1.5 opacity-50">#</span>
            {ch.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 p-2 bg-[#292b2f] shrink-0">
        <div className="w-8 h-8 rounded-full bg-[#7289da] text-white flex items-center justify-center font-bold text-sm shrink-0">
          {currentNick[0]?.toUpperCase() ?? '?'}
        </div>
        <span className="text-[13px] font-semibold text-white truncate">{currentNick}</span>
      </div>
    </aside>
  );
}
