const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/g;

const TRAILING_PUNCT_RE = /[.,!?;:]+$/;

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
  '#FFFFFF',
  '#000000',
  '#00007F',
  '#009300',
  '#FF0000',
  '#7F0000',
  '#9C009C',
  '#FC7F00',
  '#FFFF00',
  '#00FC00',
  '#009393',
  '#00FFFF',
  '#0000FC',
  '#FF00FF',
  '#7F7F7F',
  '#D2D2D2',
  '#470000',
  '#472100',
  '#474700',
  '#324700',
  '#004700',
  '#00472C',
  '#004747',
  '#002747',
  '#000047',
  '#2E0047',
  '#470047',
  '#47002A',
  '#740000',
  '#743A00',
  '#747400',
  '#517400',
  '#007400',
  '#007449',
  '#007474',
  '#004074',
  '#000074',
  '#4B0074',
  '#740074',
  '#740045',
  '#B50000',
  '#B56300',
  '#B5B500',
  '#7DB500',
  '#00B500',
  '#00B571',
  '#00B5B5',
  '#0063B5',
  '#0000B5',
  '#7500B5',
  '#B500B5',
  '#B5006B',
  '#FF0000',
  '#FF8C00',
  '#FFFF00',
  '#B2FF00',
  '#00FF00',
  '#00FFA0',
  '#00FFFF',
  '#008CFF',
  '#0000FF',
  '#A500FF',
  '#FF00FF',
  '#FF0098',
  '#FF5959',
  '#FFB459',
  '#FFFF71',
  '#CFFF60',
  '#6FFF6F',
  '#65FFC9',
  '#6DFFFF',
  '#59B4FF',
  '#5959FF',
  '#C459FF',
  '#FF66FF',
  '#FF59BC',
  '#FF9C9C',
  '#FFD39C',
  '#FFFF9C',
  '#E2FF9C',
  '#9CFF9C',
  '#9CFFDB',
  '#9CFFFF',
  '#9CD3FF',
  '#9C9CFF',
  '#DC9CFF',
  '#FF9CFF',
  '#FF94D3',
  '#000000',
  '#131313',
  '#282828',
  '#363636',
  '#4D4D4D',
  '#656565',
  '#818181',
  '#9F9F9F',
  '#BCBCBC',
  '#E2E2E2',
  '#FFFFFF',
];

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
  reverse: boolean;
  fg: number | null;
  bg: number | null;
  hexFg: string | null;
  hexBg: string | null;
};

type Style = Omit<FormatChunk, 'text'>;

function emptyStyle(): Style {
  return {
    bold: false,
    italic: false,
    underline: false,
    strikethrough: false,
    monospace: false,
    reverse: false,
    fg: null,
    bg: null,
    hexFg: null,
    hexBg: null,
  };
}

function readDigits(chars: string[], i: number, max: number): { value: number; length: number } | null {
  let s = '';
  while (s.length < max && chars[i + s.length] >= '0' && chars[i + s.length] <= '9') s += chars[i + s.length];
  return s.length > 0 ? { value: Number(s), length: s.length } : null;
}

function readHex6(chars: string[], i: number): string | null {
  const s = chars.slice(i, i + 6).join('');
  return /^[0-9a-fA-F]{6}$/.test(s) ? s.toLowerCase() : null;
}

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
      case BOLD:
        push({ ...style, bold: !style.bold });
        break;
      case ITALIC:
        push({ ...style, italic: !style.italic });
        break;
      case UNDERLINE:
        push({ ...style, underline: !style.underline });
        break;
      case STRIKETHROUGH:
        push({ ...style, strikethrough: !style.strikethrough });
        break;
      case MONOSPACE:
        push({ ...style, monospace: !style.monospace });
        break;
      case REVERSE:
        push({ ...style, reverse: !style.reverse });
        break;
      case RESET:
        push(emptyStyle());
        break;
      case COLOR: {
        const parsed = readColor(chars, i + 1);
        if (!parsed) {
          push({ ...style, fg: null, bg: null, hexFg: null, hexBg: null });
          break;
        }
        push({
          ...style,
          fg: normalizeColor(parsed.fg),
          hexFg: null,
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
          hexFg: parsed.fg,
          fg: null,
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
                    onClick={(e) => {
                      e.preventDefault();
                      window.irc.openExternal(part.url);
                    }}
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
