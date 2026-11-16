import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BackendState } from '../../../shared/backendState';
import { BackendStatus } from './BackendStatus';

const remote: BackendState = {
  mode: 'remote',
  address: '192.168.50.82:6789',
  status: 'connected',
  detail: 'Connected to 192.168.50.82:6789.',
  log: [
    { at: Date.UTC(2026, 10, 16, 18, 18, 27), text: 'Connecting to 192.168.50.82:6789…' },
    { at: Date.UTC(2026, 10, 16, 18, 18, 28), text: 'Connected to 192.168.50.82:6789.' },
  ],
};

afterEach(cleanup);

describe('BackendStatus', () => {
  it('shows nothing before the state is known, or while the local backend simply works', () => {
    const { container, rerender } = render(<BackendStatus state={null} onReconnect={vi.fn()} />);
    expect(container.innerHTML).toBe('');
    rerender(
      <BackendStatus
        state={{ mode: 'local', status: 'connected', detail: 'The local backend is running.', log: [] }}
        onReconnect={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('tells a remote backend is connected, and opens a panel with the sentence and the log', () => {
    render(<BackendStatus state={remote} onReconnect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend: Connected' }));
    const panel = screen.getByRole('region', { name: 'Backend connection' });
    expect(within(panel).getByText('Remote backend 192.168.50.82:6789')).toBeTruthy();
    expect(within(panel).getAllByText('Connected to 192.168.50.82:6789.').length).toBe(2);
    const lines = within(screen.getByRole('list', { name: 'Connection log' })).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[0].textContent).toContain('Connecting to 192.168.50.82:6789…');
  });

  it('says what is wrong when it cannot connect, and reconnects on request', () => {
    const onReconnect = vi.fn();
    render(
      <BackendStatus
        state={{
          ...remote,
          status: 'failed',
          detail: "The remote backend's certificate changed. Paste its pairing link in Preferences.",
        }}
        onReconnect={onReconnect}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Backend: Not connected' }));
    expect(screen.getAllByText(/certificate changed/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('copies the log, and closes with Escape or a click outside', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<BackendStatus state={remote} onReconnect={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Backend: Connected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Copy log' }));
    expect(writeText).toHaveBeenCalledOnce();
    expect(writeText.mock.calls[0][0]).toContain('Connecting to 192.168.50.82:6789…');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Backend connection' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Backend: Connected' }));
    fireEvent.click(screen.getByRole('button', { name: 'Close backend panel' }));
    expect(screen.queryByRole('region', { name: 'Backend connection' })).toBeNull();
  });
});
