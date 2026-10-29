export type LatencyStats = { last: number; min: number; max: number; avg: number };

export function latencyStats(samples: { ms: number }[]): LatencyStats | null {
  if (samples.length === 0) return null;
  const values = samples.map((s) => s.ms);
  return {
    last: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    avg: Math.round(values.reduce((a, b) => a + b, 0) / values.length),
  };
}

// A trend line scaled to its own spread makes 11 to 12 ms look like a mountain range; never show less than this span.
const MIN_SPAN_MS = 50;

export function latencyRange(stats: LatencyStats): { min: number; max: number } {
  return { min: stats.min, max: Math.max(stats.max, stats.min + MIN_SPAN_MS) };
}

/** Which status colour token a round trip deserves. */
export function latencyTone(ms: number): 'ok' | 'warn' | 'danger' {
  return ms < 150 ? 'ok' : ms < 400 ? 'warn' : 'danger';
}
