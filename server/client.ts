export class Client {
  private connection: Deno.TcpConn;
  private buffer: Uint8Array;
  private bufferSize: number;
  private log = "";
  private encoder = new TextEncoder();
  private decoder = new TextDecoder();

  constructor(connection: Deno.TcpConn, bufferSize: number = 1024) {
    this.connection = connection;
    this.bufferSize = bufferSize;
    this.buffer = new Uint8Array(this.bufferSize);
  }

  private async connect() {
    try {
      let leftover = "";
      while (true) {
        const bytesRead = await this.connection.read(this.buffer);
        if (bytesRead === null) {
          break;
        }
        const buff = this.buffer.subarray(0, bytesRead);
        const chunk = this.decoder.decode(buff);
        const output = leftover + chunk;
        const lines = output.split("\r\n");
        leftover = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("PING")) {
            await this.send(`PONG ${line.split(" ")[1]}`);
          }
        }
        this.print(chunk);
      }
    } finally {
      this.connection.close();
    }
  }

  public async start() {
    this.connect();
    await this.negotiate();
  }

  public async send(msg: string) {
    await this.connection.write(this.encoder.encode(`${msg}\r\n`));
  }

  public print(chunk: string) {
    this.log += chunk;
    console.log(chunk);
  }

  private async negotiate() {
    await this.send("PASS none");
    await this.send("NICK DaeMachine");
    await this.send("USER machine 0 * daepc");
  }
}
