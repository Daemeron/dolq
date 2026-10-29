import fs from 'node:fs';
import { BrowserWindow, nativeTheme } from 'electron';

/** Starting is only worth a splash when it takes a while: a window that is ready sooner than this never shows one. */
export const SPLASH_DELAY_MS = 250;

type Destroyable = { destroy(): void; isDestroyed(): boolean };

/** Shows the splash if the app is still not ready after `delayMs`; the returned function destroys it, or cancels it. */
export function startSplash(create: () => Destroyable, delayMs = SPLASH_DELAY_MS): () => void {
  let splash: Destroyable | undefined;
  let done = false;
  const timer = setTimeout(() => {
    if (!done) splash = create();
  }, delayMs);
  return () => {
    done = true;
    clearTimeout(timer);
    // destroy(), not close(): the splash holds nothing to save, and it must be gone the moment the window shows.
    if (splash && !splash.isDestroyed()) splash.destroy();
    splash = undefined;
  };
}

// The design system's surface, text and dim-text colours for each theme.
const COLOURS = {
  dark: { bg: '#262624', text: '#faf9f5', dim: '#a09e95' },
  light: { bg: '#faf9f5', text: '#141413', dim: '#6b6963' },
};

/** The splash page: the app icon, the name and a quiet "Starting", on the surface colour of the OS theme. */
export function splashHtml(dark: boolean, icon: Buffer): string {
  const c = dark ? COLOURS.dark : COLOURS.light;
  return `<!doctype html><html><head><meta charset="utf-8" />
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'" />
<style>
  html, body { height: 100%; margin: 0; background: ${c.bg}; overflow: hidden; user-select: none; -webkit-app-region: drag; }
  body { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 14px;
         font-family: system-ui, -apple-system, 'Segoe UI', sans-serif; }
  img { width: 96px; height: 96px; }
  h1 { margin: 0; font: 400 30px Georgia, 'Times New Roman', serif; color: ${c.text}; }
  p { margin: 0; font-size: 12px; color: ${c.dim}; animation: pulse 1.6s ease-in-out infinite; }
  @keyframes pulse { 50% { opacity: 0.35; } }
</style></head>
<body><img alt="" src="data:image/png;base64,${icon.toString('base64')}" /><h1>Dolq</h1><p>Starting…</p></body></html>`;
}

/** A small frameless window with the splash page, in the colours of the OS theme. */
export function createSplashWindow(iconPath: string): BrowserWindow {
  const dark = nativeTheme.shouldUseDarkColors;
  const splash = new BrowserWindow({
    width: 340,
    height: 280,
    frame: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    backgroundColor: (dark ? COLOURS.dark : COLOURS.light).bg,
    icon: iconPath,
  });
  splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(splashHtml(dark, fs.readFileSync(iconPath)))}`);
  return splash;
}
