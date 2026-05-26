import { parse } from 'irc-caret-notation';

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
            {chunk.text}
          </span>
        ))}
      </span>
    );
  } catch {
    return <span>{text}</span>;
  }
}
