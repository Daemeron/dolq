/**
 * SVG polyline points for a series, scaled to fill width x height (higher values higher up). By default the series
 * fills the box on its own; pass a range to put several series on one scale. A flat or single-point series sits
 * mid-height.
 */
export function sparklinePoints(
  values: number[],
  width: number,
  height: number,
  range?: { min: number; max: number },
): string {
  if (values.length === 0) return '';
  const min = range?.min ?? Math.min(...values);
  const span = (range?.max ?? Math.max(...values)) - min;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const y = span <= 0 ? height / 2 : height - ((v - min) / span) * height;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
