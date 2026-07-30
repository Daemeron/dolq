import { parse } from 'irc-caret-notation';

// http(s) only, deliberately - see window.irc.openExternal's doc for why.
// Stops at whitespace or a handful of characters that are almost never
// actually part of a URL (angle brackets, quotes, a closing paren/bracket
// with no matching open one).
const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;

// Sentence punctuation glued to the very end of a match is essentially
// never actually part of the URL ("see https://example.com." shouldn't
// treat the period as part of the link) - trimmed off after matching,
// since it's still a valid mid-URL character and can't just be excluded
// from URL_RE itself (that'd break "example.co.uk").
const TRAILING_PUNCT_RE = /[.,!?;:]+$/;

// Splits text into plain strings and matched URLs, in order - a chunk's
// text (see below) can be a mix of both.
export function splitLinks(text: string): (string | { url: string })[] {
  const parts: (string | { url: string })[] = [];
  let lastIndex = 0;
  for (const m of text.matchAll(URL_RE)) {
    let url = m[0];
    let end = m.index + url.length;
    const trailing = url.match(TRAILING_PUNCT_RE);
    if (trailing) {
      url = url.slice(0, -trailing[0].length);
      end -= trailing[0].length;
    }
    if (m.index > lastIndex) parts.push(text.slice(lastIndex, m.index));
    parts.push({ url });
    lastIndex = end;
  }
  if (lastIndex < text.length) parts.push(text.slice(lastIndex));
  return parts;
}

const IRC_COLORS: string[] = [
  '#FFFFFF', // 0  white
  '#000000', // 1  black
  '#00007F', // 2  navy
  '#009300', // 3  green
  '#FF0000', // 4  red
  '#7F0000', // 5  maroon
  '#9C009C', // 6  purple
  '#FC7F00', // 7  olive
  '#FFFF00', // 8  yellow
  '#00FC00', // 9  lime
  '#009393', // 10 teal
  '#00FFFF', // 11 cyan
  '#0000FC', // 12 royal blue
  '#FF00FF', // 13 fuchsia
  '#7F7F7F', // 14 grey
  '#D2D2D2', // 15 silver
];

export function IrcText({ text }: { text: string }) {
  try {
    const chunks = parse(text);
    return (
      <span>
        {chunks.map((chunk, i) => (
          <span
            key={i}
            style={{
              fontWeight:      chunk.bold      ? 'bold'      : undefined,
              fontStyle:       chunk.italic    ? 'italic'    : undefined,
              textDecoration:  chunk.underline ? 'underline' : undefined,
              color:           chunk.fg != null ? IRC_COLORS[chunk.fg] : undefined,
              backgroundColor: chunk.bg != null ? IRC_COLORS[chunk.bg] : undefined,
            }}
          >
            {splitLinks(chunk.text).map((part, j) =>
              typeof part === 'string' ? (
                part
              ) : (
                <a
                  key={j}
                  onClick={(e) => { e.preventDefault(); window.irc.openExternal(part.url); }}
                  href={part.url}
                  className="text-[#82aaff] underline cursor-pointer hover:text-[#a0c0ff]"
                >
                  {part.url}
                </a>
              ),
            )}
          </span>
        ))}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}
