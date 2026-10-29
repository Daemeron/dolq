import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('draws a line for a series and names it', () => {
    const { container } = render(<Sparkline values={[10, 20, 15]} label="Latency, 15 ms now" />);
    expect(screen.getByRole('img', { name: 'Latency, 15 ms now' })).toBeTruthy();
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('can be scaled to a given range rather than its own spread', () => {
    const { container } = render(
      <Sparkline values={[10, 10]} label="x" width={10} height={20} range={{ min: 0, max: 20 }} />,
    );
    expect(container.querySelector('polyline')).toHaveAttribute('points', '0.0,10.0 10.0,10.0');
  });

  it('draws nothing until there are two points', () => {
    const { container } = render(<Sparkline values={[10]} label="x" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
