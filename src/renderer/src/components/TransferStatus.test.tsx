import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type Transfer, TransferStatus } from './TransferStatus';

const base: Transfer = { nick: 'bot', filename: 'a.iso', received: 50, total: 100 };

function setup(t: Partial<Transfer>) {
  const h = {
    onPause: vi.fn(),
    onResume: vi.fn(),
    onCancel: vi.fn(),
    onDismiss: vi.fn(),
    onShowInFolder: vi.fn(),
    onClose: vi.fn(),
  };
  render(<TransferStatus transfers={{ x: { ...base, ...t } }} {...h} />);
  return h;
}

describe('TransferStatus', () => {
  it('says so when there are no transfers, and closes', () => {
    const onClose = vi.fn();
    render(
      <TransferStatus
        transfers={{}}
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onDismiss={vi.fn()}
        onClose={onClose}
      />,
    );
    expect(screen.getByText(/No transfers yet/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });

  it('shows progress and speed, and pauses or cancels a running transfer', () => {
    const { onPause, onCancel } = setup({ speedBps: 2048 });
    expect(screen.getByText('bot · 50% of 100 B · 2.0 KB/s')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onPause).toHaveBeenCalledWith('x');
    expect(onCancel).toHaveBeenCalledWith('x');
  });

  it('resumes a paused transfer', () => {
    const { onResume } = setup({ paused: true });
    expect(screen.getByText('bot · 50% of 100 B · paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('x');
  });

  it('shows a finished transfer as done and dismisses it, with no pause control', () => {
    const { onDismiss } = setup({ done: true, received: 100 });
    expect(screen.getByText('Completed · 100 B')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('x');
  });

  it('offers to show a finished download in its folder, only when its path is known', () => {
    const { onShowInFolder } = setup({ done: true, received: 100, path: '/dl/a.iso' });
    fireEvent.click(screen.getByRole('button', { name: 'Show in folder' }));
    expect(onShowInFolder).toHaveBeenCalledWith('/dl/a.iso');
  });

  it('has no show-in-folder button without a path or while running', () => {
    setup({ done: true, received: 100 });
    expect(screen.queryByRole('button', { name: 'Show in folder' })).toBeNull();
  });

  it('shows the failure reason', () => {
    setup({ error: 'connection reset' });
    expect(screen.getByText('Failed: connection reset')).toBeTruthy();
  });

  it('caps the percentage at 100 and copes with an unknown total', () => {
    setup({ received: 500, total: 100 });
    expect(screen.getByText(/100%/)).toBeTruthy();
  });

  it('shows 0% when the total is unknown', () => {
    setup({ received: 10, total: 0 });
    expect(screen.getByText(/· 0%/)).toBeTruthy();
  });
});

describe('TransferStatus: speed units', () => {
  it.each([
    [500, '500 B/s'],
    [2 * 1024 * 1024, '2.0 MB/s'],
    [3 * 1024 ** 3, '3.0 GB/s'],
  ])('shows %d bytes per second as %s', (speedBps, shown) => {
    setup({ speedBps });
    expect(screen.getByText(new RegExp(shown.replace('/', '\\/')))).toBeTruthy();
  });

  it('shows an outgoing file as waiting for the peer, then sending, with no pause control', () => {
    const { onCancel } = setup({ sending: true, received: 0, total: 0 });
    expect(screen.getByText('Waiting for bot to connect')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onCancel).toHaveBeenCalledWith('x');
  });

  it('shows how far an outgoing file has got, and when it was sent', () => {
    setup({ sending: true, received: 50, total: 100 });
    expect(screen.getByText('Sending to bot · 50% of 100 B')).toBeTruthy();
  });

  it('says Sent for a finished outgoing file', () => {
    setup({ sending: true, done: true, received: 100, total: 100 });
    expect(screen.getByText('Sent · 100 B')).toBeTruthy();
  });
});
