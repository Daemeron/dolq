import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EmojiPicker } from './EmojiPicker';

describe('EmojiPicker', () => {
  beforeEach(() => {
    // The outside-click listener is attached on the next frame; run frames synchronously.
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
  });
  afterEach(() => vi.restoreAllMocks());

  it('selects the clicked emoji', () => {
    const onSelect = vi.fn();
    render(<EmojiPicker onSelect={onSelect} onClose={() => {}} />);
    const first = screen.getAllByRole('button')[0];
    fireEvent.click(first);
    expect(onSelect).toHaveBeenCalledWith(first.textContent);
  });

  it('filters by name and reports when nothing matches', () => {
    render(<EmojiPicker onSelect={() => {}} onClose={() => {}} />);
    const all = screen.getAllByRole('button').length;
    fireEvent.change(screen.getByPlaceholderText('Search emoji…'), { target: { value: 'smil' } });
    const filtered = screen.getAllByRole('button').length;
    expect(filtered).toBeGreaterThan(0);
    expect(filtered).toBeLessThan(all);
    fireEvent.change(screen.getByPlaceholderText('Search emoji…'), { target: { value: 'zzzzqqqq' } });
    expect(screen.getByText('No matches')).toBeTruthy();
  });

  it('closes on Escape and on an outside click, but not on a click inside', () => {
    const onClose = vi.fn();
    render(<EmojiPicker onSelect={() => {}} onClose={onClose} />);
    fireEvent.click(screen.getByPlaceholderText('Search emoji…'));
    expect(onClose).not.toHaveBeenCalled();
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' });
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.click(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
