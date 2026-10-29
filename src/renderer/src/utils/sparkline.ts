/** SVG polyline points for a series, scaled to fill width x height (higher values higher up). A flat or single-point series sits mid-height. */
export function sparklinePoints(values: number[], width: number, height: number): string {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const span = Math.max(...values) - min;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .map((v, i) => {
      const y = span === 0 ? height / 2 : height - ((v - min) / span) * height;
      return `${(i * step).toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');
}
