import { describe, expect, it } from 'vitest';
import { isAppNavigation, isWebLink } from './navigation';

describe('isWebLink', () => {
  it('accepts only http and https', () => {
    expect(isWebLink('https://example.com/a')).toBe(true);
    expect(isWebLink('http://example.com')).toBe(true);
    for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'irc://irc.libera.chat', 'smb://host/share', '']) {
      expect(isWebLink(url)).toBe(false);
    }
  });
});

describe('isAppNavigation', () => {
  const dev = 'http://localhost:5173/';
  const packaged = 'file:///Applications/Dolq.app/Contents/Resources/app.asar/out/renderer/index.html';

  it('allows staying on the dev server origin', () => {
    expect(isAppNavigation('http://localhost:5173/', dev)).toBe(true);
    expect(isAppNavigation('http://localhost:5173/index.html#x', dev)).toBe(true);
  });

  it('denies leaving the dev server origin', () => {
    expect(isAppNavigation('http://localhost:5174/', dev)).toBe(false);
    expect(isAppNavigation('https://localhost:5173/', dev)).toBe(false);
    expect(isAppNavigation('https://evil.example/', dev)).toBe(false);
  });

  it('allows only the renderer page itself in a packaged build', () => {
    expect(isAppNavigation(packaged, packaged)).toBe(true);
    expect(isAppNavigation(`${packaged}?a=1#b`, packaged)).toBe(true);
    expect(isAppNavigation('file:///etc/passwd', packaged)).toBe(false);
    expect(isAppNavigation('https://example.com/', packaged)).toBe(false);
  });

  it('denies anything unparseable', () => {
    expect(isAppNavigation('not a url', dev)).toBe(false);
  });
});
