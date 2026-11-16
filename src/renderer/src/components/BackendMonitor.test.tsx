import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { BackendInfo, BackendState } from '../../../shared/backendState';
import { BackendMonitor, folderTone } from './BackendMonitor';

const NOW = Date.UTC(2026, 10, 16, 18, 0, 0);

const connected: BackendState = {
  mode: 'remote',
  address: '192.168.50.82:6789',
  status: 'connected',
  detail: 'Connected to 192.168.50.82:6789.',
  log: [
    { at: NOW - 3000, text: 'Connecting to 192.168.50.82:6789…' },
    { at: NOW - 2000, text: 'Connected to 192.168.50.82:6789.' },
  ],
  latency: [
    { at: NOW - 40_000, ms: 12 },
    { at: NOW - 20_000, ms: 30 },
    { at: NOW, ms: 18 },
  ],
  connectedSince: NOW - (2 * 60 + 14) * 60_000,
  reconnects: 2,
  infoSupported: true,
  info: {
    version: '0.15.0',
    uptimeMs: 3 * 24 * 3_600_000 + 4 * 3_600_000,
    clients: 1,
    sessions: 3,
    transfers: 1,
    folders: [
      { name: 'data', path: '/data', free: 3_700_000_000_000, total: 6_500_000_000_000 },
      { name: 'downloads', path: '/downloads', free: 400_000_000, total: 6_500_000_000_000 },
    ],
  },
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('BackendMonitor', () => {
  it('shows the link: status, the latest round trip with its spread, how long it has held, how often it dropped', () => {
    render(<BackendMonitor state={connected} onReconnect={vi.fn()} />);
    const card = screen.getByRole('region', { name: 'Backend' });
    expect(within(card).getByText('Remote backend')).toBeTruthy();
    expect(within(card).getByText('192.168.50.82:6789')).toBeTruthy();
    expect(within(card).getByText('Connected')).toBeTruthy();
    expect(within(card).getByText('18 ms')).toBeTruthy();
    expect(within(card).getByText('min 12 · avg 20 · max 30 ms')).toBeTruthy();
    expect(within(card).getByText('2 h 14 min')).toBeTruthy();
    expect(within(card).getByText('2 times')).toBeTruthy();
    expect(screen.getByRole('img', { name: /Round trip to the backend over time, 18 ms now/ })).toBeTruthy();
  });

  it('shows what the backend says about itself, and the room each folder has left', () => {
    render(<BackendMonitor state={connected} onReconnect={vi.fn()} />);
    expect(screen.getByText('0.15.0')).toBeTruthy();
    expect(screen.getByText('3 d 4 h')).toBeTruthy();
    expect(screen.getByText('IRC connections').nextSibling?.textContent).toBe('3');
    expect(screen.getByText('Transfers').nextSibling?.textContent).toBe('1');
    const rooms = within(screen.getByRole('list', { name: 'Disk room' }));
    expect(rooms.getByText('3.7 TB free of 6.5 TB')).toBeTruthy();
    expect(rooms.getByText('400.0 MB free of 6.5 TB')).toBeTruthy();
    expect(rooms.getByRole('progressbar', { name: 'downloads folder, 100% used' })).toBeTruthy();
  });

  it('warns about a folder that is nearly full, and says when it cannot tell', () => {
    expect(folderTone({ free: 400_000_000, total: 6_500_000_000_000 })).toBe('danger');
    expect(folderTone({ free: 300_000_000_000, total: 6_500_000_000_000 })).toBe('warn');
    expect(folderTone({ free: 3_700_000_000_000, total: 6_500_000_000_000 })).toBe('ok');

    render(
      <BackendMonitor
        state={{
          ...connected,
          info: {
            ...(connected.info as BackendInfo),
            folders: [{ name: 'data', path: '/data', free: 0, total: 0, error: 'no such file or directory' }],
          },
        }}
        onReconnect={vi.fn()}
      />,
    );
    expect(screen.getByText(/Cannot tell how much room is left: no such file or directory/)).toBeTruthy();
  });

  it('says so, and keeps the rest, when the backend is too old to report on itself', () => {
    render(<BackendMonitor state={{ ...connected, info: undefined, infoSupported: false }} onReconnect={vi.fn()} />);
    expect(screen.getByText(/older than the monitoring/)).toBeTruthy();
    expect(screen.getByText('18 ms')).toBeTruthy();
    expect(screen.queryByText('Version')).toBeNull();
  });

  it('measures first: no numbers are invented before the first heartbeat', () => {
    render(
      <BackendMonitor
        state={{ ...connected, latency: [], info: undefined, connectedSince: NOW, reconnects: 0 }}
        onReconnect={vi.fn()}
      />,
    );
    expect(screen.getByText('Measuring the round trip…')).toBeTruthy();
    expect(screen.getByText('0 s')).toBeTruthy();
    expect(screen.getByText('0 times')).toBeTruthy();
  });

  it('explains a link that is down, and reconnects on request', () => {
    const onReconnect = vi.fn();
    render(
      <BackendMonitor
        state={{
          ...connected,
          status: 'reconnecting',
          detail: '192.168.50.82:6789 refused the connection. Trying again in 4s.',
          connectedSince: undefined,
        }}
        onReconnect={onReconnect}
      />,
    );
    expect(screen.getByText('Reconnecting…')).toBeTruthy();
    expect(screen.getAllByText(/refused the connection/).length).toBeGreaterThan(0);
    expect(screen.queryByText('18 ms')).toBeNull();
    expect(screen.getByText('—')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledOnce();
  });

  it('lists the last few things the connection did', () => {
    render(<BackendMonitor state={connected} onReconnect={vi.fn()} />);
    const lines = within(screen.getByRole('list', { name: 'Recent connection activity' })).getAllByRole('listitem');
    expect(lines).toHaveLength(2);
    expect(lines[1].textContent).toContain('Connected to 192.168.50.82:6789.');
  });

  it('keeps the durations current as time passes', () => {
    render(<BackendMonitor state={connected} onReconnect={vi.fn()} />);
    expect(screen.getByText('2 h 14 min')).toBeTruthy();
    act(() => {
      vi.setSystemTime(NOW + 60_000);
      vi.advanceTimersByTime(15_000);
    });
    expect(screen.getByText('2 h 15 min')).toBeTruthy();
  });
});
