import { useState } from 'react';

type Props = {
  channelName: string;
  isLog: boolean;
  onSend: (text: string) => void;
};

export function MessageInput({ channelName, isLog, onSend }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    onSend(trimmed);
    setValue('');
  }

  return (
    <div className="px-4 pb-2.5 pt-2 shrink-0">
      <form onSubmit={handleSubmit}>
        <input
          className="w-full bg-[#333333] border-0 rounded-lg text-[#e6e6e6] text-[15px] px-4 py-3 outline-none caret-[#e6e6e6] placeholder:text-[#6b6b6b] disabled:opacity-40 disabled:cursor-not-allowed"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isLog ? 'Log view — type commands here like /join #channel' : `Message #${channelName}`}
        />
      </form>
    </div>
  );
}
