import { useRef, useState } from 'react';
import { pushInputHistory, stepInputHistory } from '../utils/inputHistory';
import { insertAtCaret } from '../utils/insertAtCaret';
import { restoreDraft, trySend } from '../utils/trySend';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';

type Props = {
  channelName: string;
  isLog: boolean;
  isQuery?: boolean;
  onSend: (text: string) => void | Promise<void>;
  /** Offers to send a file to the person in this conversation. */
  onSendFile?: () => void;
};

const SENT_KEY = 'dolq.sentMessages';

function loadSent(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(SENT_KEY) ?? '[]');
    return Array.isArray(parsed) ? parsed.filter((t) => typeof t === 'string') : [];
  } catch {
    return [];
  }
}

export function MessageInput({ channelName, isLog, isQuery, onSend, onSendFile }: Props) {
  const [value, setValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<string[]>(loadSent);
  const [showSent, setShowSent] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const draft = useRef('');
  const inputRef = useRef<HTMLInputElement>(null);

  function remember(text: string) {
    const next = pushInputHistory(sent, text);
    setSent(next);
    setCursor(-1);
    try {
      localStorage.setItem(SENT_KEY, JSON.stringify(next));
    } catch {}
  }

  function recall(delta: 1 | -1) {
    const next = stepInputHistory(cursor, delta, sent.length);
    if (next === cursor) return;
    if (cursor === -1) draft.current = value;
    setCursor(next);
    setValue(next === -1 ? draft.current : sent[next]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    setValue('');
    setError('');
    remember(trimmed);
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
        className="relative flex items-center gap-0.5 rounded-2xl border border-(--dolq-border-strong) bg-(--dolq-bg-input) px-1.5 py-1.5 focus-within:border-(--dolq-brand) focus-within:shadow-[0_0_0_3px_var(--dolq-brand-soft)]"
      >
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
        {onSendFile && (
          <button
            type="button"
            onClick={onSendFile}
            data-tip="Send file"
            aria-label="Send file"
            className="has-tip shrink-0 w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover)"
          >
            <Icon name="paperclip" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setShowSent((v) => !v)}
          disabled={sent.length === 0}
          data-tip="Recent messages"
          aria-label="Recent messages"
          className="has-tip shrink-0 w-8.5 h-8.5 flex items-center justify-center rounded-lg border-0 bg-transparent text-(--dolq-text-dim) cursor-pointer hover:text-(--dolq-text) hover:bg-(--dolq-bg-row-hover) disabled:opacity-40 disabled:cursor-default"
        >
          <Icon name="history" />
        </button>
        {showSent && (
          <ul className="absolute bottom-full left-0 z-10 mb-1 m-0 max-h-64 w-72 list-none overflow-y-auto rounded-xl border border-(--dolq-border-strong) bg-(--dolq-bg-panel) p-1 shadow-lg">
            {sent.slice(0, 10).map((text) => (
              <li key={text}>
                <button
                  type="button"
                  onClick={() => {
                    setValue(text);
                    setShowSent(false);
                    inputRef.current?.focus();
                  }}
                  className="w-full truncate rounded-lg border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-(--dolq-text) cursor-pointer hover:bg-(--dolq-bg-row-hover)"
                >
                  {text}
                </button>
              </li>
            ))}
          </ul>
        )}
        <input
          ref={inputRef}
          className="min-w-0 flex-1 bg-transparent border-0 text-(--dolq-text) text-[15px] h-8.5 px-2 outline-none caret-(--dolq-text) placeholder:text-(--dolq-text-faint) disabled:opacity-40 disabled:cursor-not-allowed"
          value={value}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              recall(e.key === 'ArrowUp' ? 1 : -1);
            }
          }}
          onChange={(e) => {
            setCursor(-1);
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
        <button
          type="submit"
          aria-label="Send"
          disabled={!value.trim()}
          className="shrink-0 w-8 h-8 flex items-center justify-center rounded-lg border-0 bg-(--dolq-brand) text-(--dolq-on-brand) cursor-pointer hover:bg-(--dolq-brand-hover) disabled:bg-(--dolq-bg-row-selected) disabled:text-(--dolq-text-faint) disabled:cursor-default"
        >
          <Icon name="send" />
        </button>
      </form>
    </div>
  );
}
