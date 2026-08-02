// Detects NickServ's "this nick is registered/reserved, please identify"
// prompt - the exact wording varies by network/services package (atheme,
// anope, ergo's built-in NickServ all phrase it slightly differently), so
// this matches loosely on the words that actually matter rather than one
// network's exact sentence. False positives are harmless (worst case: an
// unnecessary prompt to identify); false negatives just mean the existing
// raw NOTICE in the Log is all you get, same as before this existed.
export function isNickServIdentifyPrompt(nick: string, text: string): boolean {
  if (!/^nickserv$/i.test(nick)) return false;
  const t = text.toLowerCase();
  return t.includes('identify') && (t.includes('registered') || t.includes('reserved'));
}
