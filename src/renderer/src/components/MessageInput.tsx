import { useRef, useState } from 'react';
import { insertAtCaret } from '../utils/insertAtCaret';
import { restoreDraft, trySend } from '../utils/trySend';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';

type Props = {
  channelName: string;
  isLog: boolean;
  isQuery?: boolean;
  onSend: (text: string) => void | Promise<void>;
};

export function MessageInput({ channelName, isLog, isQuery, onSend }: Props) {
  const [value, setValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue('');
    setError('');
    const result = await trySend(trimmed, onSend);
    if (!result.ok) {
      setValue((current) => restoreDraft(current, trimmed));
      setError(`Not sent: ${result.error}`);
    }
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
    <div className="relative px-7 pb-5 pt-2 shrink-0">
      {showEmoji && <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />}
      {error && (
        <div role="alert" className="mb-1 text-[12px] text-(--dolq-danger)">
          {error}
        </div>
      )}
      <form
        onSubmit={handleSubmit}
        className="rounded-2xl border border-(--dolq-border-strong) bg-(--dolq-bg-input) pt-2.5 pr-2.5 pb-2 pl-4 focus-within:border-(--dolq-accent) focus-within:shadow-[0_0_0_3px_var(--dolq-accent-soft)]"
      >
        <input
          ref={inputRef}
          className="block w-full bg-transparent border-0 text-(--dolq-text) text-[15px] h-6.5 p-0 outline-none caret-(--dolq-text) placeholder:text-(--dolq-text-faint) disabled:opacity-40 disabled:cursor-not-allowed"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError('');
          }}
          placeholder={
            isLog
              ? 'Log view — type commands here like /join #channel'
              : isQuery
                ? `Message ${channelName}`
                : `Message #${channelName}`
          }
        />
        <div className="mt-1 flex items-center justify-between">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setShowEmoji((v) => !v);
            }}
            data-tip="Emoji"
            aria-label="Emoji"
            className="has-tip shrink-0 w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
          >
            <Icon name="smile" />
          </button>
          <button
            type="submit"
            aria-label="Send"
            disabled={!value.trim()}
            className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-(--dolq-accent) text-(--dolq-on-accent) cursor-pointer hover:bg-(--dolq-accent-hover) disabled:bg-(--dolq-bg-row-selected) disabled:text-(--dolq-text-faint) disabled:cursor-default"
          >
            <Icon name="send" />
          </button>
        </div>
      </form>
    </div>
  );
}
