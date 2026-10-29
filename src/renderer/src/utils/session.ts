import type { Message } from '../types';

// The lines the backend writes when a connection ends (see bouncer.go): the next line belongs to a new session.
const SESSION_END = /^\*\*\* (Disconnected|Connection lost)/;

/** True for the first line after a connection ended, so the server log can set one session apart from the next. */
export function startsNewSession(prev: Message | undefined): boolean {
  return !!prev && SESSION_END.test(prev.text);
}
