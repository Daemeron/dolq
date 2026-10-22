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
