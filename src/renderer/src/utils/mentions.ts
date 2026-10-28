// A line is a mention when it names the nick or one of the user's highlight words.
export function mentionsAny(text: string, nick: string, words: string[]): boolean {
  return [nick, ...words].some((w) => mentionsNick(text, w));
}

export function mentionsNick(text: string, nick: string): boolean {
  if (!nick) return false;
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text);
}
