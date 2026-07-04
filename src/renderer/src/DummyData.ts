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
  isOp: boolean;
};

export const MOCK_SERVERS: Server[] = [
  { id: 'libera', name: 'Libera.Chat', initial: 'L' },
  { id: 'ircnet', name: 'IRCnet', initial: 'I' },
];

export const MOCK_CHANNELS: Record<string, Channel[]> = {
  libera: [
    { id: '__log__', name: 'Log', isLog: true },
    { id: '#general', name: 'general', isLog: false, topic: 'Welcome to #general — read the rules before posting.' },
    { id: '#random', name: 'random', isLog: false, topic: 'Anything goes. Be nice.' },
    { id: '#help', name: 'help', isLog: false, topic: 'Ask questions, get answers.' },
  ],
  ircnet: [
    { id: '__log__', name: 'Log', isLog: true },
    { id: '#ircnet', name: 'ircnet', isLog: false, topic: 'IRCnet main channel.' },
  ],
};

const now = new Date();
const ago = (mins: number) => new Date(now.getTime() - mins * 60_000);

export const MOCK_MESSAGES: Record<string, Message[]> = {
  __log__: [
    { id: 1, nick: '', text: ':irc.libera.chat 001 reecord_user :Welcome to Libera.Chat IRC Network', timestamp: ago(10), isRaw: true },
    { id: 2, nick: '', text: ':irc.libera.chat 002 reecord_user :Your host is irc.libera.chat', timestamp: ago(10), isRaw: true },
    { id: 3, nick: '', text: 'PING :irc.libera.chat', timestamp: ago(5), isRaw: true },
    { id: 4, nick: '', text: 'PONG :irc.libera.chat', timestamp: ago(5), isRaw: true },
    { id: 5, nick: '', text: ':reecord_user!~u@host JOIN :#general', timestamp: ago(4), isRaw: true },
  ],
  '#general': [
    { id: 10, nick: 'Alice', text: 'hey everyone!', timestamp: ago(12) },
    { id: 11, nick: 'Bob', text: "what's up?", timestamp: ago(11) },
    { id: 12, nick: 'Alice', text: 'not much, you?', timestamp: ago(10) },
    { id: 13, nick: 'Carol', text: 'same old same old', timestamp: ago(8) },
    { id: 14, nick: 'Dave', text: 'anyone catch the game last night?', timestamp: ago(6) },
    { id: 15, nick: 'Bob', text: 'yeah it was wild', timestamp: ago(5) },
    { id: 16, nick: 'Alice', text: 'I missed it, what happened?', timestamp: ago(4) },
    { id: 17, nick: 'Carol', text: 'overtime win!', timestamp: ago(2) },
  ],
  '#random': [
    { id: 20, nick: 'Dave', text: 'has anyone tried that new coffee shop downtown?', timestamp: ago(30) },
    { id: 21, nick: 'Carol', text: 'yes! the cortado is amazing', timestamp: ago(28) },
    { id: 22, nick: 'Bob', text: 'I keep meaning to go', timestamp: ago(15) },
  ],
  '#help': [
    { id: 30, nick: 'Eve', text: 'how do I set my away message?', timestamp: ago(45) },
    { id: 31, nick: 'Alice', text: '/AWAY <message> — or /AWAY with no args to come back', timestamp: ago(44) },
    { id: 32, nick: 'Eve', text: 'thanks!', timestamp: ago(43) },
  ],
  '#ircnet': [
    { id: 40, nick: 'Mallory', text: 'hello from IRCnet', timestamp: ago(60) },
  ],
};

export const MOCK_USERS: Record<string, User[]> = {
  '#general': [
    { nick: 'Alice', isOp: true },
    { nick: 'Bob', isOp: true },
    { nick: 'Carol', isOp: false },
    { nick: 'Dave', isOp: false },
    { nick: 'reecord_user', isOp: false },
  ],
  '#random': [
    { nick: 'Bob', isOp: true },
    { nick: 'Carol', isOp: false },
    { nick: 'Dave', isOp: false },
  ],
  '#help': [
    { nick: 'Alice', isOp: true },
    { nick: 'Eve', isOp: false },
    { nick: 'reecord_user', isOp: false },
  ],
  '#ircnet': [
    { nick: 'Mallory', isOp: true },
    { nick: 'reecord_user', isOp: false },
  ],
};
