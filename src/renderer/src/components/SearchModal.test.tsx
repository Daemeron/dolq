import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HistoryEntry } from '../../../shared/ipc';
import { SearchModal } from './SearchModal';

const entry = (id: number, extra: Partial<HistoryEntry>): HistoryEntry =>
  ({ id, serverId: 's1', channel: '#dolq', timestamp: 0, ...extra }) as HistoryEntry;

function setup(found: HistoryEntry[] | Error) {
  const search = vi.fn(() => (found instanceof Error ? Promise.reject(found) : Promise.resolve(found)));
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  (window as any).irc = { search };
  const props = {
    servers: [{ id: 's1', name: 'Libera' }] as never,
    defaultServerId: 's1',
    defaultChannel: '#dolq',
    defaultChannelLabel: '#dolq',
    onJump: vi.fn(),
    onGetPack: vi.fn(),
    onClose: vi.fn(),
  };
  render(<SearchModal {...props} />);
  const run = (q: string) => {
    fireEvent.change(screen.getByPlaceholderText('Search for...'), { target: { value: q } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
  };
  return { ...props, search, run };
}

afterEach(() => {
  // biome-ignore lint/suspicious/noExplicitAny: test stub
  delete (window as any).irc;
});

describe('SearchModal', () => {
  it('does not search for a blank query', () => {
    const { search, run } = setup([]);
    run('   ');
    expect(search).not.toHaveBeenCalled();
  });

  it('searches the current channel by default and jumps to a clicked result', async () => {
    const message = entry(1, { event: { type: 'PRIVMSG', nick: 'mira', text: 'hello release' } as never });
    const { search, run, onJump } = setup([message]);
    run(' release ');
    const result = await screen.findByRole('button', { name: /hello release/ });
    expect(search).toHaveBeenCalledWith('s1', '#dolq', 'release', 100);
    expect(screen.getByText(/Libera \/ #dolq/)).toBeTruthy();
    expect(screen.getByText('#dolq · 1 result')).toBeTruthy();
    // the searched word is marked inside the line
    expect(screen.getByText('release', { selector: 'mark' })).toBeTruthy();
    fireEvent.click(result);
    expect(onJump).toHaveBeenCalledWith('s1', '#dolq');
  });

  it('searches everywhere when asked', async () => {
    const { search, run } = setup([]);
    fireEvent.click(screen.getByRole('radio', { name: 'Everywhere' }));
    run('x');
    await screen.findByText('No matches.');
    expect(search).toHaveBeenCalledWith('', '', 'x', 100);
  });

  it('searches one whole server, and searches again when the scope changes under a result', async () => {
    const { search, run } = setup([entry(1, { event: { type: 'PRIVMSG', nick: 'mira', text: 'hello' } as never })]);
    fireEvent.click(screen.getByRole('radio', { name: 'This server' }));
    run('hello');
    await screen.findByText('Libera · 1 result');
    expect(search).toHaveBeenLastCalledWith('s1', '', 'hello', 100);
    fireEvent.click(screen.getByRole('radio', { name: 'This channel' }));
    await waitFor(() => expect(search).toHaveBeenLastCalledWith('s1', '#dolq', 'hello', 100));
  });

  it('keeps only pack lines for a packs-only search and requests a pack on click', async () => {
    const pack = entry(2, {
      event: { type: 'XDCCPACK', nick: 'bot', number: 7, gets: 3, size: '1G', filename: 'f.iso' } as never,
    });
    const chat = entry(3, { event: { type: 'PRIVMSG', nick: 'mira', text: 'chatter' } as never });
    const { search, run, onGetPack } = setup([pack, chat]);
    fireEvent.click(screen.getByLabelText(/Packs only/));
    run('iso');
    await screen.findByText(/#7 · 3x sent/);
    expect(search).toHaveBeenCalledWith('s1', '#dolq', 'iso', 300);
    expect(screen.queryByText('chatter')).toBeNull();
    fireEvent.click(screen.getByTitle('Click to request this pack'));
    expect(onGetPack).toHaveBeenCalledWith('s1', 'bot', 7);
  });

  it('labels raw log lines and unknown servers', async () => {
    const raw = entry(4, { isRaw: true, line: ':srv 001 hi', serverId: 'gone', channel: '__log__' });
    const { run } = setup([raw]);
    run('hi');
    await screen.findByRole('button', { name: /:srv 001 hi/ });
    expect(screen.getByText(/gone \/ Log/)).toBeTruthy();
  });

  it('shows other kinds of events as their raw data', async () => {
    const { run } = setup([entry(5, { event: { type: 'JOIN', nick: 'tomas', channel: '#dolq' } as never })]);
    run('tomas');
    expect(await screen.findByText(/"type":"JOIN"/)).toBeTruthy();
  });

  it('shows no matches when the search fails', async () => {
    const { run } = setup(new Error('backend down'));
    run('x');
    expect(await screen.findByText('No matches.')).toBeTruthy();
  });

  it('closes on Escape, the backdrop and the Close button', async () => {
    const { onClose } = setup([]);
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('presentation'));
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(3));
  });
});
