import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { DCCOfferModal } from './DCCOfferModal';

function setup() {
  const onAccept = vi.fn();
  const onDecline = vi.fn();
  render(<DCCOfferModal nick="kestrel" onAccept={onAccept} onDecline={onDecline} />);
  return { onAccept, onDecline };
}

describe('DCCOfferModal', () => {
  it('names the sender and accepts or declines from the buttons', () => {
    const { onAccept, onDecline } = setup();
    expect(screen.getByRole('dialog').textContent).toContain('kestrel');
    fireEvent.click(screen.getByRole('button', { name: 'Accept' }));
    expect(onAccept).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('button', { name: 'Decline' }));
    expect(onDecline).toHaveBeenCalledOnce();
  });

  it('declines on Escape and on a backdrop click, but not on a click inside the dialog', () => {
    const { onDecline } = setup();
    fireEvent.click(screen.getByRole('dialog'));
    expect(onDecline).not.toHaveBeenCalled();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onDecline).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('presentation'));
    expect(onDecline).toHaveBeenCalledTimes(2);
  });

  it('does not decline on other keys', () => {
    const { onDecline } = setup();
    fireEvent.keyDown(window, { key: 'Enter' });
    expect(onDecline).not.toHaveBeenCalled();
  });
});
