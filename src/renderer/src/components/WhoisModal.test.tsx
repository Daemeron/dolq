import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IrcEvent } from '../../../shared/ipc';
import { WhoisModal } from './WhoisModal';

type Whois = Extract<IrcEvent, { type: 'whois' }>;
const whois = (extra: Partial<Whois>): Whois => ({ type: 'whois', nick: 'mira', ...extra }) as Whois;

describe('WhoisModal', () => {
  it('shows a lookup placeholder until the result arrives', () => {
    render(<WhoisModal nick="mira" result={null} onClose={() => {}} />);
    expect(screen.getByText('Looking up...')).toBeTruthy();
  });

  it('explains a nick that no longer exists', () => {
    render(<WhoisModal nick="mira" result={whois({ noSuchNick: true })} onClose={() => {}} />);
    expect(screen.getByText(/No such nick/)).toBeTruthy();
  });

  it('lists the details that are present and formats idle time', () => {
    render(
      <WhoisModal
        nick="mira"
        result={whois({
          user: 'mira',
          host: 'example.org',
          realname: 'Mira O',
          account: 'miraacct',
          server: 'irc.libera.chat',
          channels: ['#a', '#b'],
          idleSeconds: 3725,
          away: 'lunch',
        })}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText('mira@example.org')).toBeTruthy();
    expect(screen.getByText('Mira O')).toBeTruthy();
    expect(screen.getByText('miraacct')).toBeTruthy();
    expect(screen.getByText('irc.libera.chat')).toBeTruthy();
    expect(screen.getByText('#a, #b')).toBeTruthy();
    expect(screen.getByText('01:02:05')).toBeTruthy();
    expect(screen.getByText('lunch')).toBeTruthy();
  });

  it('leaves out rows the server did not send', () => {
    render(<WhoisModal nick="mira" result={whois({ user: 'mira', host: 'h' })} onClose={() => {}} />);
    expect(screen.queryByText('Idle')).toBeNull();
    expect(screen.queryByText('Away')).toBeNull();
    expect(screen.queryByText('Channels')).toBeNull();
  });

  it('closes from the button, Escape or the backdrop', () => {
    const onClose = vi.fn();
    render(<WhoisModal nick="mira" result={null} onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(3);
  });
});
