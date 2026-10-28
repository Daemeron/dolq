import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewPanel } from './ViewPanel';

function setup() {
  const onClose = vi.fn();
  render(
    <ViewPanel title="Preferences" onClose={onClose}>
      <input aria-label="field" />
    </ViewPanel>,
  );
  return onClose;
}

describe('ViewPanel', () => {
  it('floats as a modal dialog named by its title, with a heading', () => {
    setup();
    expect(screen.getByRole('dialog', { name: 'Preferences' }).getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
  });

  it('moves focus into the dialog', () => {
    setup();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });

  it('closes from the header button and from a backdrop click, but not from a click inside', () => {
    const onClose = setup();
    fireEvent.click(screen.getByLabelText('field'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('presentation'));
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
