// The Log view is meant for server-level traffic: anything that is already
// shown inside a channel or query window is hidden from it. The backend no
// longer stores those lines in the log (channelScopedLine in bouncer.go, keep
// the two in step), but they still arrive live, and older history has them.

const CHANNEL_NUMERICS = new Set(['324', '329', '332', '333', '353', '366']);
const ALWAYS_SCOPED = new Set(['PRIVMSG', 'JOIN', 'PART', 'KICK', 'QUIT', 'NICK', 'TOPIC', 'AWAY']);

function isChannelTarget(target: string | undefined): boolean {
  return !!target && /^[@+%&~!]*[#&]/.test(target);
}

export function isChannelScopedLine(line: string): boolean {
  const m = /^(?:@\S+ )?(?::\S+ )?(\S+)(?: (\S+))?(?: (\S+))?/.exec(line);
  if (!m) return false;
  const command = m[1].toUpperCase();
  if (ALWAYS_SCOPED.has(command)) return true;
  if (command === 'NOTICE' || command === 'MODE') return isChannelTarget(m[2]);
  // Numerics address us first, then the channel: ":srv 353 me = #chan :..." or ":srv 332 me #chan :...".
  if (CHANNEL_NUMERICS.has(command)) return true;
  return false;
}

// Where a server-level line that is not channel-scoped really belongs.
export type LogRoute =
  | { to: 'pm'; nick: string; text: string }
  | { to: 'channel'; channel: string; text: string }
  | { to: 'log'; important: boolean };

// Numerics that refuse something about one channel: "me #chan :Cannot join channel (+i)".
const CHANNEL_ERRORS = new Set([
  '403',
  '404',
  '405',
  '437',
  '441',
  '442',
  '467',
  '471',
  '472',
  '473',
  '474',
  '475',
  '476',
  '477',
  '478',
  '482',
]);

// A person's private notice (xdcc bots answer this way) belongs in their query
// window, a channel refusal in that channel, and only the rest stays in the Log.
export function routeLogLine(line: string): LogRoute {
  const m = /^(?:@\S+ )?(?::(\S+) )?(\S+) (.*)$/.exec(line);
  if (!m) return { to: 'log', important: false };
  const [, prefix = '', verb, params] = m;
  const command = verb.toUpperCase();
  const text = (params.match(/ :(.*)$/) ?? params.match(/^:(.*)$/))?.[1] ?? params;
  if (command === 'NOTICE' && prefix.includes('!')) {
    return { to: 'pm', nick: prefix.slice(0, prefix.indexOf('!')), text };
  }
  if (CHANNEL_ERRORS.has(command)) {
    const channel = params.split(/\s+/).find((p) => /^[#&]/.test(p));
    if (channel) return { to: 'channel', channel, text: `${channel}: ${text}` };
  }
  return { to: 'log', important: /^[45]\d\d$/.test(command) || command === 'ERROR' || command === 'KILL' };
}
