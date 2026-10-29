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

/** Which status colour token a round trip deserves. */
export function latencyTone(ms: number): 'ok' | 'warn' | 'danger' {
  return ms < 150 ? 'ok' : ms < 400 ? 'warn' : 'danger';
}
