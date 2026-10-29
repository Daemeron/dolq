import { serverColor, serverIconText } from '../utils/server';
import { Field, inputClass } from './ui';

// Auto (empty) plus the nick palette, so server icons read like the user list.
const SWATCHES = ['', ...Array.from({ length: 8 }, (_, i) => `var(--dolq-nick-${i + 1})`)];

type Props = {
  serverId: string;
  name: string;
  initials: string;
  color: string;
  onChange: (patch: { initials?: string; color?: string }) => void;
};

/** The server's icon: a preview, the letters on it (2-3 characters) and its colour. */
export function ServerAppearance({ serverId, name, initials, color, onChange }: Props) {
  // A colour from before the palette existed (a hex value) stays selectable.
  const swatches = SWATCHES.includes(color) ? SWATCHES : [...SWATCHES, color];
  return (
    <div className="flex items-start gap-4">
      <span
        aria-hidden="true"
        style={{ background: serverColor({ id: serverId, color }) }}
        className="flex h-10.5 w-10.5 shrink-0 items-center justify-center rounded-[13px] text-[15px] font-semibold text-white"
      >
        {serverIconText({ name, initials })}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Field label="Icon letters">
          <input
            className={`${inputClass} w-24`}
            value={initials}
            maxLength={3}
            placeholder={serverIconText({ name })}
            onChange={(e) => onChange({ initials: e.target.value })}
          />
        </Field>
        <fieldset aria-label="Icon colour" className="m-0 flex flex-wrap gap-2 border-0 p-0">
          {swatches.map((c) => (
            <button
              key={c || 'auto'}
              type="button"
              aria-pressed={c === color}
              aria-label={c === '' ? 'Automatic colour' : `Colour ${c}`}
              onClick={() => onChange({ color: c })}
              style={{ background: c || serverColor({ id: serverId }) }}
              className={`flex size-6 cursor-pointer items-center justify-center rounded-full border-0 text-[11px] font-semibold text-white ${
                c === color ? 'ring-2 ring-offset-2 ring-(--dolq-text) ring-offset-(--dolq-bg-panel)' : ''
              }`}
            >
              {c === '' ? 'A' : null}
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
