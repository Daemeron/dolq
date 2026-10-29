import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { DolqMark } from './DolqMark';

describe('DolqMark', () => {
  it('is a decorative drawing in the current colour, with no background shape', () => {
    const { container } = render(<DolqMark className="h-7" />);
    const svg = container.querySelector('svg') as SVGElement;
    expect(svg).toHaveAttribute('aria-hidden', 'true');
    expect(svg).toHaveAttribute('fill', 'currentColor');
    expect(svg).toHaveClass('h-7');
    expect(container.querySelectorAll('svg > *')).toHaveLength(5);
  });
});
