import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ServerAppearance } from './ServerAppearance';

function setup(over: Partial<React.ComponentProps<typeof ServerAppearance>> = {}) {
  const onChange = vi.fn();
  render(<ServerAppearance serverId="s1" name="Libera Chat" initials="" color="" onChange={onChange} {...over} />);
  return onChange;
}

describe('ServerAppearance', () => {
  it('previews the automatic letters and offers them as the placeholder', () => {
    setup();
    expect(screen.getByLabelText('Icon letters')).toHaveAttribute('placeholder', 'LC');
    expect(screen.getByLabelText('Icon letters')).toHaveAttribute('maxlength', '3');
  });

  it('reports the letters typed and the colour picked', () => {
    const onChange = setup();
    fireEvent.change(screen.getByLabelText('Icon letters'), { target: { value: 'LIB' } });
    expect(onChange).toHaveBeenCalledWith({ initials: 'LIB' });
    fireEvent.click(screen.getAllByRole('button', { name: /^Colour / })[0]);
    expect(onChange).toHaveBeenCalledWith({ color: 'var(--dolq-nick-1)' });
  });

  it('marks the current colour, and keeps a hex colour from before the palette selectable', () => {
    setup({ color: '#abcdef' });
    expect(screen.getByRole('button', { name: 'Colour #abcdef' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Automatic colour' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('can return to the automatic colour', () => {
    const onChange = setup({ color: 'var(--dolq-nick-2)' });
    fireEvent.click(screen.getByRole('button', { name: 'Automatic colour' }));
    expect(onChange).toHaveBeenCalledWith({ color: '' });
  });
});
