import type { RateSample } from '../hooks/useRateHistory';
import { formatRate } from '../utils/bytes';
import { sparklinePoints } from '../utils/sparkline';

const WIDTH = 640;
const HEIGHT = 80;

/** Download and upload over time on one scale, so the two lines can be compared. */
export function BandwidthChart({ samples }: { samples: RateSample[] }) {
  const peak = Math.max(0, ...samples.flatMap((s) => [s.down, s.up]));
  const range = { min: 0, max: Math.max(peak, 1) };
  const last = samples.at(-1);
  return (
    <div className="flex flex-col gap-2 px-4 py-3.5">
      <div className="flex items-baseline gap-4 text-[13px]">
        <span className="font-medium text-(--dolq-text)">Bandwidth</span>
        <span className="flex items-center gap-1.5 text-(--dolq-text-dim)">
          <span aria-hidden="true" className="h-0.5 w-3 rounded bg-(--dolq-accent)" />
          Download
        </span>
        <span className="flex items-center gap-1.5 text-(--dolq-text-dim)">
          <span aria-hidden="true" className="h-0.5 w-3 rounded bg-(--dolq-nick-3)" />
          Upload
        </span>
        <span className="ml-auto text-(--dolq-text-faint)">peak {formatRate(peak)}</span>
      </div>
      <svg
        role="img"
        aria-label={`Download and upload over time${last ? `, ${formatRate(last.down)} down and ${formatRate(last.up)} up now` : ''}`}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        className="h-20 w-full overflow-visible"
      >
        <line x1="0" x2={WIDTH} y1={HEIGHT} y2={HEIGHT} stroke="var(--dolq-border)" />
        {samples.length > 1 && (
          <>
            <polyline
              points={sparklinePoints(
                samples.map((s) => s.down),
                WIDTH,
                HEIGHT,
                range,
              )}
              fill="none"
              stroke="var(--dolq-accent)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
            <polyline
              points={sparklinePoints(
                samples.map((s) => s.up),
                WIDTH,
                HEIGHT,
                range,
              )}
              fill="none"
              stroke="var(--dolq-nick-3)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
      {samples.length < 2 && <span className="text-[12px] text-(--dolq-text-faint)">Collecting samples…</span>}
    </div>
  );
}
