import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  dark: true,
  windows: [] as { options: Record<string, unknown>; url: string }[],
}));

vi.mock('electron', () => ({
  nativeTheme: {
    get shouldUseDarkColors() {
      return h.dark;
    },
  },
  BrowserWindow: class {
    options: Record<string, unknown>;
    url = '';
    constructor(options: Record<string, unknown>) {
      this.options = options;
      h.windows.push(this);
    }
    loadURL(url: string) {
      this.url = url;
    }
  },
}));

import { createSplashWindow, SPLASH_DELAY_MS, splashHtml, startSplash } from './splash';

const ICON = path.join(__dirname, '../../resources/icon.png');

const fakeSplash = () => {
  const splash = { destroyed: false, destroy: vi.fn(), isDestroyed: () => splash.destroyed };
  return splash;
};

beforeEach(() => {
  vi.useFakeTimers();
  h.windows.length = 0;
});
afterEach(() => vi.useRealTimers());

describe('startSplash', () => {
  it('shows nothing when the app is ready before the delay', () => {
    const create = vi.fn(fakeSplash);
    const done = startSplash(create);
    vi.advanceTimersByTime(SPLASH_DELAY_MS - 1);
    done();
    vi.advanceTimersByTime(SPLASH_DELAY_MS);
    expect(create).not.toHaveBeenCalled();
  });

  it('shows the splash when the start is slow, and destroys it when the app is ready', () => {
    const splash = fakeSplash();
    const done = startSplash(() => splash);
    vi.advanceTimersByTime(SPLASH_DELAY_MS);
    expect(splash.destroy).not.toHaveBeenCalled();
    done();
    expect(splash.destroy).toHaveBeenCalledTimes(1);
  });

  it('does not destroy a splash that is already gone, and is safe to call twice', () => {
    const splash = fakeSplash();
    const done = startSplash(() => splash);
    vi.advanceTimersByTime(SPLASH_DELAY_MS);
    splash.destroyed = true;
    done();
    done();
    expect(splash.destroy).not.toHaveBeenCalled();
  });
});

describe('splashHtml', () => {
  const icon = Buffer.from('png-bytes');

  it('shows the icon, the name and a status line', () => {
    const html = splashHtml(true, icon);
    expect(html).toContain(`data:image/png;base64,${icon.toString('base64')}`);
    expect(html).toContain('<h1>Dolq</h1>');
    expect(html).toContain('Starting…');
  });

  it('follows the theme', () => {
    expect(splashHtml(true, icon)).toContain('background: #262624');
    expect(splashHtml(false, icon)).toContain('background: #faf9f5');
  });

  it('loads nothing from outside the page', () => {
    expect(splashHtml(true, icon)).toContain("default-src 'none'; img-src data:");
    expect(splashHtml(true, icon)).not.toMatch(/https?:/);
  });
});

describe('createSplashWindow', () => {
  it('opens a small frameless window in the OS theme', () => {
    h.dark = false;
    createSplashWindow(ICON);
    const [win] = h.windows;
    expect(win.options).toMatchObject({
      frame: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#faf9f5',
    });
    expect(win.url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(win.url)).toContain('<h1>Dolq</h1>');
  });
});
