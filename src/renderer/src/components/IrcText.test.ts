import { describe, it, expect } from 'vitest';
import { splitLinks, parseIrcFormatting, resolveIrcColors, type FormatChunk } from './IrcText';

const B = '\x02'; // bold
const I = '\x1D'; // italic
const U = '\x1F'; // underline
const S = '\x1E'; // strikethrough
const M = '\x11'; // monospace
const C = '\x03'; // color
const H = '\x04'; // hex color
const R = '\x16'; // reverse
const O = '\x0F'; // reset

// Only the fields a given test actually cares about - parseIrcFormatting's
// full FormatChunk has ~9 boolean/color fields per chunk, spelling all of
// them out in every expectation would bury the one or two that matter.
function texts(chunks: FormatChunk[]): string[] {
  return chunks.map((c) => c.text);
}

describe('splitLinks', () => {
  it('returns the whole string unchanged when there is no URL', () => {
    expect(splitLinks('hello there')).toEqual(['hello there']);
  });

  it('extracts a URL that is the entire text', () => {
    expect(splitLinks('https://example.com')).toEqual([{ url: 'https://example.com' }]);
  });

  it('extracts a URL in the middle of a sentence, with text on both sides', () => {
    expect(splitLinks('see https://example.com for details')).toEqual([
      'see ',
      { url: 'https://example.com' },
      ' for details',
    ]);
  });

  it('does not swallow trailing sentence punctuation', () => {
    expect(splitLinks('check out https://example.com.')).toEqual([
      'check out ',
      { url: 'https://example.com' },
      '.',
    ]);
  });

  it('matches http as well as https', () => {
    expect(splitLinks('http://example.com')).toEqual([{ url: 'http://example.com' }]);
  });

  it('extracts multiple URLs from the same text', () => {
    expect(splitLinks('https://a.example and https://b.example')).toEqual([
      { url: 'https://a.example' },
      ' and ',
      { url: 'https://b.example' },
    ]);
  });

  it('ignores a non-http(s) scheme entirely', () => {
    expect(splitLinks('run javascript:alert(1) please')).toEqual(['run javascript:alert(1) please']);
  });
});

