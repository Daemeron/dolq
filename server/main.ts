import { Client } from "./client.ts";

const connection = await Deno.connect({
  hostname: "127.0.0.1",
  port: 6667,
  transport: "tcp",
});
const client = new Client(connection);
await client.start();
