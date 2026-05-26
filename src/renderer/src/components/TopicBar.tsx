type Props = {
  channelName: string;
  topic: string | undefined;
  isLog: boolean;
};

export function TopicBar({ channelName, topic, isLog }: Props) {
  return (
    <div className="h-12 flex items-center px-4 border-b border-[#26282d] bg-[#36393f] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
      {isLog ? (
        <span className="font-semibold text-white text-[15px]">IRC Server Log</span>
      ) : (
        <>
          <span className="text-[#72767d] text-[16px] mr-1 font-bold">#</span>
          <span className="font-bold text-white text-[15px]">{channelName}</span>
          {topic && (
            <>
              <span className="text-[#40444b] mx-3 text-lg">|</span>
              <span className="text-[#b9bbbe] text-[14px] truncate">{topic}</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
