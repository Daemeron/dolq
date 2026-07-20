import type { PrivilegeLevel } from '../../shared/ipc';

export type Server = {
  id: string;
  name: string;
  initial: string;
  secure: boolean;
};

export type Channel = {
  id: string;
  name: string;
  isLog: boolean;
  // A DM/query - id is the correspondent's bare nick, same convention as a
  // channel's id being its bare "#name" (see App.tsx's PRIVMSG handling).
  isQuery?: boolean;
  topic?: string;
  topicSetBy?: string;
  topicSetAt?: Date;
};

export type Message = {
  id: number;
  nick: string;
  text: string;
  timestamp: Date;
  isRaw?: boolean;
  system?: boolean;
  action?: boolean;
  notice?: boolean;
};

export type User = {
  nick: string;
  privileges: PrivilegeLevel[];
};
