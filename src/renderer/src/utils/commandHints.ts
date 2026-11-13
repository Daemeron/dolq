export type CommandHint = { name: string; usage: string; desc: string; queryOnly?: boolean };

export const COMMAND_HINTS: CommandHint[] = [
  { name: 'join', usage: '/join #channel [key]', desc: 'Join a channel, with its key if it has one' },
  { name: 'part', usage: '/part [#channel] [reason]', desc: 'Leave a channel (this one by default)' },
  { name: 'leave', usage: '/leave [#channel] [reason]', desc: 'Same as /part' },
  { name: 'msg', usage: '/msg nick message', desc: 'Send a private message and open the chat' },
  { name: 'me', usage: '/me action', desc: 'Send an action, like "* you waves"' },
  { name: 'nick', usage: '/nick newnick', desc: 'Change your nickname' },
  { name: 'away', usage: '/away [reason]', desc: 'Mark yourself away; with no reason, come back' },
  { name: 'whois', usage: '/whois nick', desc: 'Look up who someone is' },
  { name: 'topic', usage: '/topic [text]', desc: 'Show or set the channel topic' },
  { name: 'mode', usage: '/mode [target] modes', desc: 'Change channel or user modes' },
  { name: 'kick', usage: '/kick nick [reason]', desc: 'Remove someone from the channel' },
  { name: 'invite', usage: '/invite nick [#channel]', desc: 'Invite someone to a channel' },
  { name: 'notice', usage: '/notice target message', desc: 'Send a notice, which bots do not auto-reply to' },
  { name: 'query', usage: '/query nick [message]', desc: 'Open a private chat, optionally with a first message' },
  { name: 'q', usage: '/q nick [message]', desc: 'Same as /query' },
  { name: 'ignore', usage: '/ignore nick', desc: 'Hide everything from someone' },
  { name: 'unignore', usage: '/unignore nick', desc: 'Stop ignoring someone' },
  { name: 'op', usage: '/op nick [nick…]', desc: 'Give channel operator status' },
  { name: 'deop', usage: '/deop nick [nick…]', desc: 'Take channel operator status away' },
  { name: 'voice', usage: '/voice nick [nick…]', desc: 'Let someone speak in a moderated channel' },
  { name: 'devoice', usage: '/devoice nick [nick…]', desc: 'Take voice away' },
  { name: 'ban', usage: '/ban mask', desc: 'Ban a nick!user@host mask from this channel' },
  { name: 'unban', usage: '/unban mask', desc: 'Lift a ban' },
  { name: 'list', usage: '/list [filter]', desc: 'List the channels on the server' },
  { name: 'names', usage: '/names [#channel]', desc: 'List who is in a channel' },
  { name: 'who', usage: '/who mask', desc: 'Search users by nick, host or channel' },
  { name: 'whowas', usage: '/whowas nick', desc: 'Look up someone who has left' },
  { name: 'userhost', usage: '/userhost nick', desc: "Show a nick's user@host" },
  { name: 'ison', usage: '/ison nick [nick…]', desc: 'Check which of these nicks are online' },
  { name: 'version', usage: '/version [nick]', desc: "Ask a person's client, or the server, for its version" },
  { name: 'ping', usage: '/ping nick', desc: 'Measure the round trip to someone' },
  { name: 'ctcp', usage: '/ctcp nick request', desc: 'Send a CTCP request, such as TIME or VERSION' },
  { name: 'motd', usage: '/motd', desc: "Show the server's message of the day" },
  { name: 'info', usage: '/info', desc: 'Show information about the server software' },
  { name: 'lusers', usage: '/lusers', desc: 'Show how many users and servers are connected' },
  { name: 'admin', usage: '/admin', desc: "Show the server administrator's details" },
  { name: 'time', usage: '/time', desc: "Show the server's local time" },
  { name: 'knock', usage: '/knock #channel [message]', desc: 'Ask for an invite to an invite-only channel' },
  { name: 'nickserv', usage: '/nickserv command', desc: 'Send a command to NickServ' },
  { name: 'ns', usage: '/ns command', desc: 'Same as /nickserv' },
  { name: 'chanserv', usage: '/chanserv command', desc: 'Send a command to ChanServ' },
  { name: 'cs', usage: '/cs command', desc: 'Same as /chanserv' },
  { name: 'cycle', usage: '/cycle', desc: 'Leave and rejoin this channel' },
  { name: 'rejoin', usage: '/rejoin', desc: 'Same as /cycle' },
  { name: 'kickban', usage: '/kickban nick [reason]', desc: 'Ban someone from this channel, then kick them' },
  { name: 'kb', usage: '/kb nick [reason]', desc: 'Same as /kickban' },
  { name: 'quit', usage: '/quit [reason]', desc: 'Leave the server, with a goodbye message' },
  { name: 'clear', usage: '/clear', desc: 'Empty this window (history on disk is kept)' },
  { name: 'help', usage: '/help [command]', desc: 'List the commands, or explain one' },
  { name: 'xdcc', usage: '/xdcc send #5 | batch 1-5', desc: 'Ask this bot for a pack', queryOnly: true },
  { name: 'alias', usage: '/alias name text', desc: 'Define a shortcut; $1..$9 and $* take arguments' },
  { name: 'unalias', usage: '/unalias name', desc: 'Remove a shortcut' },
  { name: 'connect', usage: '/connect', desc: 'Connect to this server' },
  { name: 'disconnect', usage: '/disconnect', desc: 'Disconnect from this server' },
  { name: 'raw', usage: '/raw line', desc: 'Send a raw IRC line to the server' },
  { name: 'quote', usage: '/quote line', desc: 'Same as /raw' },
];

// Commands to offer while the first word is still being typed.
export function suggestCommands(value: string, isQuery: boolean, aliasNames: string[] = []): CommandHint[] {
  const m = /^\/(\S*)$/.exec(value);
  if (!m) return [];
  const typed = m[1].toLowerCase();
  const all = [
    ...COMMAND_HINTS.filter((c) => isQuery || !c.queryOnly),
    ...aliasNames
      .filter((a) => !COMMAND_HINTS.some((c) => c.name === a))
      .map((name) => ({ name, usage: `/${name}`, desc: 'Your alias' })),
  ];
  return all.filter((c) => c.name.startsWith(typed) && !(c.name === typed && all.length === 1));
}

// What /help prints: every command name, or the usage and meaning of one.
export function helpText(arg: string, isQuery: boolean): string {
  const name = arg.replace(/^\//, '').toLowerCase();
  const hint = COMMAND_HINTS.find((c) => c.name === name);
  if (hint) return `${hint.usage}: ${hint.desc}`;
  const names = COMMAND_HINTS.filter((c) => isQuery || !c.queryOnly).map((c) => `/${c.name}`);
  return `Commands: ${names.join(' ')}. Type /help command for details.`;
}
