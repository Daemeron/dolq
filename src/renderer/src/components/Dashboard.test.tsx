import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { Channel, Server } from '../types';
import { Dashboard } from './Dashboard';

const server = (id: string, name: string, over: Partial<Server> = {}): Server =>
  ({ id, name, initial: name[0], host: `${id}.example`, port: 6697, ...over }) as Server;
const channel = (name: string, over: Partial<Channel> = {}): Channel => ({ id: name, name, isLog: false, ...over });

function setup(over: Partial<React.ComponentProps<typeof Dashboard>> = {}) {
  const props = {
    servers: [server('a', 'Libera'), server('b', 'Rizon')],
    statusMap: { a: 'connected', b: 'disconnected' } as const,
    channelMap: {
      a: [channel('__log__', { isLog: true }), channel('dolq', { joined: true }), channel('quiet', { joined: false })],
      b: [channel('news', { joined: true })],
    },
    latencyMap: {
      a: [
        { at: 1, ms: 40 },
        { at: 2, ms: 100 },
        { at: 3, ms: 70 },
      ],
      b: [{ at: 1, ms: 500 }],
    },
    rates: { down: 2 * 1024 * 1024, up: 512 * 1024, active: 2 },
    bandwidth: [
      { at: 1, down: 0, up: 0 },
      { at: 2, down: 2 * 1024 * 1024, up: 512 * 1024 },
    ],
    onOpenServer: vi.fn(),
    onOpenChannel: vi.fn(),
    ...over,
  };
  render(<Dashboard {...props} />);
  return props;
}

describe('Dashboard', () => {
  it('counts connected servers and shows the current transfer rates', () => {
    setup();
    expect(screen.getByText('1 of 2')).toBeTruthy();
    expect(screen.getByText('2.0 MB/s')).toBeTruthy();
    expect(screen.getByText('512.0 KB/s')).toBeTruthy();
    expect(screen.getByText('2 active transfers')).toBeTruthy();
  });

  it('graphs download and upload over time, with the peak', () => {
    setup();
    expect(
      screen.getByRole('img', { name: 'Download and upload over time, 2.0 MB/s down and 512.0 KB/s up now' }),
    ).toBeTruthy();
    expect(screen.getByText('peak 2.0 MB/s')).toBeTruthy();
  });

  it('says it is collecting while the bandwidth history is too short to draw', () => {
    setup({ bandwidth: [] });
    expect(screen.getByText('Collecting samples…')).toBeTruthy();
    expect(screen.getByRole('img', { name: 'Download and upload over time' })).toBeTruthy();
  });

  it('shows a connected server with its latency, trend and joined channels only', () => {
    setup();
    const libera = within(screen.getByRole('region', { name: 'Libera' }));
    expect(libera.getByText('70 ms')).toBeTruthy();
    expect(libera.getByText('min 40 · avg 70 · max 100 ms')).toBeTruthy();
    expect(libera.getByRole('img', { name: 'Latency to Libera over time, 70 ms now' })).toBeTruthy();
    expect(libera.getByRole('button', { name: '#dolq' })).toBeTruthy();
    expect(libera.queryByRole('button', { name: '#quiet' })).toBeNull();
    expect(libera.queryByText('#__log__')).toBeNull();
  });

  it('shows no latency for a server that is not connected', () => {
    setup();
    const rizon = within(screen.getByRole('region', { name: 'Rizon' }));
    expect(rizon.getByText('Disconnected')).toBeTruthy();
    expect(rizon.queryByText(/ ms$/)).toBeNull();
    expect(rizon.queryByRole('img')).toBeNull();
  });

  it('says it is measuring while a connected server has no reading yet', () => {
    setup({ latencyMap: {} });
    expect(screen.getByText('Measuring latency…')).toBeTruthy();
  });

  it('opens a server or one of its channels', () => {
    const p = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Libera' }));
    expect(p.onOpenServer).toHaveBeenCalledWith('a');
    fireEvent.click(screen.getByRole('button', { name: '#dolq' }));
    expect(p.onOpenChannel).toHaveBeenCalledWith('a', 'dolq');
  });

  it('points to the rail when there are no servers', () => {
    setup({ servers: [] });
    expect(screen.getByText(/No servers yet/)).toBeTruthy();
  });
});
