import { describe, expect, it } from 'vitest';
import { TITLE_BAR_HEIGHT, windowFrame } from './windowFrame';

describe('windowFrame', () => {
  it('insets the traffic lights on macOS', () => {
    expect(windowFrame('darwin')).toMatchObject({ titleBarStyle: 'hiddenInset' });
  });

  it.each(['win32', 'linux'] as const)(
    'draws themed controls over the toolbar and hides the menu on %s',
    (platform) => {
      const frame = windowFrame(platform);
      expect(frame.titleBarStyle).toBe('hidden');
      expect(frame.autoHideMenuBar).toBe(true);
      expect(frame.titleBarOverlay).toMatchObject({ height: TITLE_BAR_HEIGHT });
    },
  );
});
