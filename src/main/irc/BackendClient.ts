import { ChildProcessWithoutNullStreams, execFile, spawn } from 'child_process';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'events';
import { app } from 'electron';
import fs from 'fs';
import net from 'net';
import path from 'path';
import { createInterface } from 'readline';
import { promisify } from 'util';
import { ConnectionStatus, HistoryEntry, IrcEvent } from '../../shared/ipc';

const execFileAsync = promisify(execFile);

// Mirrors backend/internal/ipcproto.ServerFrame.
interface ServerFrame {
  id?: string;
  type: 'result' | 'line' | 'event' | 'status';
  serverId?: string;
  line?: string;
  event?: IrcEvent;
  status?: ConnectionStatus;
  channels?: string[];
  messages?: HistoryEntry[];
  ok?: boolean;
  error?: string;
}

type Pending = { resolve: (f: ServerFrame) => void; reject: (err: Error) => void };

// Spawns the `dolqd` backend and talks its newline-delimited-JSON protocol
// over a Unix domain socket (backend/internal/ipcproto). One connection is
// shared for every server the renderer opens - the backend already
// namespaces its unsolicited line/event/status frames by serverId, so this
// just fans them out via 'line'/'event'/'status' events.
export class BackendClient extends EventEmitter {
  private child?: ChildProcessWithoutNullStreams;
  private socket?: net.Socket;
  private pending = new Map<string, Pending>();
  private devBinaryPath?: string; // set in dev only, see resolveBackendCommand
  // Connecting takes a beat (dev mode builds dolqd first), so it starts in
  // the background at construction time rather than in an awaited start() -
  // callers (ipcMain handlers) can register immediately and each request
  // just waits its turn on this instead of racing it.
  private ready: Promise<void>;

  constructor(private retentionDays: number) {
    super();
    this.ready = this.spawnAndDial();
    this.ready.catch((err) => console.error('dolqd failed to start:', err));
  }

  private async spawnAndDial(): Promise<void> {
    const { cmd, args, cwd, devBinaryPath } = await resolveBackendCommand(this.retentionDays);
    this.devBinaryPath = devBinaryPath;
    const child = spawn(cmd, args, { cwd });
    this.child = child;
    child.stderr.on('data', (chunk: Buffer) => process.stderr.write(`[dolqd] ${chunk}`));

    // Discovery contract: dolqd prints its socket path as the first (and
    // only) line of stdout once it's listening.
    const socketPath = await new Promise<string>((resolve, reject) => {
      createInterface({ input: child.stdout }).once('line', resolve);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`dolqd exited before reporting a socket (code ${code})`)));
    });

    this.socket = await new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(socketPath);
      socket.once('connect', () => resolve(socket));
      socket.once('error', reject);
    });

    createInterface({ input: this.socket }).on('line', (line) => this.handleFrame(JSON.parse(line)));
    this.socket.on('close', () => this.rejectAllPending(new Error('dolqd connection closed')));
  }

  connect(
    serverId: string,
    host: string,
    port: number,
    nick: string,
    secure: boolean,
    saslUser?: string,
    saslPass?: string,
  ): Promise<void> {
    return this.call('connect', { serverId, host, port, nick, secure, saslUser, saslPass });
  }

  disconnect(serverId: string): Promise<void> {
    return this.call('disconnect', { serverId });
  }

  send(serverId: string, line: string): Promise<void> {
    return this.call('send', { serverId, line });
  }

  async getStatus(serverId: string): Promise<ConnectionStatus> {
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

  // Signals dolqd to shut down (which itself disconnects every session,
  // flushes any still-queued history writes, and prunes its socket file
  // cleanly - see bouncer.Shutdown and history.Store.Close) and waits for it
  // to exit.
  async stop(): Promise<void> {
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 12_000);
      child.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
      // SIGTERM only gets a graceful shutdown out of dolqd on
      // POSIX - Windows has no real signal delivery, so this force-kills
      // there instead. Fine until Windows packaging (ROADMAP milestone 5)
      // is actually verified. (This relies on `child` being the real dolqd
      // binary, not a `go run` wrapper that won't forward the signal to
      // it - see resolveBackendCommand.)
      child.kill('SIGTERM');
    });
    if (this.devBinaryPath) await fs.promises.rm(this.devBinaryPath, { force: true });
  }

  private async call(action: string, fields: Record<string, unknown>): Promise<void> {
    const f = await this.request(action, fields);
    if (!f.ok) throw new Error(f.error);
  }

  private async request(action: string, fields: Record<string, unknown>): Promise<ServerFrame> {
    await this.ready;
    if (!this.socket) return Promise.reject(new Error('backend not started'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket!.write(JSON.stringify({ id, action, ...fields }) + '\n');
    });
  }

  private handleFrame(f: ServerFrame): void {
    switch (f.type) {
      case 'result':
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
  // Build to a real binary and spawn that directly, the same as the
  // packaged path above - not `go run`, which wraps the actual binary in a
  // child process of its own and (at least on this project's dev setup)
  // doesn't forward SIGTERM/SIGINT to it, silently breaking the graceful
  // shutdown stop() depends on to flush queued history writes. One `go
  // build` up front costs about what `go run` was already paying to
  // compile before executing, so there's no real slowdown.
  const backendDir = path.resolve(__dirname, '../../backend');
  const devBinaryPath = path.join(app.getPath('temp'), `dolqd-dev-${process.pid}`);
  await execFileAsync('go', ['build', '-o', devBinaryPath, './cmd/dolqd'], { cwd: backendDir });
  return { cmd: devBinaryPath, args, cwd: backendDir, devBinaryPath };
}
