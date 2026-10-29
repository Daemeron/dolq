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
  // Icon colour: a CSS colour (a nick palette token or hex). Missing means derived from the server id.
  color?: string;
  // Icon letters picked by the user (2-3 characters). Missing means derived from the name.
  initials?: string;
  rememberCredentials?: boolean;
  // Missing (every server saved before this option existed) means off.
  connectOnStartup?: boolean;
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
  membership?: boolean;
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
