import type { ConnectionStatus } from '../../../shared/ipc';

// What reconcile does with a server, given its status on the backend. One that
// is connecting is already recovering there: connecting it again would tear
// that down (the backend disconnects first) and lose its rejoin list.
export function reconcileStep(status: ConnectionStatus): 'sync' | 'wait' | 'connect' {
  if (status === 'connected') return 'sync';
  if (status === 'connecting') return 'wait';
  return 'connect';
}

// Asking for a server's status also attaches this window to its live lines, so
// every server is attached at once before anything slow (a connect can take
// seconds). onAttached runs between the two, so a history read started there
// cannot miss lines that arrive before the server is attached.
export async function reconcileServers<S>(
  servers: S[],
  getStatus: (server: S) => Promise<ConnectionStatus>,
  onAttached: () => void,
  apply: (server: S, status: ConnectionStatus) => Promise<void>,
): Promise<void> {
  const statuses = await Promise.all(servers.map(getStatus));
  onAttached();
  for (let i = 0; i < servers.length; i++) await apply(servers[i], statuses[i]);
}
