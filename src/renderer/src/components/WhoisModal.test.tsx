import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IrcEvent } from '../../../shared/ipc';
import { formatIdle, WhoisModal } from './WhoisModal';

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
    expect(screen.getByText('#a #b')).toBeTruthy();
    expect(screen.getByText('1 hour 2 minutes')).toBeTruthy();
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

describe('WhoisModal: actions and formats', () => {
  it('offers to message or ignore a known user', () => {
    const onMessage = vi.fn();
    const onIgnore = vi.fn();
    render(
      <WhoisModal
        nick="mira"
        result={whois({ user: 'mira', host: 'h' })}
        onClose={() => {}}
        onMessage={onMessage}
        onIgnore={onIgnore}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Message' }));
    fireEvent.click(screen.getByRole('button', { name: 'Ignore' }));
    expect(onMessage).toHaveBeenCalled();
    expect(onIgnore).toHaveBeenCalled();
  });

  it('offers to send a file to a known user, but not to one that does not exist', () => {
    const onSendFile = vi.fn();
    const { rerender } = render(
      <WhoisModal nick="mira" result={whois({ user: 'm', host: 'h' })} onClose={() => {}} onSendFile={onSendFile} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Send file' }));
    expect(onSendFile).toHaveBeenCalled();
    rerender(
      <WhoisModal nick="mira" result={whois({ noSuchNick: true })} onClose={() => {}} onSendFile={onSendFile} />,
    );
    expect(screen.queryByRole('button', { name: 'Send file' })).toBeNull();
  });

  it('says how long a user has been idle in plain units', () => {
    expect(formatIdle(1)).toBe('1 second');
    expect(formatIdle(45)).toBe('45 seconds');
    expect(formatIdle(180)).toBe('3 minutes');
    expect(formatIdle(3600)).toBe('1 hour');
    expect(formatIdle(7260)).toBe('2 hours 1 minute');
  });

  it('shows when the user signed on', () => {
    const signonTime = Math.floor(Date.now() / 1000) - 60;
    render(<WhoisModal nick="mira" result={whois({ user: 'm', host: 'h', signonTime })} onClose={() => {}} />);
    expect(screen.getByText(/^Today, \d\d:\d\d$/)).toBeTruthy();
  });
});
