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

// The standard 16-color mIRC palette (modern.ircdocs.horse/formatting.html)
// - codes 16-98 are an extended palette some newer clients also support, but
// the spec itself calls that range "not universally supported" and there's
// no single canonical source for it, so it's left unimplemented here rather
// than guessed at (an extended-range code just renders with no color, same
// as an out-of-range index always has).
const IRC_COLORS: string[] = [
  '#FFFFFF', // 0  white
  '#000000', // 1  black
  '#00007F', // 2  navy / blue
  '#009300', // 3  green
  '#FF0000', // 4  red
  '#7F0000', // 5  maroon / brown
  '#9C009C', // 6  purple / magenta
  '#FC7F00', // 7  olive / orange
  '#FFFF00', // 8  yellow
  '#00FC00', // 9  lime / light green
  '#009393', // 10 teal / cyan
  '#00FFFF', // 11 cyan / light cyan
  '#0000FC', // 12 royal blue / light blue
  '#FF00FF', // 13 fuchsia / pink
  '#7F7F7F', // 14 grey
  '#D2D2D2', // 15 silver / light grey
];

// IRC formatting control bytes (modern.ircdocs.horse/formatting.html).
// Hand-rolled rather than using a library (this replaced irc-caret-notation,
// which had real gaps against that spec: no cap on color-code digit count -
// "\x03123abc" should parse as fg 12 + literal "3abc", not fg 123 - no idea
// at all about strikethrough/monospace/hex-color (those control bytes just
// leaked into the rendered text), and modeled reverse-video as a one-shot
// fg/bg copy-and-swap rather than a real toggle, so colors set *after*
// reversing and then un-reversing came out wrong).
const BOLD = '\x02';
const ITALIC = '\x1D';
const UNDERLINE = '\x1F';
const STRIKETHROUGH = '\x1E';
const MONOSPACE = '\x11';
const COLOR = '\x03';
const HEX_COLOR = '\x04';
const REVERSE = '\x16';
const RESET = '\x0F';

export type FormatChunk = {
  text: string;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  monospace: boolean;
  // A live toggle (see REVERSE's case below), not a snapshot - resolved
  // against whatever fg/bg are in effect at render time (resolveIrcColors),
  // so it stays correct across a later color change or a second \x16.
  reverse: boolean;
  // \x03 (numeric, 0-15 render; higher just shows no color, see IRC_COLORS)
  // and \x04 (hex) both set "the current foreground/background", just via a
  // different encoding - using one clears the other, so at most one of
  // fg/hexFg (and bg/hexBg) is ever set. mIRC's color 99 ("default") isn't
  // stored as its own state: it renders identically to unset (the ambient
  // text/background color), so it's normalized to null immediately.
  fg: number | null;
  bg: number | null;
  hexFg: string | null;
  hexBg: string | null;
};

type Style = Omit<FormatChunk, 'text'>;

function emptyStyle(): Style {
  return {
    bold: false, italic: false, underline: false, strikethrough: false, monospace: false, reverse: false,
    fg: null, bg: null, hexFg: null, hexBg: null,
  };
}

// Reads up to `max` consecutive ASCII digits starting at chars[i] - a real
// color code caps its fg/bg components at 2 digits each; a 3rd digit is
// literal text ("\x03123abc" is fg 12, then "3abc").
function readDigits(chars: string[], i: number, max: number): { value: number; length: number } | null {
  let s = '';
  while (s.length < max && chars[i + s.length] >= '0' && chars[i + s.length] <= '9') s += chars[i + s.length];
  return s.length > 0 ? { value: Number(s), length: s.length } : null;
}

