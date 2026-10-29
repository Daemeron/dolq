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
  const JOKE = '<ghost_> I swear & I was online';

  it('shows the icon, the name and a status line', () => {
    const html = splashHtml(true, icon, JOKE);
    expect(html).toContain(`data:image/png;base64,${icon.toString('base64')}`);
    expect(html).toContain('<h1>Dolq</h1>');
    expect(html).toContain('Starting…');
  });

  it('follows the theme', () => {
    expect(splashHtml(true, icon, JOKE)).toContain('background: #262624');
    expect(splashHtml(false, icon, JOKE)).toContain('background: #faf9f5');
  });

  it('shows the joke as text, with its characters escaped', () => {
    const html = splashHtml(true, icon, JOKE);
    expect(html).toContain('<pre>&lt;ghost_&gt; I swear &amp; I was online</pre>');
    expect(html).not.toContain('<ghost_>');
  });

  it('loads nothing from outside the page', () => {
    expect(splashHtml(true, icon, JOKE)).toContain("default-src 'none'; img-src data:");
    expect(splashHtml(true, icon, JOKE)).not.toMatch(/https?:/);
  });
});

describe('createSplashWindow', () => {
  it('opens a frameless window as large as the app window, in the OS theme', () => {
    h.dark = false;
    createSplashWindow(ICON, { x: 40, y: 30, width: 1600, height: 900 });
    const [win] = h.windows;
    expect(win.options).toMatchObject({
      x: 40,
      y: 30,
      width: 1600,
      height: 900,
      frame: false,
      resizable: false,
      skipTaskbar: true,
      backgroundColor: '#faf9f5',
    });
    expect(win.url.startsWith('data:text/html;charset=utf-8,')).toBe(true);
    expect(decodeURIComponent(win.url)).toContain('<h1>Dolq</h1>');
  });
});
