import type { ConnectionStatus } from '../../../shared/ipc';

// What reconcile does with a server, given its status on the backend. One that
// is connecting is already recovering there: connecting it again would tear
// that down (the backend disconnects first) and lose its rejoin list.
export function reconcileStep(status: ConnectionStatus): 'sync' | 'wait' | 'connect' {
  if (status === 'connected') return 'sync';
  if (status === 'connecting') return 'wait';
  return 'connect';
}
