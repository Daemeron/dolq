export function isNickServIdentifyPrompt(nick: string, text: string): boolean {
  if (!/^nickserv$/i.test(nick)) return false;
  const t = text.toLowerCase();
  return t.includes('identify') && (t.includes('registered') || t.includes('reserved'));
}
