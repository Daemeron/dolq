import { IRC_PORT, IRC_TLS_PORT } from '../shared/ipc';

export type IrcUrlPrefill = {
  host: string;
  port: number;
  secure: boolean;
  channel?: string;
};

export function parseIrcUrl(raw: string): IrcUrlPrefill | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const secure = url.protocol === 'ircs:';
  if (!secure && url.protocol !== 'irc:') return null;
  if (!url.hostname) return null;

  const port = url.port ? Number(url.port) : secure ? IRC_TLS_PORT : IRC_PORT;

  const pathChannel = decodeURIComponent(url.pathname.replace(/^\//, ''));
  const hashChannel = decodeURIComponent(url.hash.replace(/^#/, ''));
  const name = (pathChannel || hashChannel).split(',')[0];

  return {
    host: url.hostname,
    port,
    secure,
    channel: name ? (name.startsWith('#') ? name : `#${name}`) : undefined,
  };
}
