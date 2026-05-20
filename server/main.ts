import { Client } from "./client.ts";
import { Relay } from "./relay.ts";

const listener = await Deno.listen({ port: 6667, transport: "tcp" });
const relay = new Relay(listener);
const connection = await Deno.connect({
  hostname: "127.0.0.1",
  port: 6667,
  transport: "tcp",
});
const client = new Client(connection, 1024, relay);
await client.start();
