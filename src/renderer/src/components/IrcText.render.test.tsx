import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IrcText, parseIrcFormatting } from './IrcText';

afterEach(() => {
  delete (window as unknown as { irc?: unknown }).irc;
});

describe('IrcText', () => {
  it('opens a link through the app, never by navigating the window', () => {
    const openExternal = vi.fn();
    (window as unknown as { irc: unknown }).irc = { openExternal };
    render(<IrcText text="see https://example.org/page now" />);
    const link = screen.getByRole('link', { name: 'https://example.org/page' });
    const notPrevented = fireEvent.click(link);
    expect(notPrevented).toBe(false); // default prevented
    expect(openExternal).toHaveBeenCalledWith('https://example.org/page');
  });

  it('keeps the surrounding text and applies formatting', () => {
    render(<IrcText text={'\x02bold\x02 plain \x1Fline\x1F'} />);
    expect(screen.getByText('bold').style.fontWeight).toBe('bold');
    expect(screen.getByText('line').style.textDecoration).toBe('underline');
    expect(screen.getByText('plain').style.fontWeight).toBe('');
  });

  it('colours text with an mIRC colour code', () => {
    render(<IrcText text={'\x034red text'} />);
    expect(screen.getByText('red text').style.color).not.toBe('');
  });

  it('resets a hex colour code that carries no colour instead of swallowing text', () => {
    const chunks = parseIrcFormatting('\x04zz after');
    expect(chunks.map((c) => c.text).join('')).toContain('after');
    expect(chunks.every((c) => c.hexFg === null)).toBe(true);
  });
});
