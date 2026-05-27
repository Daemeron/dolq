import net from 'node:net';
import readline from 'node:readline';

export class IrcClient {
  private nick: string;
  private host: string;
  private port: number;
  private socket: net.Socket;
  private reader: readline.Interface;

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
    this.send('PASS none');
    this.send(`NICK ${this.nick}`);
    this.send(`USER ${this.nick} 0 * Reecord IRC Client`);
    this.keepAlive();

  }

  public async disconnect(): Promise<void> {
    await this.send('QUIT');
    this.socket.end();
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

  public send(msg: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const line = msg.replaceAll('/', '');
      this.socket.write(`${line}\r\n`, (err) => {
        if (err) reject(err);
        else resolve();
      })
    });
  }
}
