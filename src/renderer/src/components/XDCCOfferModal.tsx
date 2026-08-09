type Props = {
  nick: string;
  filename: string;
  size: number;
  onAccept: () => void;
  onDecline: () => void;
};

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

// A DCC SEND offer connects straight to the sender's address the same way
// a DCC CHAT offer does (see DCCOfferModal) - same explicit prompt, just
// with the file details that actually matter for deciding whether to take
// it: what it's called and how big it is.
export function XDCCOfferModal({ nick, filename, size, onAccept, onDecline }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDecline}>
      <div
        className="bg-[#1c1c1c] rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[18px] font-bold mb-2">File Offer</h2>
        <p className="text-[#b0b0b0] text-[14px] mb-1">
          <span className="text-[#e6e6e6] font-semibold">{nick}</span> wants to send you a file, direct to your
          address. Only accept this from someone (or a bot) you trust.
        </p>
        <p className="text-[#e6e6e6] text-[14px] font-mono mb-5 break-all">
          {filename} <span className="text-[#6b6b6b]">({formatBytes(size)})</span>
        </p>
        <div className="flex gap-3 justify-end">
          <button
            onClick={onDecline}
            className="px-4 py-2 rounded text-[#b0b0b0] text-[14px] font-medium bg-transparent border-0 cursor-pointer hover:text-white"
          >
            Decline
          </button>
          <button
            onClick={onAccept}
            className="px-5 py-2 rounded bg-[#c792ea] text-white text-shadow-sm text-[14px] font-semibold border-0 cursor-pointer hover:bg-[#a579c2] transition-colors duration-150"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
