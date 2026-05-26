/// <reference types="vite/client" />

import type { IrcApi } from '../../shared/ipc';

declare global {
  interface Window {
    irc: IrcApi;
  }
}

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
