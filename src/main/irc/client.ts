import net from 'node:net';
import readline from 'node:readline';
import { parseIrcLine, type User } from './parseLine.js';
import type { IrcEvent } from '../../shared/ipc';

export class IrcClient {
  private nick: string;
  private host: string;
  private port: number;
  private socket: net.Socket;
  private reader: readline.Interface;
  private eventListeners: ((event: IrcEvent) => void)[] = [];
  private namesBuffer: Map<string, User[]> = new Map();
  private joinedChannels: Set<string> = new Set();

  constructor(host: string, port: number, nick: string) {
    this.host = host;
    this.port = port;
    this.nick = nick;
    this.socket = new net.Socket();
    this.reader = readline.createInterface({ input: this.socket, crlfDelay: Infinity });
  }

  public connect(): void {
    this.socket.connect({ host: this.host, port: this.port });
    this.socket.on('close', () => this.reader.close());
    this.socket.on('error', (err) => {
      console.error('IRC socket error:', err.message);
    });
    Promise.all([
      this.send('PASS none'),
      this.send(`NICK ${this.nick}`),
      this.send(`USER ${this.nick} 0 * Dolq IRC Client`),
    ]).catch((err) => console.error('IRC handshake error:', err.message));
    this.keepAlive();
    this.parseEvents();
  }

  public async disconnect(): Promise<void> {
    await Promise.all([...this.joinedChannels].map((channel) => this.send(`PART ${channel}`)));
    await this.send('QUIT');
    this.socket.end();
    await new Promise<void>((resolve) => this.socket.once('close', resolve));
  }

  private keepAlive(): void {
    this.reader.on('line', (line) => {
      if (line.startsWith('PING')) {
        this.send(`PONG ${line.split(' ')[1]}`);
      }
    });
  }

  public addLineListener(onLine: (line: string) => void): void {
    this.reader.on('line', onLine);
  }

  private parseEvents(): void {
    this.reader.on('line', (line) => {
      const event = parseIrcLine(line);
      if (!event) return;

      if (event.type === 'NAMREPLY') {
        const existing = this.namesBuffer.get(event.channel) ?? [];
        this.namesBuffer.set(event.channel, [...existing, ...event.users]);
        return;
      }
      if (event.type === 'ENDOFNAMES') {
        const users = this.namesBuffer.get(event.channel) ?? [];
        this.namesBuffer.delete(event.channel);
        this.emit({ type: 'names', channel: event.channel, users });
        return;
      }
      if (event.type === 'NICK' && event.oldNick === this.nick) {
        this.nick = event.newNick;
      }
      if (event.type === 'JOIN' && event.nick === this.nick) {
        this.joinedChannels.add(event.channel);
      }
      if (event.type === 'PART' && event.nick === this.nick) {
        this.joinedChannels.delete(event.channel);
      }
      if (event.type === 'KICK' && event.nick === this.nick) {
        this.joinedChannels.delete(event.channel);
      }
      this.emit(event);
    });
  }

  // Lets a freshly (re)loaded renderer verify it's still actually in the channels
  // it remembers joining - e.g. after a dev-mode reload, or after being kicked
  // while no renderer was around to see the KICK event.
  public getJoinedChannels(): string[] {
    return [...this.joinedChannels];
  }

  private emit(event: IrcEvent): void {
    this.eventListeners.forEach((cb) => cb(event));
  }

  public addEventListener(cb: (event: IrcEvent) => void): void {
    this.eventListeners.push(cb);
  }

  public onClose(cb: () => void): void {
    this.socket.once('close', cb);
  }

  public send(msg: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const line = msg.replace(/^\//, '');
      this.socket.write(`${line}\r\n`, (err) => {
        if (err) reject(err);
        else resolve();
      })
    });
  }
}
