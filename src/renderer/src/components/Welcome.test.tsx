import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { PUBLIC_SERVERS } from '../data/servers';
import { Welcome } from './Welcome';

function setup(presets = PUBLIC_SERVERS) {
  const h = { onPickPreset: vi.fn(), onAddCustom: vi.fn(), onPair: vi.fn() };
  render(<Welcome presets={presets} {...h} />);
  return h;
}

describe('Welcome', () => {
  it('offers the featured networks and reports the one picked', () => {
    const { onPickPreset } = setup();
    expect(screen.getByText('Open source projects')).toBeTruthy();
    expect(screen.queryByText('Coldfront')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /OFTC/ }));
    expect(onPickPreset).toHaveBeenCalledWith('irc.oftc.net:6697');
  });

  it('adds a custom server or pairs with a remote backend', () => {
    const { onAddCustom, onPair } = setup();
    fireEvent.click(screen.getByRole('button', { name: /Add custom server/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Pair with a remote backend' }));
    expect(onAddCustom).toHaveBeenCalled();
    expect(onPair).toHaveBeenCalled();
  });

  it('still works when none of the featured networks are in the list', () => {
    setup([]);
    expect(screen.getByRole('heading', { name: 'Welcome to Dolq' })).toBeTruthy();
  });
});
