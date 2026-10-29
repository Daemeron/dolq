import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { TitleBar } from './TitleBar';

describe('TitleBar', () => {
  it('is the draggable strip across the top, named for the app', () => {
    render(<TitleBar />);
    const strip = screen.getByRole('banner');
    expect(strip).toHaveClass('titlebar-drag');
    expect(strip).toHaveTextContent('Dolq');
  });
});
