// DOLQ_DEBUG_IPC=1 prints the two conversations the app has with itself, to the terminal it was started from:
//   window <-> main process   (Electron IPC: window.irc.* and what is pushed back)
//   main process <-> backend  (the JSON lines of docs/network/wire-protocol.md)
// Secrets are blanked first, so a pasted trace can be shared.
import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { IrcMessages } from '../shared/ipc';

export type Print = (line: string) => void;
export type Direction = 'window → main' | 'main → window' | 'app → backend' | 'backend → app';

const HIDDEN = '«hidden»';
const MAX = 400;

export function ipcDebugEnabled(env: NodeJS.ProcessEnv): boolean {
  return ['1', 'true', 'yes', 'on'].includes((env.DOLQ_DEBUG_IPC ?? '').trim().toLowerCase());
}

// Fields that hold a secret, wherever they sit in an object. (A DCC "token" is public, it is not one of them.)
const SECRET_KEYS = new Set(['authtoken', 'remotetoken', 'password', 'saslpass', 'saslpassword']);

// A chat line that carries a password: identifying to services, or the server's own PASS, OPER and AUTHENTICATE.
const SERVICES_SECRET =
  /^(PRIVMSG|NOTICE) (\S*serv|\S*@\S*) :(identify|login|auth|register|group|ghost|release|recover)\b.*/i;
const PLAIN_SECRET = /^(PASS|OPER|AUTHENTICATE) .*/i;

/** A raw IRC line with anything secret in it blanked. */
export function redactLine(line: string): string {
  const bare = line.replace(/^\//, '');
  const services = bare.match(SERVICES_SECRET);
  if (services) return `${services[1]} ${services[2]} :${services[3]} ${HIDDEN}`;
  const plain = bare.match(PLAIN_SECRET);
  if (plain) return `${plain[1]} ${HIDDEN}`;
  return line;
}

/** A value from a message, with secrets blanked at any depth, and raw lines checked. */
export function redactValue(value: unknown, key = ''): unknown {
  if (SECRET_KEYS.has(key.toLowerCase())) return value === undefined || value === '' ? value : HIDDEN;
  if (key === 'line' && typeof value === 'string') return redactLine(value);
  if (Array.isArray(value)) return value.map((v) => redactValue(v));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redactValue(v, k)]));
  }
  return value;
}

// Calls whose arguments are positional and secret: connect(serverId, host, port, nick, secure, saslUser, saslPass,
// username, realname, altNicks, password).
const SECRET_ARGS: Record<string, number[]> = { [IrcMessages.connect]: [5, 6, 10] };

/** The arguments of an IPC call, ready to print. */
export function redactArgs(channel: string, args: unknown[]): unknown[] {
  const positional = SECRET_ARGS[channel] ?? [];
  return args.map((a, i) => {
    if (positional.includes(i)) return a === undefined || a === '' ? a : HIDDEN;
    if (channel === IrcMessages.send && i === 1 && typeof a === 'string') return redactLine(a);
    return redactValue(a);
  });
}

/** A frame of the wire protocol (one JSON line) with secrets blanked. */
export function redactFrame(text: string): string {
  try {
    return JSON.stringify(redactValue(JSON.parse(text)));
  } catch {
    return text;
  }
}

export function shorten(text: string, max = MAX): string {
  return text.length > max ? `${text.slice(0, max)}… (+${text.length - max} characters)` : text;
}

const clock = (d: Date) => d.toTimeString().slice(0, 8) + d.toISOString().slice(19, 23);

/** One line of the trace. */
export function formatTrace(at: Date, direction: Direction, what: string): string {
  const layer = direction.includes('backend') ? '[backend]' : '[ipc]    ';
  return `${clock(at)} ${layer} ${direction.padEnd(13)} ${what}`;
}

function show(value: unknown): string {
  if (value === undefined) return '(nothing)';
  return shorten(typeof value === 'string' ? JSON.stringify(value) : (JSON.stringify(value) ?? String(value)));
}

/** Wraps ipcMain.handle so every call from the window, and what it answered, is printed. Install before handlers register. */
export function installIpcTap(ipc: Pick<IpcMain, 'handle'>, print: Print, now: () => Date = () => new Date()): void {
  const handle = ipc.handle.bind(ipc);
  ipc.handle = ((channel: string, listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) =>
    handle(channel, async (event: IpcMainInvokeEvent, ...args: unknown[]) => {
      print(formatTrace(now(), 'window → main', `${channel} ${show(redactArgs(channel, args))}`));
      try {
        const result = await listener(event, ...args);
        print(formatTrace(now(), 'main → window', `reply to ${channel}: ${show(redactValue(result))}`));
        return result;
      } catch (err) {
        print(
          formatTrace(now(), 'main → window', `${channel} failed: ${err instanceof Error ? err.message : String(err)}`),
        );
        throw err;
      }
    })) as typeof ipc.handle;
}

/** What is pushed from the main process to the window. */
export function traceWindowSend(
  print: Print,
  channel: string,
  args: unknown[],
  now: () => Date = () => new Date(),
): void {
  print(formatTrace(now(), 'main → window', `${channel} ${show(redactArgs(channel, args))}`));
}

/** One frame between the app and a backend, `text` being the JSON line. */
export function traceFrame(
  print: Print,
  direction: 'app → backend' | 'backend → app',
  text: string,
  now: () => Date = () => new Date(),
): void {
  print(formatTrace(now(), direction, shorten(redactFrame(text.trimEnd()))));
}
