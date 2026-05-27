/// <reference types="vite/client" />

import type { IrcApi } from '../../shared/ipc';

declare global {
  interface Window {
    irc: IrcApi;
  }
}
