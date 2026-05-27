// Ambient module declaration for irc-caret-notation (no bundled .d.ts).
// Must be a script-context .d.ts (no top-level imports) for ambient declarations to work.
declare module 'irc-caret-notation' {
  export interface Chunk {
    text: string;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    fg: number | null;
    bg: number | null;
  }
  export function parse(input: string): Chunk[];
}
