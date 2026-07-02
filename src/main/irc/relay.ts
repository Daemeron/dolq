import net from 'net';

export class Relay {
  private server: net.Server;
  private connections = new Set<net.Socket>();

  constructor(server: net.Server) {
    this.server = server;
  }

  public start(): void {
    this.server.on('connection', (socket) => {
      this.connections.add(socket);

      socket.on('close', () => this.connections.delete(socket));
      socket.on('error', (err) => {
        console.error('Relay client error:', err.message);
        this.connections.delete(socket);
        socket.destroy();
      });
    });
  }

  public relay(msg: string): void {
    for (const socket of this.connections) {
      socket.write(`${msg}\r\n`);
    }
  }
}
