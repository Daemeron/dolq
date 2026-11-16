// What the user can see of the link between the app and its backend (local or remote).
export type BackendStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export type BackendLogLine = { at: number; text: string };

export type BackendState = {
  mode: 'local' | 'remote';
  // host:port of a remote backend
  address?: string;
  status: BackendStatus;
  // One sentence for people: what is going on, and what to do if it needs them.
  detail: string;
  log: BackendLogLine[];
};
