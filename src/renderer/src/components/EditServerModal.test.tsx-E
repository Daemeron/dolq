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
