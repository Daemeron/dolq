/** `unit` is 1024 for memory and files, and 1000 for a disk, the way a disk and the backend's own log say it. */
export function formatBytes(n: number, unit = 1024): string {
  if (n < unit) return `${Math.round(n)} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / unit;
  let i = 0;
  while (v >= unit && i < units.length - 1) {
    v /= unit;
    i++;
  }
  return `${v.toFixed(1)} ${units[i]}`;
}

export function formatRate(bytesPerSecond: number): string {
  return `${formatBytes(bytesPerSecond)}/s`;
}
