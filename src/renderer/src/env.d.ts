/// <reference types="vite/client" />

import type { IrcApi } from '../../preload/index';

declare global {
  interface Window {
    irc: IrcApi;
  }
}