function readHex6(chars: string[], i: number): string | null {
  const s = chars.slice(i, i + 6).join('');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

// Parses "<fg>[,<bg>]" right after a \x03 byte. null means the code was
// malformed (no fg digit at all) - the caller treats that as "clear color",
// same as every real client does for a bare/invalid \x03.
function readColor(chars: string[], i: number): { fg: number; bg: number | undefined; length: number } | null {
  const fgDigits = readDigits(chars, i, 2);
  if (!fgDigits) return null;
  let length = fgDigits.length;
  let bg: number | undefined;
  if (chars[i + length] === ',') {
    const bgDigits = readDigits(chars, i + length + 1, 2);
    if (bgDigits) {
      bg = bgDigits.value;
      length += 1 + bgDigits.length;
    }
  }
  return { fg: fgDigits.value, bg, length };
}

// Parses "<RRGGBB>[,<RRGGBB>]" right after a \x04 byte.
function readHexColor(chars: string[], i: number): { fg: string; bg: string | undefined; length: number } | null {
  const fg = readHex6(chars, i);
  if (!fg) return null;
  let length = 6;
  let bg: string | undefined;
  if (chars[i + length] === ',') {
    const bgHex = readHex6(chars, i + length + 1);
    if (bgHex) {
      bg = bgHex;
      length += 7;
    }
  }
  return { fg, bg, length };
}

// Normalizes mIRC's color 99 ("default") to null - see FormatChunk's doc.
function normalizeColor(value: number): number | null {
  return value === 99 ? null : value;
}

export function parseIrcFormatting(text: string): FormatChunk[] {
  const chars = [...text];
  let style = emptyStyle();
  const chunks: FormatChunk[] = [{ ...style, text: '' }];

  function push(next: Style) {
    style = next;
    chunks.push({ ...style, text: '' });
  }

  for (let i = 0; i < chars.length; i++) {
    const ch = chars[i];
    switch (ch) {
      case BOLD: push({ ...style, bold: !style.bold }); break;
      case ITALIC: push({ ...style, italic: !style.italic }); break;
      case UNDERLINE: push({ ...style, underline: !style.underline }); break;
      case STRIKETHROUGH: push({ ...style, strikethrough: !style.strikethrough }); break;
      case MONOSPACE: push({ ...style, monospace: !style.monospace }); break;
      case REVERSE: push({ ...style, reverse: !style.reverse }); break;
      case RESET: push(emptyStyle()); break;
      case COLOR: {
        const parsed = readColor(chars, i + 1);
        if (!parsed) {
          push({ ...style, fg: null, bg: null, hexFg: null, hexBg: null });
          break;
        }
        push({
          ...style,
          fg: normalizeColor(parsed.fg), hexFg: null,
          ...(parsed.bg !== undefined ? { bg: normalizeColor(parsed.bg), hexBg: null } : {}),
        });
        i += parsed.length;
        break;
      }
      case HEX_COLOR: {
        const parsed = readHexColor(chars, i + 1);
        if (!parsed) {
          push({ ...style, fg: null, bg: null, hexFg: null, hexBg: null });
          break;
        }
        push({
          ...style,
          hexFg: parsed.fg, fg: null,
          ...(parsed.bg !== undefined ? { hexBg: parsed.bg, bg: null } : {}),
        });
        i += parsed.length;
        break;
      }
      default:
        chunks[chunks.length - 1].text += ch;
        break;
    }
  }

  return chunks.filter((c) => c.text.length > 0);
}

function paletteColor(index: number | null): string | undefined {
  return index != null ? IRC_COLORS[index] : undefined;
}

// Resolves a chunk's color fields into actual CSS values, applying `reverse`
// last - swapping whatever fg/bg (explicit, or the theme's own ambient
// default when neither was ever set) are in effect at this point, rather
// than a value baked in back when \x16 was seen.
export function resolveIrcColors(chunk: FormatChunk): { color?: string; backgroundColor?: string } {
  const fg = chunk.hexFg ? `#${chunk.hexFg}` : paletteColor(chunk.fg);
  const bg = chunk.hexBg ? `#${chunk.hexBg}` : paletteColor(chunk.bg);
  if (!chunk.reverse) return { color: fg, backgroundColor: bg };
  return { color: bg ?? 'var(--dolq-bg)', backgroundColor: fg ?? 'var(--dolq-text)' };
}

export function IrcText({ text }: { text: string }) {
  try {
    const chunks = parseIrcFormatting(text);
    return (
      <span>
        {chunks.map((chunk, i) => {
          const { color, backgroundColor } = resolveIrcColors(chunk);
          const textDecoration = [chunk.underline && 'underline', chunk.strikethrough && 'line-through']
            .filter(Boolean)
            .join(' ');
          return (
            <span
              key={i}
              style={{
                fontWeight: chunk.bold ? 'bold' : undefined,
                fontStyle: chunk.italic ? 'italic' : undefined,
                textDecoration: textDecoration || undefined,
                fontFamily: chunk.monospace ? 'monospace' : undefined,
                color,
                backgroundColor,
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
          );
        })}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}
