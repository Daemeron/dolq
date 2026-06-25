import type { PrivilegeLevel } from '../../shared/ipc';

export type Server = {
  id: string;
  name: string;
  initial: string;
};

export type Channel = {
  id: string;
  name: string;
  isLog: boolean;
  topic?: string;
};

export type Message = {
  id: number;
  nick: string;
  text: string;
  timestamp: Date;
  isRaw?: boolean;
};

export type User = {
  nick: string;
  privilege: PrivilegeLevel;
};
