export type IrcLogEntry = {
  id: number;
  raw: string;
  timestamp: Date;
};

export function IrcLogPanel({ lines }: { lines: IrcLogEntry[] }) {
  return (
    <section className="border-t border-[#26282d] bg-[#2f3136] px-4 py-3 shrink-0 w-12/12 overflow-hidden">
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.5px] text-[#72767d] overflow-hidden">
          IRC connection log
        </h2>
        <span className="text-[11px] text-[#72767d]">{lines.length} lines</span>
      </div>
      <div className="flex min-h-full max-h-full overflow-hidden rounded bg-[#292b2f] p-2">
        {lines.length === 0 ? (
          <p className="m-0 text-[13px] text-[#72767d]">No traffic yet.</p>
        ) : (
          <pre className="relative flex grow shrink basis-1 m-0 whitespace-pre-wrap break-all font-mono text-[12px] leading-5 text-[#dcddde] overflow-y-scroll">
            {lines.map((entry) => {
              const time = entry.timestamp.toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              });
              return `${time} ${entry.raw}`;
            }).join('\n')}
          </pre>
        )}
      </div>
    </section>
  );
}
