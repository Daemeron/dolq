import { useEffect, useMemo, useState } from 'react';
import { EMOJI_GROUPS } from '../data/emoji';

type Props = {
  onSelect: (emoji: string) => void;
  onClose: () => void;
};

// Anchored via plain CSS (`absolute bottom-full`) on the message input's own
// `relative` wrapper - there's only ever one of these on screen, always in
// the same spot right above the input, so there's no need for the
// click-coordinate positioning ContextMenu/useContextMenu use for a menu
// that can open anywhere in the sidebar.
export function EmojiPicker({ onSelect, onClose }: Props) {
  const [query, setQuery] = useState('');

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    // Deferred a frame so the same click that opened this (the toggle
    // button) doesn't immediately close it again - same reasoning as
    // useContextMenu's window click listener.
    const id = requestAnimationFrame(() => window.addEventListener('click', onClose));
    window.addEventListener('keydown', onKey);
    return () => {
      cancelAnimationFrame(id);
      window.removeEventListener('click', onClose);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return EMOJI_GROUPS;
    return EMOJI_GROUPS.map((g) => ({ ...g, emoji: g.emoji.filter((e) => e.name.includes(q)) })).filter(
      (g) => g.emoji.length > 0,
    );
  }, [query]);

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="absolute bottom-full left-0 mb-2 w-72 h-80 flex flex-col bg-[var(--dolq-bg-panel-alt)] rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.4)] overflow-hidden"
    >
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search emoji…"
        className="m-2 bg-[var(--dolq-bg-input)] border-0 rounded text-[var(--dolq-text)] text-[13px] px-2.5 py-1.5 outline-none focus:ring-2 focus:ring-[#c792ea] placeholder:text-[var(--dolq-text-faint)]"
      />
      <div className="flex-1 overflow-y-auto scroll-thin px-2 pb-2">
        {groups.length === 0 && <p className="text-[var(--dolq-text-faint)] text-[12px] text-center py-4">No matches</p>}
        {groups.map((group) => (
          <div key={group.label} className="mb-2">
            <div className="text-[10px] font-bold uppercase tracking-[0.5px] text-[var(--dolq-text-muted)] px-1 mb-1">
              {group.label}
            </div>
            <div className="grid grid-cols-8">
              {group.emoji.map(({ char, name }) => (
                <button
                  key={char}
                  type="button"
                  title={name}
                  onClick={() => onSelect(char)}
                  className="w-8 h-8 flex items-center justify-center text-[18px] rounded border-0 bg-transparent cursor-pointer hover:bg-[var(--dolq-bg-hover)]"
                >
                  {char}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
