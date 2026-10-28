import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NickServIdentifyModal } from './NickServIdentifyModal';

function setup() {
  const onIdentify = vi.fn();
  const onDismiss = vi.fn();
  render(<NickServIdentifyModal onIdentify={onIdentify} onDismiss={onDismiss} />);
  return { onIdentify, onDismiss, input: screen.getByPlaceholderText('Password') };
}

describe('NickServIdentifyModal', () => {
  it('identifies with the typed password', () => {
    const { onIdentify, input } = setup();
    fireEvent.change(input, { target: { value: 'hunter2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Identify' }));
    expect(onIdentify).toHaveBeenCalledWith('hunter2');
  });

  it('does not identify with an empty password', () => {
    const { onIdentify } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Identify' }));
    expect(onIdentify).not.toHaveBeenCalled();
  });

  it('dismisses from the button, Escape or the backdrop', () => {
    const { onDismiss } = setup();
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(screen.getByRole('presentation'));
    expect(onDismiss).toHaveBeenCalledTimes(3);
  });
});
