import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ViewPanel } from './ViewPanel';

describe('ViewPanel', () => {
  it('titles the view with a heading and closes from the header', () => {
    const onClose = vi.fn();
    render(
      <ViewPanel title="Preferences" onClose={onClose}>
        <p>body</p>
      </ViewPanel>,
    );
    expect(screen.getByRole('heading', { name: 'Preferences' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalled();
  });
});
