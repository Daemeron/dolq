import { useRef, useState } from 'react';
import { insertAtCaret } from '../utils/insertAtCaret';
import { EmojiPicker } from './EmojiPicker';

type Props = {
  channelName: string;
  isLog: boolean;
  isQuery?: boolean;
  onSend: (text: string) => void;
};

export function MessageInput({ channelName, isLog, isQuery, onSend }: Props) {
  const [value, setValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  }

  function insertEmoji(emoji: string) {
    const input = inputRef.current;
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? value.length;
    const { text, caret } = insertAtCaret(value, start, end, emoji);
    setValue(text);
    setShowEmoji(false);
    requestAnimationFrame(() => {
      input?.focus();
      input?.setSelectionRange(caret, caret);
    });
  }

  return (
    <div className="relative px-4 pb-2.5 pt-2 shrink-0">
      {showEmoji && <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />}
      <form onSubmit={handleSubmit} className="flex items-center gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setShowEmoji((v) => !v);
          }}
          title="Emoji"
          aria-label="Emoji"
          className="shrink-0 w-9 h-9 flex items-center justify-center text-[18px] rounded-lg border-0 bg-(--dolq-bg-input) cursor-pointer hover:bg-(--dolq-bg-hover)"
        >
          🙂
        </button>
        <input
          ref={inputRef}
          className="flex-1 bg-(--dolq-bg-input) border-0 rounded-lg text-(--dolq-text) text-[15px] px-4 py-3 outline-none caret-(--dolq-text) placeholder:text-(--dolq-text-faint) disabled:opacity-40 disabled:cursor-not-allowed"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={
            isLog
              ? 'Log view — type commands here like /join #channel'
              : isQuery
                ? `Message ${channelName}`
                : `Message #${channelName}`
          }
        />
      </form>
    </div>
  );
}
