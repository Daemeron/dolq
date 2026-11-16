// The replies to a WHOIS are shown in its own window, so they are kept out of the server log. Reply 312 (the server)
// is also part of /whowas, which has no window; it is hidden only between the 311 and 318 of a WHOIS.
const WHOIS_ONLY = new Set([
  '275',
  '276',
  '307',
  '308',
  '309',
  '310',
  '313',
  '317',
  '319',
  '320',
  '330',
  '335',
  '338',
  '378',
  '379',
  '671',
  '716',
  '717',
]);

/** A filter for the lines of one server, in the order they arrive: true when a line belongs to a WHOIS and is hidden. */
export function createWhoisFilter() {
  const open = new Set<string>();
  return (line: string): boolean => {
    const m = /^(?:@\S+ )?(?::\S+ )?(\d{3}) \S+ (\S+)/.exec(line);
    if (!m) return false;
    const [, code, nick] = m;
    const key = nick.toLowerCase();
    if (code === '311') {
      open.add(key);
      return true;
    }
    if (code === '318') return open.delete(key) || true;
    if (code === '312') return open.has(key);
    return WHOIS_ONLY.has(code);
  };
}
