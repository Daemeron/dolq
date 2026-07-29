type Props = {
  nick: string;
  onAccept: () => void;
  onDecline: () => void;
};

// A DCC CHAT offer is a direct peer-to-peer connection, not something
// routed through the IRC server - accepting it means dialing straight out
// to whatever address the sender announced, so unlike a query (opened just
// by looking at an incoming message) this one gets an explicit prompt.
export function DCCOfferModal({ nick, onAccept, onDecline }: Props) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onDecline}>
      <div
        className="bg-[#1c1c1c] rounded-lg p-6 w-90 shadow-[0_8px_32px_rgba(0,0,0,0.5)]"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-white text-[18px] font-bold mb-2">DCC Chat Request</h2>
        <p className="text-[#b0b0b0] text-[14px] mb-5">
          <span className="text-[#e6e6e6] font-semibold">{nick}</span> wants to start a direct chat with you,
          outside the server. Only accept this from someone you trust - it connects straight to their address.
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
