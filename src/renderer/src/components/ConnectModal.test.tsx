import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ServerPreset } from '../data/servers';
import { ConnectModal } from './ConnectModal';

const presets: ServerPreset[] = [
  { id: 'libera', name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, secure: true } as ServerPreset,
  { id: 'plain', name: 'Plain', host: 'irc.plain.net', port: 6667, secure: false } as ServerPreset,
];

beforeEach(() => {
  (window as unknown as { irc: unknown }).irc = { secretsAvailable: vi.fn().mockResolvedValue(true) };
});

function setup(extra: Partial<Parameters<typeof ConnectModal>[0]> = {}) {
  const onConnect = vi.fn();
  const onCancel = vi.fn();
  render(
    <ConnectModal
      presets={presets}
      nickMap={{ libera: 'mira' }}
      onConnect={onConnect}
      onCancel={onCancel}
      {...extra}
    />,
  );
  return { onConnect, onCancel };
}

const host = () => screen.getByPlaceholderText('irc.libera.chat') as HTMLInputElement;
const nick = () => screen.getByPlaceholderText('yournick') as HTMLInputElement;
const port = () => screen.getByPlaceholderText('6667') as HTMLInputElement;
const tls = () => screen.getByRole('checkbox', { name: /Use TLS|TLS|Secure/i }) as HTMLInputElement;
const submit = () => fireEvent.click(screen.getByRole('button', { name: 'Connect' }));

describe('ConnectModal presets', () => {
  it('fills name, host, port and TLS from a preset, and the nick remembered for it', () => {
    setup();
    fireEvent.click(screen.getByText('Libera.Chat'));
    expect(host().value).toBe('irc.libera.chat');
    expect(port().value).toBe('6697');
    expect(nick().value).toBe('mira');
    expect(tls().checked).toBe(true);
    fireEvent.click(screen.getByText('Plain'));
    expect(port().value).toBe('6667');
    expect(nick().value).toBe('mira'); // no remembered nick for this preset: keeps what was typed
    expect(tls().checked).toBe(false);
  });
});

describe('ConnectModal form', () => {
  it('does not connect without a host or a nick', () => {
    const { onConnect } = setup();
    submit();
    expect(onConnect).not.toHaveBeenCalled();
    fireEvent.change(host(), { target: { value: 'irc.example.org' } });
    fireEvent.change(nick(), { target: { value: '  ' } });
    submit();
    expect(onConnect).not.toHaveBeenCalled();
  });

  it('switches the port with TLS only while it sits on the default', () => {
    setup();
    expect(port().value).toBe('6697');
    fireEvent.click(tls());
    expect(port().value).toBe('6667');
    fireEvent.click(tls());
    expect(port().value).toBe('6697');
    fireEvent.change(port(), { target: { value: '7000' } });
    fireEvent.click(tls());
    expect(port().value).toBe('7000');
  });

  it('connects with what was typed', () => {
    const { onConnect } = setup();
    fireEvent.change(host(), { target: { value: 'irc.example.org' } });
    fireEvent.change(nick(), { target: { value: 'me' } });
    fireEvent.change(screen.getByPlaceholderText('#general, #offtopic'), { target: { value: '#a, #b' } });
    submit();
    expect(onConnect).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'irc.example.org', nick: 'me', autojoinChannels: '#a, #b', secure: true }),
    );
  });

  it('starts from an irc:// link', () => {
    setup({ initial: { host: 'irc.link.org', port: 6667, secure: false, channel: '#linked' } });
    expect(host().value).toBe('irc.link.org');
    expect(port().value).toBe('6667');
    expect(tls().checked).toBe(false);
    expect((screen.getByPlaceholderText('#general, #offtopic') as HTMLInputElement).value).toBe('#linked');
  });

  it('cancels on Escape', () => {
    const { onCancel } = setup();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });

  it('remembers credentials only when asked to', async () => {
    const { onConnect } = setup();
    fireEvent.change(host(), { target: { value: 'irc.example.org' } });
    fireEvent.change(nick(), { target: { value: 'me' } });
    const remember = await screen.findByRole('checkbox', { name: /Remember/i });
    await waitFor(() => expect(remember).not.toBeDisabled());
    fireEvent.click(remember);
    submit();
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ remember: true }));
  });
});
