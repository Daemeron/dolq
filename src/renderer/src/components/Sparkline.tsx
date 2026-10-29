import { sparklinePoints } from '../utils/sparkline';

type Props = {
  values: number[];
  label: string;
  width?: number;
  height?: number;
  className?: string;
  /** Scale to this range instead of the series' own spread. */
  range?: { min: number; max: number };
};

/** A small trend line. Needs two points to draw anything. */
export function Sparkline({ values, label, width = 160, height = 32, className = '', range }: Props) {
  return (
    <svg
      role="img"
      aria-label={label}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`shrink-0 overflow-visible ${className}`}
    >
      {values.length > 1 && (
        <polyline
          points={sparklinePoints(values, width, height, range)}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
