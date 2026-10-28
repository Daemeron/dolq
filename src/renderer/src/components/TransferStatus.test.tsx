import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { type Transfer, TransferStatus } from './TransferStatus';

const base: Transfer = { nick: 'bot', filename: 'a.iso', received: 50, total: 100 };

function setup(t: Partial<Transfer>) {
  const h = { onPause: vi.fn(), onResume: vi.fn(), onCancel: vi.fn(), onDismiss: vi.fn() };
  render(<TransferStatus transfers={{ x: { ...base, ...t } }} {...h} />);
  return h;
}

describe('TransferStatus', () => {
  it('renders nothing without transfers', () => {
    const { container } = render(
      <TransferStatus transfers={{}} onPause={vi.fn()} onResume={vi.fn()} onCancel={vi.fn()} onDismiss={vi.fn()} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows progress and speed, and pauses or cancels a running transfer', () => {
    const { onPause, onCancel } = setup({ speedBps: 2048 });
    expect(screen.getByText('bot · 50% · 2.0 KB/s')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(onPause).toHaveBeenCalledWith('x');
    expect(onCancel).toHaveBeenCalledWith('x');
  });

  it('resumes a paused transfer', () => {
    const { onResume } = setup({ paused: true });
    expect(screen.getByText('bot · 50% · paused')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(onResume).toHaveBeenCalledWith('x');
  });

  it('shows a finished transfer as done and dismisses it, with no pause control', () => {
    const { onDismiss } = setup({ done: true, received: 100 });
    expect(screen.getByText('Done')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Pause' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledWith('x');
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
