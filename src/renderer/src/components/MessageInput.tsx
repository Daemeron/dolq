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
    <div className="px-4 pb-6 pt-2 shrink-0">
      <form onSubmit={handleSubmit}>
        <input
          className="w-full bg-[#40444b] border-0 rounded-lg text-[#dcddde] text-[15px] px-4 py-3 outline-none caret-[#dcddde] placeholder:text-[#72767d] disabled:opacity-40 disabled:cursor-not-allowed"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={isLog ? 'Log view — type commands here like /join #channel' : `Message #${channelName}`}
        />
      </form>
    </div>
  );
}
