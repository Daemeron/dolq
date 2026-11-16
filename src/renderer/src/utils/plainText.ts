import { parseIrcFormatting } from '../components/IrcText';

/** A line as it reads, without its bold, italic and colour codes. */
export const plainText = (text: string) =>
  parseIrcFormatting(text)
    .map((chunk) => chunk.text)
    .join('');
