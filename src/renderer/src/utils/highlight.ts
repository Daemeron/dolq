// Splits text around each case-insensitive occurrence of query, so the matches can be marked.
export function splitMatches(text: string, query: string): (string | { match: string })[] {
  const q = query.trim();
  if (!q) return [text];
  const escaped = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text
    .split(new RegExp(`(${escaped})`, 'i'))
    .filter((part) => part !== '')
    .map((part) => (part.toLowerCase() === q.toLowerCase() ? { match: part } : part));
}
