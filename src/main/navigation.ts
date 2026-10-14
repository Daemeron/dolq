// The only links the app hands to the OS browser.
export function isWebLink(url: string): boolean {
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:';
  } catch {
    return false;
  }
}

// Whether the window may navigate to target: only within the page it was
// loaded with (the Vite dev server's origin, or the renderer's index.html).
export function isAppNavigation(target: string, appUrl: string): boolean {
  try {
    const to = new URL(target);
    const app = new URL(appUrl);
    if (app.protocol === 'file:') return to.protocol === 'file:' && to.pathname === app.pathname;
    return to.origin === app.origin;
  } catch {
    return false;
  }
}
