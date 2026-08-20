import { describe, expect, it } from 'vitest';
import { comboFromEvent } from './keybind';

// comboFromEvent only reads these fields, and `npm run frontend:test`
// currently runs without a DOM environment wired up, so a real
// KeyboardEvent isn't available here - a plain object covers what
// comboFromEvent touches.
function key(init: {
  key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean; shiftKey?: boolean;
}): KeyboardEvent {
  return { ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init } as KeyboardEvent;
}

describe('comboFromEvent', () => {
  it('requires a modifier key', () => {
    expect(comboFromEvent(key({ key: 'w' }))).toBeNull();
  });

  it('ignores a bare modifier press', () => {
    expect(comboFromEvent(key({ key: 'Alt', altKey: true }))).toBeNull();
  });

  it('builds a combo string for a letter with a modifier', () => {
    expect(comboFromEvent(key({ key: 'w', altKey: true }))).toBe('Alt+W');
  });

  it('stacks modifiers in a stable order', () => {
    expect(comboFromEvent(key({ key: 'm', ctrlKey: true, shiftKey: true }))).toBe('Ctrl+Shift+M');
  });

  it('keeps multi-character key names as-is', () => {
    expect(comboFromEvent(key({ key: 'ArrowDown', altKey: true }))).toBe('Alt+ArrowDown');
  });
});
