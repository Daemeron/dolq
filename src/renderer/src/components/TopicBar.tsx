type Props = {
  channelName: string;
  topic: string | undefined;
  topicSetBy?: string;
  topicSetAt?: Date;
  isLog: boolean;
  isQuery?: boolean;
  isDCC?: boolean;
  // Only meaningful (and passed) for a DCC session - reuses the same
  // connecting/connected/disconnected status a server connection has, see
  // App.tsx's statusMap (DCC session ids share it, not just real serverIds).
  dccStatus?: 'connecting' | 'connected' | 'disconnected';
};

export function TopicBar({ channelName, topic, topicSetBy, topicSetAt, isLog, isQuery, isDCC, dccStatus }: Props) {
  const whoWhen = topicSetBy && `Set by ${topicSetBy}${topicSetAt ? ` at ${topicSetAt.toLocaleString()}` : ''}`;
  return (
    <div className="h-12 flex items-center px-4 border-b border-[#2a2a2a] bg-[#212121] shrink-0 shadow-[0_1px_0_rgba(0,0,0,0.2)]">
      {isLog ? (
        <span className="font-semibold text-white text-[15px]">IRC Server Log</span>
      ) : isQuery ? (
        <>
          <span className="text-[#6b6b6b] text-[16px] mr-1 font-bold">{isDCC ? '⚡' : '@'}</span>
          <span className="font-bold text-white text-[15px]">{channelName}</span>
          {isDCC && dccStatus && (
            <>
              <span className="text-[#333333] mx-3 text-lg">|</span>
              <span className="text-[#6b6b6b] text-[13px] capitalize">{dccStatus}</span>
            </>
          )}
        </>
      ) : (
        <>
          <span className="text-[#6b6b6b] text-[16px] mr-1 font-bold">#</span>
          <span className="font-bold text-white text-[15px]">{channelName}</span>
          {topic && (
            <>
              <span className="text-[#333333] mx-3 text-lg">|</span>
              <span className="text-[#b0b0b0] text-[14px] truncate" title={whoWhen}>{topic}</span>
            </>
          )}
        </>
      )}
    </div>
  );
}
