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

  it('picks how to accept from a menu, then accepts with the button', () => {
    const { onAccept, onAcceptSession, onAcceptAlways } = setup(true);
    const choose = (name: string) => {
      fireEvent.click(screen.getByRole('button', { name: 'Choose how to accept' }));
      fireEvent.click(screen.getByRole('menuitemradio', { name }));
    };
    choose('Accept from bot for this session');
    expect(onAcceptSession).not.toHaveBeenCalled();
    expect(screen.queryByRole('menu')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Accept for session' }));
    expect(onAcceptSession).toHaveBeenCalledTimes(1);

    choose('Always accept from bot');
    fireEvent.click(screen.getByRole('button', { name: 'Always accept' }));
    expect(onAcceptAlways).toHaveBeenCalledTimes(1);

    choose('Accept this file only');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledTimes(1);
  });

  it('marks the current choice in the menu', () => {
    setup(true);
    fireEvent.click(screen.getByRole('button', { name: 'Choose how to accept' }));
    expect(screen.getByRole('menuitemradio', { name: 'Accept this file only' }).getAttribute('aria-checked')).toBe(
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Always accept from bot' }).getAttribute('aria-checked')).toBe(
      'false',
    );
  });

  it('closes the menu on Escape before declining, and on a click outside it', () => {
    const { onDecline } = setup(true);
    const open = () => fireEvent.click(screen.getByRole('button', { name: 'Choose how to accept' }));
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
    expect(screen.queryByRole('button', { name: 'Choose how to accept' })).toBeNull();
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
