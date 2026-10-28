import { type ChildProcessWithoutNullStreams, execFile, spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { createInterface } from 'node:readline';
import tls from 'node:tls';
import { promisify } from 'node:util';
import { app } from 'electron';
import type { ConnectionStatus, HistoryEntry, IrcEvent } from '../../shared/ipc';
import { decideTrust, insecureReasons, type RemoteHooks, type RemoteTarget } from '../remoteBackend';
import { PermanentError, redial } from './redial';
import { stopChild } from './stopChild';

const execFileAsync = promisify(execFile);

interface ServerFrame {
  id?: string;
  type: 'result' | 'line' | 'event' | 'status';
  serverId?: string;
  line?: string;
  event?: IrcEvent;
  status?: ConnectionStatus;
  channels?: string[];
  messages?: HistoryEntry[];
  dccId?: string;
  ok?: boolean;
  error?: string;
}

type Pending = { resolve: (f: ServerFrame) => void; reject: (err: Error) => void };

export class BackendClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private socket?: net.Socket;
  private pending = new Map<string, Pending>();
  private devBinaryPath?: string;
  private ready: Promise<void>;
  private stopping = false;
  // Servers this client attached to, shown as connecting while a redial is under way.
  private servers = new Set<string>();

  constructor(
    private retentionDays: number,
    private remote?: RemoteTarget,
    private hooks?: RemoteHooks,
  ) {
    super();
    this.ready = this.remote ? this.connectRemote(this.remote) : this.spawnAndDial();
    this.ready.catch((err) => {
      console.error('backend failed to connect:', err);
      this.emit('fatal', err instanceof Error ? err.message : String(err));
    });
  }

  private async spawnAndDial(): Promise<void> {
    const { cmd, args, cwd, devBinaryPath } = await resolveBackendCommand(this.retentionDays);
    this.devBinaryPath = devBinaryPath;
    // Only this process and the child it starts know the token, so nothing else
    // on the machine can use the socket even if its permissions were too open.
    const token = randomBytes(32).toString('hex');
    const child = spawn(cmd, args, { cwd, env: { ...process.env, DOLQ_TOKEN: token } });
    this.child = child;
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[dolqd] ${chunk}`));

    const socketPath = await new Promise<string>((resolve, reject) => {
      createInterface({ input: child.stdout }).once('line', resolve);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`dolqd exited before reporting a socket (code ${code})`)));
    });

    const socket = await new Promise<net.Socket>((resolve, reject) => {
      const s = net.createConnection(socketPath);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
    await this.attach(socket, token);
  }

  private async connectRemote(remote: RemoteTarget, agreed = false): Promise<void> {
    // Running without TLS and/or a token is allowed (a backend started with
    // -tls=false / -token=false, a tunnel, a trusted LAN), but only after the user has agreed.
    const reasons = insecureReasons(remote);
    if (reasons.length > 0 && !agreed) {
      const ok = (await this.hooks?.confirmInsecure(remote.host, reasons)) ?? false;
      if (!ok) throw new Error('Connection to the remote backend cancelled (it is not fully secured).');
    }
    const socket = remote.tls ? await this.dialTls(remote) : await this.dialPlain(remote);
    await this.attach(socket, remote.token);
  }

  private dialPlain(remote: RemoteTarget): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = net.createConnection(remote.port, remote.host);
      s.once('connect', () => resolve(s));
      s.once('error', reject);
    });
  }

  // Connects without letting Node reject self-signed certificates, then
  // decides trust itself (see decideTrust): a pinned fingerprint must match,
  // otherwise a CA-valid certificate passes and a self-signed one is asked about.
  private dialTls(remote: RemoteTarget): Promise<net.Socket> {
    return new Promise((resolve, reject) => {
      const s = tls.connect({
        host: remote.host,
        port: remote.port,
        servername: net.isIP(remote.host) ? undefined : remote.host,
        rejectUnauthorized: false,
      });
      s.once('error', reject);
      s.once('secureConnect', async () => {
        const fingerprint = s.getPeerCertificate().fingerprint256 ?? '';
        const decision = decideTrust({ authorized: s.authorized, pinned: remote.fingerprint, fingerprint });
        if (decision === 'mismatch') {
          s.destroy();
          reject(
            new PermanentError(
              `The remote backend's certificate changed (now ${fingerprint}). If you did not expect that, someone may be intercepting the connection. Paste its pairing link in Preferences to trust the new certificate.`,
            ),
          );
          return;
        }
        if (decision === 'prompt') {
          const ok = (await this.hooks?.confirmTrust(fingerprint, remote.host)) ?? false;
          if (!ok) {
            s.destroy();
            reject(new PermanentError('The remote backend certificate was not trusted.'));
            return;
          }
          this.hooks?.onPin(fingerprint);
          // so a redial does not ask again
          if (this.remote) this.remote = { ...this.remote, fingerprint };
        }
        resolve(s);
      });
    });
  }

  // Wires up an established, trusted connection and authenticates it before
  // anything else is sent; the backend drops connections that skip this.
  // Requests only go out on it once that is done.
  private async attach(socket: net.Socket, token?: string): Promise<void> {
    // Without keepalive a link that dies silently (sleep, a NAT timeout) never
    // closes, so the redial below would never start.
    socket.setKeepAlive(true, 30_000);
    const lines = createInterface({ input: socket });
    lines.on('line', (line) => {
      try {
        this.handleFrame(JSON.parse(line));
      } catch (err) {
        console.error('backend sent an unreadable frame:', err);
      }
    });
    // readline re-emits its input's errors, and an unhandled one would crash the app; the socket's own handler below logs it.
    lines.on('error', () => {});
    socket.on('error', (err) => console.error('backend connection error:', err));
    socket.on('close', () => {
      this.rejectAllPending(new Error('backend connection closed'));
      // Closed before it was ready: whoever was attaching it gets the error above.
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.lost();
    });
    // No token: a backend that does not ask for one. If it does, the first call fails as unauthorized.
    if (token) {
      await new Promise<void>((resolve, reject) => {
        const id = randomUUID();
        this.pending.set(id, {
          resolve: (f) =>
            f.ok ? resolve() : reject(new PermanentError(`The backend refused the access token (${f.error}).`)),
          reject,
        });
        socket.write(`${JSON.stringify({ id, action: 'auth', authToken: token })}\n`);
      });
    }
    this.socket = socket;
  }

  // The connection dropped. A local backend that went away has crashed, so say
  // so; a remote one is redialled until it answers again, then 'reconnected'
  // tells the app to attach to its sessions again (getStatus) and catch up.
  private lost(): void {
    if (this.stopping) return;
    const remote = this.remote;
    for (const id of this.servers) this.emit('status', id, remote ? 'connecting' : 'disconnected');
    if (!remote) {
      this.emit('fatal', 'The Dolq backend stopped unexpectedly. Restart Dolq to reconnect.');
      return;
    }
    redial(
      () => this.connectRemote(this.remote ?? remote, true),
      () => this.stopping,
    ).then(
      (connected) => {
        if (connected) this.emit('reconnected');
      },
      (err) => {
        for (const id of this.servers) this.emit('status', id, 'disconnected');
        this.emit('fatal', err instanceof Error ? err.message : String(err));
      },
    );
  }

  connect(
    serverId: string,
    host: string,
    port: number,
    nick: string,
    secure: boolean,
    saslUser?: string,
    saslPass?: string,
    username?: string,
    realname?: string,
    altNicks?: string[],
    password?: string,
  ): Promise<void> {
    this.servers.add(serverId);
    return this.call('connect', {
      serverId,
      host,
      port,
      nick,
      secure,
      saslUser,
      saslPass,
      username,
      realname,
      altNicks,
      password,
    });
  }

  disconnect(serverId: string): Promise<void> {
    return this.call('disconnect', { serverId });
  }

  send(serverId: string, line: string): Promise<void> {
    return this.call('send', { serverId, line });
  }

  async getStatus(serverId: string): Promise<ConnectionStatus> {
    this.servers.add(serverId);
    const f = await this.request('getStatus', { serverId });
    return f.status ?? 'disconnected';
  }

  async getJoinedChannels(serverId: string): Promise<string[]> {
    const f = await this.request('getJoinedChannels', { serverId });
    return f.channels ?? [];
  }

  async getHistory(serverId: string, channel: string, before?: number, limit?: number): Promise<HistoryEntry[]> {
    const f = await this.request('getHistory', { serverId, channel, before, limit });
    return f.messages ?? [];
  }

  async search(serverId: string, channel: string, query: string, limit?: number): Promise<HistoryEntry[]> {
    const f = await this.request('search', { serverId, channel, query, limit });
    return f.messages ?? [];
  }

  async dccOffer(serverId: string, nick: string, portMin: number, portMax: number): Promise<string> {
    const f = await this.request('dccOffer', { serverId, nick, portMin, portMax });
    if (!f.ok) throw new Error(f.error);
    return f.dccId ?? '';
  }

  async dccAccept(ip: string, port: number): Promise<string> {
    const f = await this.request('dccAccept', { host: ip, port });
    if (!f.ok) throw new Error(f.error);
    return f.dccId ?? '';
  }

  dccSend(dccId: string, line: string): Promise<void> {
    return this.call('dccSend', { dccId, line });
  }

  dccClose(dccId: string): Promise<void> {
    return this.call('dccClose', { dccId });
  }

  async xdccAccept(
    serverId: string,
    nick: string,
    ip: string,
    port: number,
    filename: string,
    size: number,
    token: string | undefined,
    destDir: string,
    portMin: number,
    portMax: number,
  ): Promise<string> {
    const f = await this.request('xdccAccept', {
      serverId,
      nick,
      host: ip,
      port,
      filename,
      size,
      token,
      destDir,
      portMin,
      portMax,
    });
    if (!f.ok) throw new Error(f.error);
    return f.dccId ?? '';
  }

  xdccClose(dccId: string): Promise<void> {
    return this.call('xdccClose', { dccId });
  }

  xdccPause(dccId: string): Promise<void> {
    return this.call('xdccPause', { dccId });
  }

  xdccResume(dccId: string): Promise<void> {
    return this.call('xdccResume', { dccId });
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.remote) {
      this.socket?.end();
      return;
    }
    const child = this.child;
    if (!child) return;
    await stopChild(child, 12_000);
    if (this.devBinaryPath) await fs.promises.rm(this.devBinaryPath, { force: true });
  }

  private async call(action: string, fields: Record<string, unknown>): Promise<void> {
    const f = await this.request(action, fields);
    if (!f.ok) throw new Error(f.error);
  }

  private async request(action: string, fields: Record<string, unknown>): Promise<ServerFrame> {
    await this.ready;
    if (!this.socket) return Promise.reject(new Error('backend not connected'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket?.write(`${JSON.stringify({ id, action, ...fields })}\n`);
    });
  }

  private handleFrame(f: ServerFrame): void {
    switch (f.type) {
      case 'result':
        if (f.error === 'unauthorized') {
          this.emit('fatal', 'The backend requires an access token. Paste its pairing link in Preferences.');
        }
        if (!f.id) return;
        this.pending.get(f.id)?.resolve(f);
        this.pending.delete(f.id);
        return;
      case 'line':
        this.emit('line', f.serverId, f.line);
        return;
      case 'event':
        this.emit('event', f.serverId, f.event);
        return;
      case 'status':
        this.emit('status', f.serverId, f.status);
        return;
    }
  }

  private rejectAllPending(err: Error): void {
    for (const p of this.pending.values()) p.reject(err);
    this.pending.clear();
  }
}

async function resolveBackendCommand(
  retentionDays: number,
): Promise<{ cmd: string; args: string[]; cwd: string; devBinaryPath?: string }> {
  const args = ['-retention-days', String(retentionDays)];
  if (app.isPackaged) {
    const exe = process.platform === 'win32' ? 'dolqd.exe' : 'dolqd';
    return { cmd: path.join(process.resourcesPath, 'bin', exe), args, cwd: process.resourcesPath };
  }
  const backendDir = path.resolve(__dirname, '../../backend');
  const devBinaryPath = path.join(app.getPath('temp'), `dolqd-dev-${process.pid}`);
  await execFileAsync('go', ['build', '-o', devBinaryPath, './cmd/dolqd'], { cwd: backendDir });
  return { cmd: devBinaryPath, args, cwd: backendDir, devBinaryPath };
}
