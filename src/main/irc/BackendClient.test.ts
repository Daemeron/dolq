import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendClient } from './BackendClient';
import { redialDelay } from './redial';

type FakeSocket = Duplex & { written: { id: string; action: string; authToken?: string }[] };

// Every dialled connection, newest last. Each answers auth (as fake.authOk
// says) and getStatus by itself; anything else is left pending. With
// fake.refuse set, dialling fails instead.
const fake = vi.hoisted(() => ({ sockets: [] as FakeSocket[], authOk: true, refuse: false }));

vi.mock('electron', () => ({ app: {} }));

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  const { Duplex } = await import('node:stream');
  const createConnection = () => {
    const s = new Duplex({
      read() {},
      write(chunk, _enc, done) {
        const f = JSON.parse(chunk.toString());
        s.written.push(f);
        if (f.action === 'auth') s.push(`${JSON.stringify({ id: f.id, type: 'result', ok: fake.authOk })}\n`);
        if (f.action === 'getStatus')
          s.push(`${JSON.stringify({ id: f.id, type: 'result', ok: true, status: 'connected' })}\n`);
        done();
      },
    }) as FakeSocket;
    s.written = [];
    fake.sockets.push(s);
    process.nextTick(() => (fake.refuse ? s.emit('error', new Error('ECONNREFUSED')) : s.emit('connect')));
    return s;
  };
  return { ...actual, default: { ...actual, createConnection } };
});

const remote = { host: '127.0.0.1', port: 6789, tls: false, token: 'tok' };

function record(client: BackendClient) {
  const statuses: [string, string][] = [];
  const fatals: string[] = [];
  client.on('status', (id: string, status: string) => statuses.push([id, status]));
  client.on('fatal', (message: string) => fatals.push(message));
  return { statuses, fatals };
}

describe('BackendClient', () => {
  beforeEach(() => {
    fake.sockets.length = 0;
    fake.authOk = true;
    fake.refuse = false;
    vi.useFakeTimers({ toFake: ['setTimeout'] });
  });
  afterEach(() => vi.useRealTimers());

  it('redials a dropped remote backend, authenticates again and says so', async () => {
    const client = new BackendClient(0, remote);
    const { statuses, fatals } = record(client);
    let reconnected = 0;
    client.on('reconnected', () => reconnected++);
    expect(await client.getStatus('s1')).toBe('connected');

    const inFlight = client.send('s1', 'PRIVMSG #a :hi');
    await vi.waitFor(() => expect(fake.sockets[0].written.some((f) => f.action === 'send')).toBe(true));
    fake.sockets[0].destroy();
    await expect(inFlight).rejects.toThrow('backend connection closed');
    expect(statuses).toEqual([['s1', 'connecting']]);
    await expect(client.send('s1', 'PRIVMSG #a :hi')).rejects.toThrow('backend not connected');

    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(reconnected).toBe(1));
    expect(fake.sockets[1].written).toEqual([expect.objectContaining({ action: 'auth', authToken: 'tok' })]);
    expect(await client.getStatus('s1')).toBe('connected');
    expect(fatals).toEqual([]);
    await client.stop();
  });

  it('keeps retrying while the backend is unreachable, waiting longer each time', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    fake.refuse = true;
    fake.sockets[0].destroy();
    await vi.advanceTimersByTimeAsync(redialDelay(0) - 1);
    expect(fake.sockets).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(redialDelay(1) - 1);
    expect(fake.sockets).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(fake.sockets).toHaveLength(3);
    await client.stop();
  });

  it('gives up and reports it when the backend refuses the token on redial', async () => {
    const client = new BackendClient(0, remote);
    const { statuses, fatals } = record(client);
    await client.getStatus('s1');
    fake.authOk = false;
    fake.sockets[0].destroy();
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(fatals.some((m) => m.includes('refused the access token'))).toBe(true));
    expect(statuses.at(-1)).toEqual(['s1', 'disconnected']);
    await vi.advanceTimersByTimeAsync(redialDelay(5));
    expect(fake.sockets).toHaveLength(2);
  });

  it('does not redial after stop', async () => {
    const client = new BackendClient(0, remote);
    const { statuses } = record(client);
    await client.getStatus('s1');
    await client.stop();
    fake.sockets[0].destroy();
    await vi.advanceTimersByTimeAsync(redialDelay(5));
    expect(fake.sockets).toHaveLength(1);
    expect(statuses).toEqual([]);
  });
});

describe('redialDelay', () => {
  it('doubles from a second up to half a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(redialDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