describe('parseIrcFormatting', () => {
  it('returns plain text as a single unstyled chunk', () => {
    const [chunk] = parseIrcFormatting('hello there');
    expect(chunk).toMatchObject({ text: 'hello there', bold: false, fg: null });
  });

  it('toggles bold on and back off', () => {
    const chunks = parseIrcFormatting(`plain ${B}bold${B} plain`);
    expect(texts(chunks)).toEqual(['plain ', 'bold', ' plain']);
    expect(chunks.map((c) => c.bold)).toEqual([false, true, false]);
  });

  it('toggles italic, underline, strikethrough and monospace independently', () => {
    const [chunk] = parseIrcFormatting(`${I}${U}${S}${M}all four`);
    expect(chunk).toMatchObject({ italic: true, underline: true, strikethrough: true, monospace: true });
  });

  it('parses a foreground-only color code', () => {
    const chunks = parseIrcFormatting(`${C}4red`);
    expect(chunks).toEqual([{ text: 'red', ...restyled({ fg: 4 }) }]);
  });

  it('parses a foreground,background color code', () => {
    const [chunk] = parseIrcFormatting(`${C}4,8text`);
    expect(chunk).toMatchObject({ text: 'text', fg: 4, bg: 8 });
  });

  it('caps each color component at 2 digits - a 3rd digit is literal text', () => {
    const [chunk] = parseIrcFormatting(`${C}123abc`);
    expect(chunk).toMatchObject({ text: '3abc', fg: 12 });
  });

  it('leaves background untouched when only foreground is given', () => {
    const [chunk] = parseIrcFormatting(`${C}4,8${C}2only-fg-changes`);
    expect(chunk).toMatchObject({ fg: 2, bg: 8 });
  });

  it('normalizes color 99 ("default") to unset', () => {
    const [chunk] = parseIrcFormatting(`${C}99text`);
    expect(chunk).toMatchObject({ text: 'text', fg: null });
  });

  it('treats a bare/invalid color code as "clear color"', () => {
    const [chunk] = parseIrcFormatting(`${C}4${C}xnope`);
    expect(chunk).toMatchObject({ text: 'xnope', fg: null, bg: null });
  });

  it('parses a hex foreground color', () => {
    const [chunk] = parseIrcFormatting(`${H}ff0000red`);
    expect(chunk).toMatchObject({ text: 'red', hexFg: 'ff0000', fg: null });
  });

  it('parses a hex foreground,background color', () => {
    const [chunk] = parseIrcFormatting(`${H}ff0000,00ff00text`);
    expect(chunk).toMatchObject({ hexFg: 'ff0000', hexBg: '00ff00' });
  });

  it('setting a numeric color clears a previous hex one, and vice versa', () => {
    const [chunk] = parseIrcFormatting(`${H}ff0000${C}4text`);
    expect(chunk).toMatchObject({ fg: 4, hexFg: null });
  });

  it('resets everything on \\x0F, including color and reverse', () => {
    const chunks = parseIrcFormatting(`${B}${C}4${R}bold${O}plain`);
    expect(chunks[0]).toMatchObject({ text: 'bold', bold: true, fg: 4, reverse: true });
    expect(chunks[1]).toMatchObject({ text: 'plain', bold: false, fg: null, reverse: false });
  });

  it('reverse is a real toggle, not a one-shot swap', () => {
    const chunks = parseIrcFormatting(`${R}rev${R}normal`);
    expect(chunks.map((c) => c.reverse)).toEqual([true, false]);
  });
});

describe('resolveIrcColors', () => {
  function chunk(overrides: Partial<FormatChunk>): FormatChunk {
    return {
      text: '', bold: false, italic: false, underline: false, strikethrough: false, monospace: false,
      reverse: false, fg: null, bg: null, hexFg: null, hexBg: null, ...overrides,
    };
  }

  it('resolves a plain numeric color', () => {
    expect(resolveIrcColors(chunk({ fg: 4 }))).toEqual({ color: '#FF0000', backgroundColor: undefined });
  });

  it('resolves a hex color over a numeric one', () => {
    expect(resolveIrcColors(chunk({ hexFg: 'abcdef' }))).toEqual({ color: '#abcdef', backgroundColor: undefined });
  });

  it('swaps fg/bg when reversed', () => {
    expect(resolveIrcColors(chunk({ fg: 4, bg: 8, reverse: true }))).toEqual({
      color: '#FFFF00', backgroundColor: '#FF0000',
    });
  });

  it('reverse with no explicit colors swaps the theme defaults', () => {
    expect(resolveIrcColors(chunk({ reverse: true }))).toEqual({
      color: 'var(--dolq-bg)', backgroundColor: 'var(--dolq-text)',
    });
  });

  // Spot-checks against the extended 16-98 palette (modern.ircdocs.horse) -
  // boundary values, not all 83, since these are just table lookups with no
  // branching logic of their own to actually exercise.
  it.each([
    [16, '#470000'],
    [63, '#FF0098'],
    [88, '#000000'],
    [98, '#FFFFFF'],
  ])('resolves extended color %i to %s', (index, hex) => {
    expect(resolveIrcColors(chunk({ fg: index }))).toEqual({ color: hex, backgroundColor: undefined });
  });
});

// Shorthand for the common "just a color, nothing else set" shape the color
// parsing tests above assert against.
function restyled(overrides: Partial<FormatChunk>): Omit<FormatChunk, 'text'> {
  return {
    bold: false, italic: false, underline: false, strikethrough: false, monospace: false,
    reverse: false, fg: null, bg: null, hexFg: null, hexBg: null, ...overrides,
  };
}
