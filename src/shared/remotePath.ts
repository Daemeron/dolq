const trimEnd = (path: string) => (path.length > 1 ? path.replace(/[\\/]+$/, '') : path);

// A Windows drive (C:\) or network (\\nas\share) folder: its parts are joined with backslashes.
const isWindowsPath = (path: string) => /^[A-Za-z]:/.test(path) || path.startsWith('\\\\');

/**
 * Where a file of the remote backend is on this computer, when the folder it is in is also mounted here, as a network
 * share. `remoteFolder` is that folder as the backend sees it (always /-separated), `localFolder` the same folder here.
 * Null when there is no mapping, or the file is not inside the mapped folder.
 */
export function mapRemotePath(path: string, remoteFolder?: string, localFolder?: string): string | null {
  const from = trimEnd(remoteFolder?.trim() ?? '');
  const to = trimEnd(localFolder?.trim() ?? '');
  if (!from || !to) return null;
  // A match is a whole folder name, so /downloads does not take in /downloads-old.
  const inside = from === '/' ? path.startsWith('/') : path === from || path.startsWith(`${from}/`);
  if (!inside) return null;
  const rest = path.slice(from === '/' ? 1 : from.length).replace(/^\/+/, '');
  if (!rest) return to;
  return isWindowsPath(to) ? `${to}\\${rest.replaceAll('/', '\\')}` : `${to}/${rest}`;
}
