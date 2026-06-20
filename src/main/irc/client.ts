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
      this.send(`USER ${this.nick} 0 * Reecord IRC Client`),
    ]).catch((err) => console.error('IRC handshake error:', err.message));
    this.keepAlive();
    this.parseEvents();
  }

  public async disconnect(): Promise<void> {
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
      this.emit(event);
    });
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
