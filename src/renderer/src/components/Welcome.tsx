import { PRESET_BLURBS, type ServerPreset } from '../data/servers';
import { nickColor } from '../utils/nickColor';
import { serverInitials } from '../utils/server';
import { Icon } from './Icon';
import { Button } from './ui';

type Props = {
  presets: ServerPreset[];
  onPickPreset: (id: string) => void;
  onAddCustom: () => void;
  onPair: () => void;
};

/** What the app shows before any server exists. */
export function Welcome({ presets, onPickPreset, onAddCustom, onPair }: Props) {
  const featured = presets.filter((p) => PRESET_BLURBS[p.id]);
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center gap-7 p-8">
      <div className="titlebar-drag absolute inset-x-0 top-0 h-14" />
      <div className="max-w-130 text-center">
        <h1 className="m-0 mb-3 font-(family-name:--dolq-font-serif) text-[44px] leading-[1.15] font-normal text-(--dolq-text)">
          Welcome to Dolq
        </h1>
        <p className="m-0 text-[16px] text-(--dolq-text-dim)">
          Pick a network to get started, or add your own server. Your connections stay alive on the backend while you
          are away.
        </p>
      </div>
      {featured.length > 0 && (
        <div className="grid w-full max-w-160 grid-cols-3 gap-3">
          {featured.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => onPickPreset(p.id)}
              className="flex cursor-pointer items-center gap-3 rounded-xl border border-(--dolq-border) bg-(--dolq-bg-input) p-4 text-left hover:bg-(--dolq-bg-row-hover)"
            >
              <span
                aria-hidden="true"
                className="flex size-9 shrink-0 items-center justify-center rounded-[11px] text-[14px] font-semibold text-white"
                style={{ background: nickColor(p.name) }}
              >
                {serverInitials(p.name)}
              </span>
              <span className="min-w-0">
                <span className="block text-[14px] font-medium text-(--dolq-text)">{p.name}</span>
                <span className="block text-[12px] text-(--dolq-text-dim)">{PRESET_BLURBS[p.id]}</span>
              </span>
            </button>
          ))}
        </div>
      )}
      <div className="flex gap-2">
        <Button variant="primary" onClick={onAddCustom}>
          <Icon name="plus" size={15} />
          Add custom server
        </Button>
        <Button onClick={onPair}>Pair with a remote backend</Button>
      </div>
    </div>
  );
}
