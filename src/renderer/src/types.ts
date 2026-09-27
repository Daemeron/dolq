import type { PrivilegeLevel } from '../../shared/ipc';

export type Server = {
  id: string;
  name: string;
  initial: string;
  secure: boolean;
  host?: string;
  port?: number;
  altNicks?: string[];
  username?: string;
  realname?: string;
  autojoinChannels?: string[];
  color?: string;
};

export type Channel = {
  id: string;
  name: string;
  isLog: boolean;
  isQuery?: boolean;
  isDCC?: boolean;
  joined?: boolean;
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
  xdccPack?: boolean;
  xdccPackNumber?: number;
};

export type User = {
  nick: string;
  privileges: PrivilegeLevel[];
  away?: boolean;
};
