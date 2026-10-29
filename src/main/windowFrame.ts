import type { BrowserWindowConstructorOptions } from 'electron';

// Height of the Windows/Linux window controls: the usual 32px caption buttons, top-aligned over the 56px toolbar.
export const TITLE_BAR_HEIGHT = 32;

/** Window chrome: macOS keeps its traffic lights inset into the app; elsewhere the OS controls are drawn over a themed bar and the menu hides behind Alt. */
export function windowFrame(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset' };
  return {
    titleBarStyle: 'hidden',
    // The dark theme's --dolq-bg and --dolq-text; the renderer updates them when the theme changes (setTitleBar).
    titleBarOverlay: { color: '#262624', symbolColor: '#faf9f5', height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
  };
}
