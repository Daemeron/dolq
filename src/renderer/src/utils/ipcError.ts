/** The message of an error from a call to the main process, without Electron's "Error invoking remote method 'x': Error: " in front of it. */
export function ipcErrorMessage(err: unknown): string {
  const text = err instanceof Error ? err.message : String(err);
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}
