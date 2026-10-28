import { describe, expect, it } from 'vitest';
import { comboFromEvent } from './keybind';

function key(init: {
  key: string;
  ctrlKey?: boolean;
  metaKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
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

describe('comboFromEvent: meta', () => {
  it('names the meta key and orders modifiers consistently', () => {
    expect(comboFromEvent(key({ key: 'k', metaKey: true }))).toBe('Meta+K');
    expect(comboFromEvent(key({ key: 'k', ctrlKey: true, metaKey: true, altKey: true, shiftKey: true }))).toBe(
      'Ctrl+Meta+Alt+Shift+K',
    );
  });
});
