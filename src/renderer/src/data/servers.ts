export type ServerPreset = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
};

export const PUBLIC_SERVERS: ServerPreset[] = [
  // Linux / open source
  { id: 'irc.libera.chat:6697', name: 'Libera.Chat', host: 'irc.libera.chat', port: 6697, secure: true },
  { id: 'irc.oftc.net:6697', name: 'OFTC', host: 'irc.oftc.net', port: 6697, secure: true },

  // Anime / fansub
  { id: 'irc.rizon.net:6697', name: 'Rizon', host: 'irc.rizon.net', port: 6697, secure: true },
  { id: 'irc.coldfront.net:6667', name: 'Coldfront', host: 'irc.coldfront.net', port: 6667, secure: false },
  { id: 'irc.synirc.net:6667', name: 'SynIRC', host: 'irc.synirc.net', port: 6667, secure: false },

  // Gaming
  { id: 'irc.quakenet.org:6667', name: 'QuakeNet', host: 'irc.quakenet.org', port: 6667, secure: false },
  { id: 'irc.gamesurge.net:6667', name: 'GameSurge', host: 'irc.gamesurge.net', port: 6667, secure: false },
  { id: 'irc.swiftirc.net:6667', name: 'SwiftIRC', host: 'irc.swiftirc.net', port: 6667, secure: false },

  // General-purpose / legacy big networks
  { id: 'irc.snoonet.org:6667', name: 'Snoonet', host: 'irc.snoonet.org', port: 6667, secure: false },
  { id: 'irc.efnet.org:6667', name: 'EFnet', host: 'irc.efnet.org', port: 6667, secure: false },
  { id: 'irc.undernet.org:6667', name: 'Undernet', host: 'irc.undernet.org', port: 6667, secure: false },
  { id: 'irc.dal.net:6667', name: 'DALnet', host: 'irc.dal.net', port: 6667, secure: false },
  { id: 'irc.ircnet.com:6667', name: 'IRCnet', host: 'irc.ircnet.com', port: 6667, secure: false },
  { id: 'irc.esper.net:6667', name: 'EsperNet', host: 'irc.esper.net', port: 6667, secure: false },
  { id: 'irc.afternet.org:6667', name: 'AfterNET', host: 'irc.afternet.org', port: 6667, secure: false },
  { id: 'irc.sorcery.net:6667', name: 'SorceryNet', host: 'irc.sorcery.net', port: 6667, secure: false },
  { id: 'irc.geekshed.net:6667', name: 'GeekShed', host: 'irc.geekshed.net', port: 6667, secure: false },
  { id: 'irc.spotchat.org:6667', name: 'SpotChat', host: 'irc.spotchat.org', port: 6667, secure: false },
];
