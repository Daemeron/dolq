import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendClient } from './BackendClient';
import { redialDelay } from './redial';

type FakeSocket = Duplex & {
  written: { id: string; action: string; authToken?: string }[];
  keepAlive?: [boolean, number];
};

// Every dialled connection, newest last. Each answers auth (as fake.authOk
// says) and getStatus by itself; anything else is left pending. With
// fake.refuse set, dialling fails instead.
const fake = vi.hoisted(() => ({
  sockets: [] as FakeSocket[],
  authOk: true,
  refuse: false,
  answerPings: false,
  // An older backend answers getInfo with an error.
  infoUnknown: false,
  info: {
    version: '1.2.3',
    uptimeMs: 1000,
    clients: 1,
    sessions: 2,
    transfers: 0,
    folders: [{ name: 'data', path: '/data', free: 50, total: 100 }],
  },
}));

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
        if (f.action === 'getInfo' && fake.answerPings) {
          const answer = fake.infoUnknown
            ? { ok: false, error: 'unknown action: getInfo' }
            : { ok: true, info: fake.info };
          s.push(`${JSON.stringify({ id: f.id, type: 'result', ...answer })}\n`);
        }
        if (f.action === 'getStatus')
          s.push(`${JSON.stringify({ id: f.id, type: 'result', ok: true, status: 'connected' })}\n`);
        done();
      },
    }) as FakeSocket;
    s.written = [];
    Object.assign(s, {
      setKeepAlive(enable: boolean, delay: number) {
        s.keepAlive = [enable, delay];
        return s;
      },
    });
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
  client.on('state', (s: { status: string; detail: string }) => {
    if (s.status === 'failed') fatals.push(s.detail);
  });
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
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
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
    expect(err).toHaveBeenCalledWith('backend redial failed:', expect.objectContaining({ message: 'ECONNREFUSED' }));
    err.mockRestore();
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

  it('turns on TCP keepalive so a silently dead link is noticed', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    expect(fake.sockets[0].keepAlive).toEqual([true, 30_000]);
    await client.stop();
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

describe('BackendClient: state and recovery', () => {
  beforeEach(() => {
    fake.sockets.length = 0;
    fake.authOk = true;
    fake.refuse = false;
    fake.answerPings = false;
    fake.infoUnknown = false;
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval'] });
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('says in plain words that it is connected, and keeps a log of how it got there', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    const state = client.getState();
    expect(state).toMatchObject({
      mode: 'remote',
      address: '127.0.0.1:6789',
      status: 'connected',
      detail: 'Connected to 127.0.0.1:6789.',
    });
    expect(state.log.map((l) => l.text)).toEqual(['Connecting to 127.0.0.1:6789…', 'Connected to 127.0.0.1:6789.']);
    await client.stop();
  });

  it('explains an unreachable backend, keeps trying, and connects once it is up', async () => {
    fake.refuse = true;
    const client = new BackendClient(0, remote);
    await vi.waitFor(() => expect(client.getState().status).toBe('reconnecting'));
    expect(client.getState().detail).toMatch(/Could not reach 127\.0\.0\.1:6789.*Trying again in 1s/);
    fake.refuse = false;
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(client.getState().status).toBe('connected'));
    await client.stop();
  });

  it('notices a backend that stops answering, and reconnects', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.sockets[0].written.some((f) => f.action === 'getInfo')).toBe(true);
    await vi.advanceTimersByTimeAsync(10_000);
    await vi.waitFor(() => expect(client.getState().status).toBe('reconnecting'));
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(fake.sockets).toHaveLength(2));
    expect(client.getState().log.map((l) => l.text)).toContain('The backend stopped answering. Reconnecting…');
    await client.stop();
  });

  it('keeps the link while the backend answers its checks', async () => {
    fake.answerPings = true;
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    await vi.advanceTimersByTimeAsync(20_000 * 5);
    expect(fake.sockets).toHaveLength(1);
    expect(client.getState().status).toBe('connected');
    await client.stop();
  });

  it('records each round trip, and what the backend says about itself', async () => {
    fake.answerPings = true;
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    expect(client.getState()).toMatchObject({ latency: [], info: undefined, infoSupported: true });
    await vi.advanceTimersByTimeAsync(20_000);
    const state = client.getState();
    expect(state.latency).toHaveLength(1);
    expect(state.latency[0].ms).toBeGreaterThanOrEqual(0);
    expect(state.info).toEqual(fake.info);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.getState().latency).toHaveLength(2);
    await client.stop();
  });

  it('keeps the link to a backend too old to report on itself, and says so', async () => {
    fake.answerPings = true;
    fake.infoUnknown = true;
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.getState()).toMatchObject({ status: 'connected', info: undefined, infoSupported: false });
    expect(client.getState().latency).toHaveLength(1);
    expect(fake.sockets).toHaveLength(1);
    await client.stop();
  });

  it('counts the times the link was made again, and says since when it is up', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    const first = client.getState();
    expect(first.reconnects).toBe(0);
    expect(first.connectedSince).toBeGreaterThan(0);

    fake.sockets[0].destroy();
    await vi.waitFor(() => expect(client.getState().status).toBe('reconnecting'));
    expect(client.getState().connectedSince).toBeUndefined();
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(client.getState().status).toBe('connected'));
    expect(client.getState().reconnects).toBe(1);
    expect(client.getState().connectedSince).toBeGreaterThan(0);
    await client.stop();
  });

  it('keeps the count of drops when Reconnect is pressed, but not for another backend', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    fake.sockets[0].destroy();
    await vi.waitFor(() => expect(client.getState().status).toBe('reconnecting'));
    await vi.advanceTimersByTimeAsync(redialDelay(0));
    await vi.waitFor(() => expect(client.getState().reconnects).toBe(1));

    client.reconnect();
    await vi.waitFor(() => expect(client.getState().status).toBe('connected'));
    expect(client.getState().reconnects).toBe(1);

    client.retarget({ ...remote, port: 7000 });
    expect(client.getState().reconnects).toBe(0);
    await client.stop();
  });

  it('starts the figures over for another backend', async () => {
    fake.answerPings = true;
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    await vi.advanceTimersByTimeAsync(20_000);
    expect(client.getState().latency).toHaveLength(1);
    client.retarget({ ...remote, port: 7000 });
    expect(client.getState()).toMatchObject({ latency: [], info: undefined, reconnects: 0 });
    await client.stop();
  });

  it('switches to another backend while running, and tells the app to catch up', async () => {
    const client = new BackendClient(0, remote);
    await client.getStatus('s1');
    let reconnected = 0;
    client.on('reconnected', () => reconnected++);
    client.retarget({ ...remote, port: 7000 });
    await vi.waitFor(() => expect(reconnected).toBe(1));
    expect(fake.sockets[0].destroyed).toBe(true);
    expect(client.getState()).toMatchObject({ address: '127.0.0.1:7000', status: 'connected' });
    await client.stop();
  });

  it('recovers from a refused token once pointed at the backend again with the right one', async () => {
    fake.authOk = false;
    const client = new BackendClient(0, { ...remote, token: 'wrong' });
    await vi.waitFor(() => expect(client.getState().status).toBe('failed'));
    expect(client.getState().detail).toMatch(/refused the access token/);
    fake.authOk = true;
    client.retarget(remote);
    await vi.waitFor(() => expect(client.getState().status).toBe('connected'));
    await client.stop();
  });
});

describe('redialDelay', () => {
  it('doubles from a second up to half a minute', () => {
    expect([0, 1, 2, 3, 4, 5, 6].map(redialDelay)).toEqual([1000, 2000, 4000, 8000, 16000, 30000, 30000]);
  });
});
