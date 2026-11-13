/** `name` is the file name the page shows next to the request, when it shows one. */
export type PackRequest = { bot: string; pack: number; name?: string };
/** The network and channel a packlist says its bots are on, from its irc:// link. */
export type PackSource = { host: string; channel?: string };

export type PackBatch = { bot: string; spec: string; count: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d+)|#x([0-9a-f]+)|(\w+));/gi, (whole, dec, hex, name) => {
    const code = dec ? Number(dec) : hex ? Number.parseInt(hex, 16) : null;
    if (code !== null) return code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    return ENTITIES[name.toLowerCase()] ?? whole;
  });
}

// "/msg Bot xdcc send #12" as it appears in the visible text of a packlist page.
// A range or list after the number ("#1-5") is not a single pack and is skipped.
const REQUEST_RE = /\/(?:msg|privmsg)\s+([^\s#&:]\S*)\s+xdcc\s+(?:send|get)\s+#?(\d{1,6})(?![\d,-])/gi;

// Row and line ends in the markup become line breaks, so a table row or list item stays one line.
const LINE_BREAK_TAGS = /<\/(?:tr|li|p|div|pre|h\d|table)>|<br\s*\/?>/gi;

export function extractPackRequests(html: string): PackRequest[] {
  const text = decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
      .replace(LINE_BREAK_TAGS, '\n')
      .replace(/<[^>]*>/g, ' '),
  );
  const seen = new Set<string>();
  const found: PackRequest[] = [];
  for (const m of text.matchAll(REQUEST_RE)) {
    const pack = Number(m[2]);
    const key = `${m[1].toLowerCase()}\0${pack}`;
    if (pack < 1 || seen.has(key)) continue;
    seen.add(key);
    found.push({ bot: m[1], pack, name: nameNear(text, m.index, m[0]) });
  }
  return found;
}

// What else is on the command's line, or on the nearest line above when the command stands alone.
function nameNear(text: string, at: number, command: string): string | undefined {
  const start = text.lastIndexOf('\n', at) + 1;
  const end = text.indexOf('\n', at);
  const line = `${text.slice(start, at)} ${text.slice(at + command.length, end < 0 ? undefined : end)}`;
  const own = line.replace(/\s+/g, ' ').trim();
  if (own) return own;
  const above = text
    .slice(0, start)
    .split('\n')
    .reverse()
    .find((l) => l.trim());
  return above?.replace(/\s+/g, ' ').trim();
}

// Pages made by "XDCC Parser" hold no commands in their HTML: a script asks search.php for the rows
// of the search (?search=, ?t= or ?=) or bot (?nick=) in the page link and builds the table.
// The rows come back as plain "p.k[0] = {b:"Bot", n:12, s:371, f:"file.mkv"};" lines, read here as data.
export function xdccParserDataUrl(html: string, pageUrl: string): string | null {
  const base = /\bp\.init\(\s*['"]([^'"]+)['"]/.exec(html)?.[1];
  if (!base) return null;
  try {
    const page = new URL(pageUrl);
    const query = (name: string) => page.searchParams.get(name);
    const term = query('search') ?? query('t') ?? query('');
    const nick = query('nick');
    const params = nick ? `nick=${encodeURIComponent(nick)}` : term ? `t=${encodeURIComponent(term)}` : null;
    return params ? `${new URL('search.php', new URL(base, page)).href}?${params}` : null;
  } catch {
    return null;
  }
}

const PACK_ROW_RE =
  /p\.k\[\d+\]\s*=\s*\{\s*b:\s*("(?:[^"\\]|\\.)*")\s*,\s*n:\s*(\d+)\s*,[^}]*?\bf:\s*("(?:[^"\\]|\\.)*")/g;

export function parsePackData(data: string): PackRequest[] {
  const seen = new Set<string>();
  const found: PackRequest[] = [];
  for (const m of data.matchAll(PACK_ROW_RE)) {
    try {
      const bot: string = JSON.parse(m[1]);
      const pack = Number(m[2]);
      const key = `${bot.toLowerCase()}\0${pack}`;
      if (!bot || pack < 1 || seen.has(key)) continue;
      seen.add(key);
      found.push({ bot, pack, name: JSON.parse(m[3]) });
    } catch {}
  }
  return found;
}

export function packSource(html: string): PackSource | null {
  const m = /\birc(?:s)?:\/\/([^/\s"'<>:?#]+)(?::\d+)?\/?([^\s"'<>?]*)/i.exec(html);
  if (!m) return null;
  const target = m[2].split(',')[0];
  return { host: m[1].toLowerCase(), channel: target ? (/^[#&]/.test(target) ? target : `#${target}`) : undefined };
}

// shortcut: two hosts are one network when their last two labels agree (irc.eu.rizon.net, irc.rizon.net);
// a multi-part suffix like .co.uk would need a public-suffix list.
export function sameNetwork(a: string, b: string): boolean {
  const base = (h: string) => h.toLowerCase().split('.').slice(-2).join('.');
  return base(a) === base(b);
}

/** A page that cannot be turned into requests; the message says why and is meant to be shown as is. */
export class PackListError extends Error {}

// The requests a packlist link leads to: written out on the page, or else rebuilt from the page's own data.
// Each thing the rebuilding needs is checked, so a page that does not fit says which one is missing.
export async function loadPackRequests(link: string, fetchPage: (url: string) => Promise<string>) {
  const html = await fetchPage(link);
  const source = packSource(html);
  const written = extractPackRequests(html);
  if (written.length > 0) return { requests: written, source };
  if (!/\bp\.init\(/.test(html)) {
    throw new PackListError(
      'That page has no "/msg Bot xdcc send #N" lines, and it is not an XDCC Parser packlist that I can rebuild them from.',
    );
  }
  const dataUrl = xdccParserDataUrl(html, link);
  if (!dataUrl) {
    throw new PackListError(
      'This is an XDCC Parser packlist, but the link names no search or bot (like ?search=… or ?nick=…), so there are no rows to read. Search on the page, then use the link it ends up with.',
    );
  }
  const data = await fetchPage(dataUrl);
  const rows = parsePackData(data);
  if (rows.length > 0) return { requests: rows, source };
  throw new PackListError(
    data.includes('p.k[')
      ? 'The packlist answered, but its rows have no bot, pack number and file name that I can read.'
      : 'The search on that packlist found no packs.',
  );
}

// The number a file name carries, such as the episode: S01E05, E05, " - 12", or the last bare number.
// Years, resolutions and bracketed tags are not numbers in this sense.
export function fileNumber(name: string | undefined): number | null {
  if (!name) return null;
  const base = name
    .replace(/\.[a-z0-9]{2,4}$/i, '')
    .replace(/\[[^\]]*\]|\([^)]*\)/g, ' ')
    .trim();
  const hit =
    /\bS\d+\s*E(\d+)/i.exec(base) ?? /\bE(?:P|pisode)?\s*(\d+)\b/i.exec(base) ?? /\s-\s*(\d+)(?:v\d)?\b/.exec(base);
  if (hit) return Number(hit[1]);
  const bare = base
    .split(/[\s._]+/)
    .map((t) => /^(\d+)(?:v\d)?$/.exec(t)?.[1])
    .filter((n): n is string => !!n && !/^(?:19|20)\d\d$/.test(n));
  return bare.length ? Number(bare[bare.length - 1]) : null;
}

const sameFile = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

// A file offered by several bots is requested once. The bot that offers the most of the wanted files is
// taken first and keeps every file it has, so the downloads come from as few bots as possible and, where a
// file could come from anyone, from the bot that already serves the rest. Requests with no file name cannot
// be compared and are all kept.
export function pickOnePeerPerFile(requests: PackRequest[]): PackRequest[] {
  const kept = requests.filter((r) => !r.name);
  const wanted = new Map<string, PackRequest[]>();
  for (const r of requests) {
    if (r.name) wanted.set(sameFile(r.name), [...(wanted.get(sameFile(r.name)) ?? []), r]);
  }
  while (wanted.size > 0) {
    const offers = new Map<string, Map<string, PackRequest>>();
    for (const [file, from] of wanted) {
      for (const r of from) {
        const bot = r.bot.toLowerCase();
        if (!offers.get(bot)?.has(file)) offers.set(bot, (offers.get(bot) ?? new Map()).set(file, r));
      }
    }
    let best: Map<string, PackRequest> | undefined;
    for (const files of offers.values()) if (!best || files.size > best.size) best = files;
    for (const [file, r] of best ?? []) {
      kept.push(r);
      wanted.delete(file);
    }
  }
  return kept;
}

// 1,2,3,7 -> "1-3,7"
function packSpec(packs: number[]): string {
  const parts: string[] = [];
  for (let i = 0; i < packs.length; ) {
    let j = i;
    while (packs[j + 1] === packs[j] + 1) j++;
    parts.push(j > i ? `${packs[i]}-${packs[j]}` : String(packs[i]));
    i = j + 1;
  }
  return parts.join(',');
}

const MAX_SPEC_LENGTH = 300;

// One "xdcc batch" per bot, so the bot queues the packs itself and nobody is flooded with requests.
// A bot with more packs than fit in one line gets a few batches.
export function toBatches(requests: PackRequest[]): PackBatch[] {
  const byBot = new Map<string, { bot: string; packs: number[] }>();
  for (const r of requests) {
    const entry = byBot.get(r.bot.toLowerCase()) ?? { bot: r.bot, packs: [] };
    entry.packs.push(r.pack);
    byBot.set(r.bot.toLowerCase(), entry);
  }
  const batches: PackBatch[] = [];
  for (const { bot, packs } of byBot.values()) {
    const sorted = [...new Set(packs)].sort((a, b) => a - b);
    let chunk: number[] = [];
    for (const pack of sorted) {
      if (chunk.length && packSpec([...chunk, pack]).length > MAX_SPEC_LENGTH) {
        batches.push({ bot, spec: packSpec(chunk), count: chunk.length });
        chunk = [];
      }
      chunk.push(pack);
    }
    batches.push({ bot, spec: packSpec(chunk), count: chunk.length });
  }
  return batches;
}
