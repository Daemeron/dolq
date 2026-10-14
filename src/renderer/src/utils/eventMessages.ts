import type { IrcEvent } from '../../../shared/ipc';

export type EventDescription = {
  text: string;
  // Join/part/quit/nick lines for other users, which can be hidden in Preferences.
  membership?: boolean;
};

function withReason(reason?: string): string {
  return reason ? ` (${reason})` : '';
}

function describeModes(changes: Extract<IrcEvent, { type: 'MODE' }>['changes']): string {
  const granted = changes.filter((c) => c.granted);
  const revoked = changes.filter((c) => !c.granted);
  const flag = (c: { privilege: string }) =>
    ({ owner: 'q', admin: 'a', op: 'o', halfop: 'h', voice: 'v' })[c.privilege] ?? c.privilege;
  const part = (sign: '+' | '-', list: typeof changes) =>
    list.length === 0 ? '' : `${sign}${list.map(flag).join('')} ${list.map((c) => c.nick).join(' ')}`;
  return [part('+', granted), part('-', revoked)].filter(Boolean).join(' ');
}

// Text for an event that belongs in a channel's message list, or null when the
// event is not shown there.
export function describeEvent(event: IrcEvent, selfNick: string): EventDescription | null {
  switch (event.type) {
    case 'JOIN':
      return event.nick === selfNick
        ? { text: `You joined ${event.channel}` }
        : { text: `${event.nick} joined`, membership: true };
    case 'PART':
      return event.nick === selfNick
        ? { text: `You left ${event.channel}${withReason(event.reason)}` }
        : { text: `${event.nick} left${withReason(event.reason)}`, membership: true };
    case 'KICK':
      return event.nick === selfNick
        ? { text: `You were kicked by ${event.by}${event.reason ? `: ${event.reason}` : ''}` }
        : { text: `${event.nick} was kicked by ${event.by}${withReason(event.reason)}` };
    case 'QUIT':
      return { text: `${event.nick} quit${withReason(event.reason)}`, membership: event.nick !== selfNick };
    case 'NICK':
      return event.oldNick === selfNick
        ? { text: `You are now known as ${event.newNick}` }
        : { text: `${event.oldNick} is now known as ${event.newNick}`, membership: true };
    case 'MODE': {
      const modes = describeModes(event.changes);
      if (!modes) return null;
      return { text: `${event.by ?? 'Server'} sets mode ${modes}` };
    }
    case 'TOPIC':
      return event.nick
        ? { text: `${event.nick} changed the topic to: ${event.topic}` }
        : { text: `Topic: ${event.topic}` };
    case 'SYSTEM':
      return { text: event.text };
    default:
      return null;
  }
}

// Channels (of the event's server) that should show the event. QUIT and NICK
// carry the channels the user shared with us; everything else names one.
export function eventChannels(event: IrcEvent): string[] {
  switch (event.type) {
    case 'JOIN':
    case 'PART':
    case 'KICK':
    case 'MODE':
    case 'TOPIC':
    case 'SYSTEM':
      return [event.channel];
    case 'QUIT':
    case 'NICK':
      return event.channels ?? [];
    default:
      return [];
  }
}
