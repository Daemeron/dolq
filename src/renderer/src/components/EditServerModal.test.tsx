import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Server } from '../types';
import { ConnectModal } from './ConnectModal';
import { EditServerModal } from './EditServerModal';

const server: Server = { id: 's1', name: 'Libera', initial: 'L', secure: true, host: 'irc.libera.chat', port: 6697 };

beforeEach(() => {
  (window as unknown as { irc: unknown }).irc = { secretsAvailable: vi.fn().mockResolvedValue(true) };
});

function renderEdit(s: Server) {
  const onSave = vi.fn();
  render(<EditServerModal server={s} nick="me" saslUser="" saslPass="" onSave={onSave} onCancel={vi.fn()} />);
  return onSave;
}

const toggle = () => screen.getByRole('checkbox', { name: 'Connect when the app opens' });

describe('EditServerModal connect on startup', () => {
  it('starts off for a server saved without the option', () => {
    renderEdit(server);
    expect(toggle()).not.toBeChecked();
  });

  it('shows the saved option and saves a change to it', () => {
    const onSave = renderEdit({ ...server, connectOnStartup: true });
    expect(toggle()).toBeChecked();
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('s1', expect.objectContaining({ connectOnStartup: false }));
  });
});

describe('ConnectModal connect on startup', () => {
  it('is off for a new server and is passed on when turned on', () => {
    const onConnect = vi.fn();
    render(<ConnectModal presets={[]} nickMap={{}} onConnect={onConnect} onCancel={vi.fn()} />);
    expect(toggle()).not.toBeChecked();
    fireEvent.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: 'irc.example.org' } });
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: 'Connect' }));
    expect(onConnect).toHaveBeenCalledWith(expect.objectContaining({ connectOnStartup: true }));
  });
});

describe('EditServerModal form', () => {
  const tlsBox = () => screen.getByRole('checkbox', { name: /TLS|Secure/i }) as HTMLInputElement;
  const portInput = () => screen.getByPlaceholderText('6667') as HTMLInputElement;

  it('starts from the saved server and saves edits', () => {
    const onSave = renderEdit({ ...server, altNicks: ['alt1', 'alt2'], autojoinChannels: ['#a'] });
    expect((screen.getByPlaceholderText('My Server') as HTMLInputElement).value).toBe('Libera');
    expect((screen.getByPlaceholderText('irc.libera.chat') as HTMLInputElement).value).toBe('irc.libera.chat');
    expect((screen.getByPlaceholderText('yournick') as HTMLInputElement).value).toBe('me');
    expect((screen.getByPlaceholderText('#general, #offtopic') as HTMLInputElement).value).toBe('#a');
    fireEvent.change(screen.getByPlaceholderText('My Server'), { target: { value: 'Renamed' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledWith('s1', expect.objectContaining({ name: 'Renamed', nick: 'me' }));
  });

  it('does not save without a host', () => {
    const onSave = renderEdit(server);
    fireEvent.change(screen.getByPlaceholderText('irc.libera.chat'), { target: { value: ' ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).not.toHaveBeenCalled();
  });

  it('follows the default port when TLS is toggled', () => {
    renderEdit(server);
    expect(portInput().value).toBe('6697');
    fireEvent.click(tlsBox());
    expect(portInput().value).toBe('6667');
  });

  it('cancels on Escape', () => {
    const onCancel = vi.fn();
    render(<EditServerModal server={server} nick="me" saslUser="" saslPass="" onSave={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});
