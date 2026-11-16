import { describe, expect, it } from 'vitest';
import { mapRemotePath } from './remotePath';

describe('mapRemotePath', () => {
  it('moves a file from the remote folder to the same folder mounted here', () => {
    expect(mapRemotePath('/downloads/Show/ep 01.mkv', '/downloads', '/Volumes/anime')).toBe(
      '/Volumes/anime/Show/ep 01.mkv',
    );
  });

  it('is not bothered by a slash at the end of either folder', () => {
    expect(mapRemotePath('/downloads/a.mkv', '/downloads/', '/Volumes/anime/')).toBe('/Volumes/anime/a.mkv');
  });

  it('uses backslashes where the folder here is a Windows one', () => {
    expect(mapRemotePath('/downloads/Show/a.mkv', '/downloads', 'Z:\\anime')).toBe('Z:\\anime\\Show\\a.mkv');
    expect(mapRemotePath('/downloads/Show/a.mkv', '/downloads', '\\\\nas\\anime')).toBe('\\\\nas\\anime\\Show\\a.mkv');
  });

  it('maps the folder itself, and a mapping of the root', () => {
    expect(mapRemotePath('/downloads', '/downloads', '/Volumes/anime')).toBe('/Volumes/anime');
    expect(mapRemotePath('/share/a.mkv', '/', '/Volumes/nas')).toBe('/Volumes/nas/share/a.mkv');
  });

  it('only takes in whole folder names', () => {
    expect(mapRemotePath('/downloads-old/a.mkv', '/downloads', '/Volumes/anime')).toBeNull();
    expect(mapRemotePath('/other/a.mkv', '/downloads', '/Volumes/anime')).toBeNull();
  });

  it('is null without a complete mapping', () => {
    expect(mapRemotePath('/downloads/a.mkv')).toBeNull();
    expect(mapRemotePath('/downloads/a.mkv', '/downloads', '')).toBeNull();
    expect(mapRemotePath('/downloads/a.mkv', '  ', '/Volumes/anime')).toBeNull();
  });
});
