const PALETTE_SIZE = 8;

/** Stable theme-aware colour for a nick: one of the --dolq-nick-1..8 tokens. */
export function nickColor(nick: string): string {
  let hash = 0;
  for (let i = 0; i < nick.length; i++) hash = nick.charCodeAt(i) + ((hash << 5) - hash);
  return `var(--dolq-nick-${(Math.abs(hash) % PALETTE_SIZE) + 1})`;
}

export function nickInitial(nick: string): string {
  return nick[0]?.toUpperCase() ?? '?';
}
