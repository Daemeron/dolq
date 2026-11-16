import { describe, expect, it, vi } from 'vitest';
import { remeasureRows } from './remeasureRows';

describe('remeasureRows', () => {
  it('measures each drawn row and nothing else', () => {
    const box = document.createElement('div');
    box.innerHTML = '<div data-index="0"><p data-x></p></div><div data-index="1"></div><div></div>';
    const measure = vi.fn();
    remeasureRows(box, measure);
    expect(measure.mock.calls.map(([row]) => (row as HTMLElement).dataset.index)).toEqual(['0', '1']);
  });
  it('does nothing without a container', () => {
    const measure = vi.fn();
    remeasureRows(null, measure);
    expect(measure).not.toHaveBeenCalled();
  });
});
