import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { XDCCOfferModal } from './XDCCOfferModal';

function setup(trustable: boolean, size = 1536) {
  const handlers = {
    onAccept: vi.fn(),
    onAcceptSession: vi.fn(),
    onAcceptAlways: vi.fn(),
    onDecline: vi.fn(),
  };
  render(<XDCCOfferModal nick="bot" filename="pack.iso" size={size} trustable={trustable} {...handlers} />);
  return handlers;
}

describe('XDCCOfferModal', () => {
  it('shows the file with a human size', () => {
    setup(true, 1536);
    expect(screen.getByText(/pack\.iso/).textContent).toContain('1.5 KB');
  });

  it('formats sizes across units', () => {
    setup(true, 500);
    expect(screen.getByText(/pack\.iso/).textContent).toContain('500 B');
  });

  it('formats gigabyte sizes', () => {
    setup(true, 5 * 1024 ** 3);
    expect(screen.getByText(/pack\.iso/).textContent).toContain('5.0 GB');
  });

  it('offers the trust options only when the sender can be recognised', () => {
    const { onAcceptSession, onAcceptAlways } = setup(true);
    fireEvent.click(screen.getByText(/until this server disconnects/));
    fireEvent.click(screen.getByText(/always trust/));
    expect(onAcceptSession).toHaveBeenCalled();
    expect(onAcceptAlways).toHaveBeenCalled();
  });

  it('hides the trust options for an unrecognisable sender', () => {
    setup(false);
    expect(screen.queryByText(/always trust/)).toBeNull();
  });

  it('accepts once, declines, and declines on Escape', () => {
    const { onAccept, onDecline } = setup(false);
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('presentation'));
    expect(onDecline).toHaveBeenCalledTimes(3);
  });
});
