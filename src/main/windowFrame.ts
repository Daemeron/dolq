import type { BrowserWindowConstructorOptions } from 'electron';

// Height of the app's title strip (components/TitleBar.tsx); the Windows/Linux window controls fill it.
export const TITLE_BAR_HEIGHT = 32;

/** Window chrome: the title bar is hidden and the renderer's strip takes its place. macOS keeps its traffic lights, inset into the strip; elsewhere the OS controls are drawn over it and the menu hides behind Alt. */
export function windowFrame(platform: NodeJS.Platform): BrowserWindowConstructorOptions {
  if (platform === 'darwin') return { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 14, y: 9 } };
  return {
    titleBarStyle: 'hidden',
    // The dark theme's --dolq-bg-panel-alt and --dolq-text; the renderer updates them when the theme changes (setTitleBar).
    titleBarOverlay: { color: '#191918', symbolColor: '#faf9f5', height: TITLE_BAR_HEIGHT },
    autoHideMenuBar: true,
  };
}
