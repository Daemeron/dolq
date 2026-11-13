import { useEffect, useRef, useState } from 'react';
import { suggestCommands } from '../utils/commandHints';
import { pushInputHistory, stepInputHistory } from '../utils/inputHistory';
import { insertAtCaret } from '../utils/insertAtCaret';
import { restoreDraft, trySend } from '../utils/trySend';
import { EmojiPicker } from './EmojiPicker';
import { Icon } from './Icon';

type Props = {
  channelName: string;
  isLog: boolean;
  isQuery?: boolean;
  /** Names of the user's aliases, offered next to the built-in commands. */
  aliasNames?: string[];
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

export function MessageInput({ channelName, isLog, isQuery, aliasNames, onSend, onSendFile }: Props) {
  const [value, setValue] = useState('');
  const [showEmoji, setShowEmoji] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<string[]>(loadSent);
  const [showSent, setShowSent] = useState(false);
  const [cursor, setCursor] = useState(-1);
  const [hintIndex, setHintIndex] = useState(0);
  const [hintsClosed, setHintsClosed] = useState(false);
  const hints = hintsClosed ? [] : suggestCommands(value, !!isQuery, aliasNames);
  const active = Math.min(hintIndex, hints.length - 1);
  const activeHint = useRef<HTMLButtonElement>(null);
  const draft = useRef('');

  // Arrowing past the visible part of a long list keeps the highlighted entry in view.
  // biome-ignore lint/correctness/useExhaustiveDependencies: scrolls only when the highlight moves
  useEffect(() => activeHint.current?.scrollIntoView?.({ block: 'nearest' }), [active, hints.length]);
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
        {hints.length > 0 && (
          <ul
            aria-label="Commands"
            className="absolute bottom-full left-0 z-10 mb-1 m-0 max-h-80 w-96 max-w-full overscroll-contain list-none overflow-y-auto rounded-xl border border-(--dolq-border-strong) bg-(--dolq-bg-panel) p-1 shadow-lg"
          >
            {hints.map((c, i) => (
              <li key={c.name}>
                <button
                  ref={i === active ? activeHint : undefined}
                  type="button"
                  tabIndex={-1}
                  // mouse down, not click: the input must keep focus
                  onMouseDown={(e) => {
                    e.preventDefault();
                    setValue(`/${c.name} `);
                  }}
                  className={`block w-full cursor-pointer rounded-lg border-0 px-2 py-1.5 text-left ${i === active ? 'bg-(--dolq-bg-row-selected)' : 'bg-transparent hover:bg-(--dolq-bg-row-hover)'}`}
                >
                  <div className="font-mono text-[13px] text-(--dolq-text)">{c.usage}</div>
                  <div className="text-[12px] text-(--dolq-text-dim)">{c.desc}</div>
                </button>
              </li>
            ))}
          </ul>
        )}
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
            if (hints.length > 0) {
              if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                e.preventDefault();
                setHintIndex((active + (e.key === 'ArrowUp' ? -1 : 1) + hints.length) % hints.length);
                return;
              }
              if (e.key === 'Tab' || (e.key === 'Enter' && value !== `/${hints[active].name}`)) {
                e.preventDefault();
                setValue(`/${hints[active].name} `);
                return;
              }
              if (e.key === 'Escape') {
                setHintsClosed(true);
                return;
              }
            }
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              recall(e.key === 'ArrowUp' ? 1 : -1);
            }
          }}
          onChange={(e) => {
            setCursor(-1);
            setHintsClosed(false);
            setHintIndex(0);
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
