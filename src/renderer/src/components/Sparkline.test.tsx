import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sparkline } from './Sparkline';

describe('Sparkline', () => {
  it('draws a line for a series and names it', () => {
    const { container } = render(<Sparkline values={[10, 20, 15]} label="Latency, 15 ms now" />);
    expect(screen.getByRole('img', { name: 'Latency, 15 ms now' })).toBeTruthy();
    expect(container.querySelector('polyline')).toBeTruthy();
  });

  it('draws nothing until there are two points', () => {
    const { container } = render(<Sparkline values={[10]} label="x" />);
    expect(container.querySelector('polyline')).toBeNull();
  });
});
