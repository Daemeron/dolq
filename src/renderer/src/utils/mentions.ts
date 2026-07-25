// Case-insensitive whole-word match - "bob" mentions "bob" but not "bobby"
// or "abob". Bounded with lookarounds rather than \b: IRC nicks can start or
// end with a non-word character (`[bot]`, RFC 2812 allows []{}\|^_-\`), and
// \b only fires on a word/non-word transition - it'd never match "[bot]" at
// all, since both the character before "[" and "[" itself are already
// non-word. Rejecting an alphanumeric neighbor directly works regardless of
// what the nick's own edge characters are.
export function mentionsNick(text: string, nick: string): boolean {
  if (!nick) return false;
  const escaped = nick.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`, 'i').test(text);
}
