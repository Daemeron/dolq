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

  it('offers the trust options in a menu on the Accept button', () => {
    const { onAcceptSession, onAcceptAlways } = setup(true);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'More ways to accept' }));
    fireEvent.click(screen.getByText('Accept from bot for this session'));
    fireEvent.click(screen.getByText('Always accept from bot'));
    expect(onAcceptSession).toHaveBeenCalled();
    expect(onAcceptAlways).toHaveBeenCalled();
  });

  it('closes the menu on Escape before declining, and on a click outside it', () => {
    const { onDecline } = setup(true);
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'More ways to accept' }));
    open();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(onDecline).not.toHaveBeenCalled();
    open();
    fireEvent.click(document.querySelector('.fixed.inset-0.z-10') as Element);
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDecline).toHaveBeenCalledTimes(1);
  });

  it('hides the trust options for an unrecognisable sender', () => {
    setup(false);
    expect(screen.queryByRole('button', { name: 'More ways to accept' })).toBeNull();
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
