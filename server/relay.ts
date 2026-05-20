export class Relay {
  private listener: Deno.TcpListener;
  private connections = new Set<Deno.TcpConn>();
  private encoder = new TextEncoder();

  constructor(listener: Deno.TcpListener) {
    this.listener = listener;
  }

  private async accept() {
    try {
      const client = await this.listener.accept();
      this.connections.add(client);
    } finally {
      for (const client of this.connections) {
        client.close();
      }
      this.listener.close();
    }
  }

  public async start() {
    this.accept();
    await this.relay("");
  }

  public async relay(msg: string) {
    for (const client of this.connections) {
      await client.write(this.encoder.encode(msg));
    }
  }
}
