// What the user can see of the link between the app and its backend (local or remote).
export type BackendStatus = 'connecting' | 'connected' | 'reconnecting' | 'failed';

export type BackendLogLine = { at: number; text: string };

/** One round trip to the backend, as timed by a heartbeat. */
export type BackendLatency = { at: number; ms: number };

/** The room a folder the backend writes to has left. `error` says why that could not be told. */
export type BackendFolder = { name: string; path: string; free: number; total: number; error?: string };

/** What a backend says about itself (the getInfo action). */
export type BackendInfo = {
  version: string;
  /** How long the backend process has been running, as of its answer. A length of time, so no clock is compared. */
  uptimeMs: number;
  clients: number;
  /** IRC connections it holds, including ones it is redialling. */
  sessions: number;
  /** Open file transfers and direct chats. */
  transfers: number;
  folders: BackendFolder[];
};

export type BackendState = {
  mode: 'local' | 'remote';
  // host:port of a remote backend
  address?: string;
  status: BackendStatus;
  // One sentence for people: what is going on, and what to do if it needs them.
  detail: string;
  log: BackendLogLine[];
  /** Heartbeat round trips of a remote backend, oldest first. */
  latency: BackendLatency[];
  /** When the link last came up, while it is up. */
  connectedSince?: number;
  /** Times the link was lost and made again since this backend was chosen. Pressing Reconnect keeps the count. */
  reconnects: number;
  /** The backend's own report, as of the last heartbeat. */
  info?: BackendInfo;
  /** False once the backend answered "unknown action": it is older than the monitoring and reports nothing. */
  infoSupported: boolean;
};
