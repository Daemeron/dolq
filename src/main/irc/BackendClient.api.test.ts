import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendClient } from './BackendClient';

type Frame = { id: string; action: string; [k: string]: unknown };
type FakeSocket = Duplex & { written: Frame[] };

// One dialled connection whose replies the test chooses per action (default: plain ok).
const fake = vi.hoisted(() => ({
  sockets: [] as unknown[],
  reply: {} as Record<string, Record<string, unknown>>,
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
        const body = f.action === 'auth' ? { ok: true } : (fake.reply[f.action] ?? { ok: true });
        s.push(`${JSON.stringify({ id: f.id, type: 'result', ...body })}\n`);
        done();
      },
    }) as FakeSocket;
    s.written = [];
    Object.assign(s, { setKeepAlive: () => s });
    fake.sockets.push(s);
    process.nextTick(() => s.emit('connect'));
    return s;
  };
  return { ...actual, default: { ...actual, createConnection } };
});

const remote = { host: '127.0.0.1', port: 6789, tls: false, token: 'tok' };
const socket = () => fake.sockets.at(-1) as FakeSocket;
const lastRequest = () => socket().written.at(-1) as Frame;

describe('BackendClient requests', () => {
  let client: BackendClient;
  beforeEach(() => {
    fake.sockets.length = 0;
    fake.reply = {};
    client = new BackendClient(0, remote);
  });
  afterEach(async () => {
    await client.stop();
  });

  it('sends connect with every field the backend needs', async () => {
    await client.connect('s1', 'irc.example', 6697, 'me', true, 'u', 'p', 'user', 'Real', ['alt'], 'pw');
    expect(lastRequest()).toMatchObject({
      action: 'connect',
      serverId: 's1',
      host: 'irc.example',
      port: 6697,
      nick: 'me',
      secure: true,
      saslUser: 'u',
      saslPass: 'p',
      username: 'user',
      realname: 'Real',
      altNicks: ['alt'],
      password: 'pw',
    });
  });

  it('sends disconnect and raw lines', async () => {
    await client.disconnect('s1');
    expect(lastRequest()).toMatchObject({ action: 'disconnect', serverId: 's1' });
    await client.send('s1', 'JOIN #a');
    expect(lastRequest()).toMatchObject({ action: 'send', serverId: 's1', line: 'JOIN #a' });
  });

  it('rejects with the backend error when a call is refused', async () => {
    fake.reply.send = { ok: false, error: 'not connected' };
    await expect(client.send('s1', 'x')).rejects.toThrow('not connected');
  });

  it('reads status, joined channels and history, defaulting to empty answers', async () => {
    fake.reply.getStatus = { ok: true, status: 'connecting' };
    expect(await client.getStatus('s1')).toBe('connecting');
    fake.reply.getStatus = { ok: true };
    expect(await client.getStatus('s1')).toBe('disconnected');

    fake.reply.getJoinedChannels = { ok: true, channels: ['#a'] };
    expect(await client.getJoinedChannels('s1')).toEqual(['#a']);
    fake.reply.getJoinedChannels = { ok: true };
    expect(await client.getJoinedChannels('s1')).toEqual([]);

    fake.reply.getHistory = { ok: true, messages: [{ id: 1 }] };
    expect(await client.getHistory('s1', '#a', 5, 10)).toEqual([{ id: 1 }]);
    expect(lastRequest()).toMatchObject({ action: 'getHistory', channel: '#a', before: 5, limit: 10 });
    fake.reply.getHistory = { ok: true };
    expect(await client.getHistory('s1', '#a')).toEqual([]);

    fake.reply.search = { ok: true, messages: [{ id: 2 }] };
    expect(await client.search('s1', '#a', 'q', 7)).toEqual([{ id: 2 }]);
    expect(lastRequest()).toMatchObject({ action: 'search', query: 'q', limit: 7 });
    fake.reply.search = { ok: true };
    expect(await client.search('', '', 'q')).toEqual([]);
  });

  it('returns the DCC and XDCC ids the backend hands out, and surfaces failures', async () => {
    fake.reply.dccOffer = { ok: true, dccId: 'd1' };
    expect(await client.dccOffer('s1', 'mira', 1000, 2000)).toBe('d1');
    expect(lastRequest()).toMatchObject({ action: 'dccOffer', nick: 'mira', portMin: 1000, portMax: 2000 });

    fake.reply.dccAccept = { ok: true, dccId: 'd2' };
    expect(await client.dccAccept('1.2.3.4', 5000)).toBe('d2');
    expect(lastRequest()).toMatchObject({ action: 'dccAccept', host: '1.2.3.4', port: 5000 });

    fake.reply.xdccAccept = { ok: true, dccId: 'x1' };
    expect(await client.xdccAccept('s1', 'bot', '1.2.3.4', 5000, 'f.iso', 99, 'tok', '/dl', 1, 2)).toBe('x1');
    expect(lastRequest()).toMatchObject({
      action: 'xdccAccept',
      filename: 'f.iso',
      size: 99,
      destDir: '/dl',
      token: 'tok',
    });

    fake.reply.dccOffer = { ok: false, error: 'no route' };
    await expect(client.dccOffer('s1', 'mira', 0, 0)).rejects.toThrow('no route');
    fake.reply.dccAccept = { ok: false, error: 'refused' };
    await expect(client.dccAccept('h', 1)).rejects.toThrow('refused');
    fake.reply.xdccAccept = { ok: false, error: 'busy' };
    await expect(client.xdccAccept('s1', 'b', 'h', 1, 'f', 1, undefined, '/', 0, 0)).rejects.toThrow('busy');
  });

  it('sends the DCC/XDCC control calls', async () => {
    await client.dccSend('d1', 'hi');
    expect(lastRequest()).toMatchObject({ action: 'dccSend', dccId: 'd1', line: 'hi' });
    await client.dccClose('d1');
    expect(lastRequest()).toMatchObject({ action: 'dccClose', dccId: 'd1' });
    await client.xdccClose('x1');
    expect(lastRequest()).toMatchObject({ action: 'xdccClose', dccId: 'x1' });
    await client.xdccPause('x1');
    expect(lastRequest()).toMatchObject({ action: 'xdccPause', dccId: 'x1' });
    await client.xdccResume('x1');
    expect(lastRequest()).toMatchObject({ action: 'xdccResume', dccId: 'x1' });
  });
});

describe('BackendClient pushed frames', () => {
  let client: BackendClient;
  beforeEach(async () => {
    fake.sockets.length = 0;
    fake.reply = {};
    client = new BackendClient(0, remote);
    await client.getStatus('s1'); // wait until attached
  });
  afterEach(async () => {
    await client.stop();
  });

  const push = (frame: unknown) => socket().push(`${typeof frame === 'string' ? frame : JSON.stringify(frame)}\n`);

  it('re-emits lines, events and status changes with their server', async () => {
    const seen: unknown[][] = [];
    client.on('line', (...a) => seen.push(['line', ...a]));
    client.on('event', (...a) => seen.push(['event', ...a]));
    client.on('status', (...a) => seen.push(['status', ...a]));
    push({ type: 'line', serverId: 's1', line: ':srv NOTICE' });
    push({ type: 'event', serverId: 's1', event: { type: 'JOIN' } });
    push({ type: 'status', serverId: 's1', status: 'connected' });
    await vi.waitFor(() => expect(seen).toHaveLength(3));
    expect(seen).toEqual([
      ['line', 's1', ':srv NOTICE'],
      ['event', 's1', { type: 'JOIN' }],
      ['status', 's1', 'connected'],
    ]);
  });

  it('asks the user for an access token when the backend answers unauthorized', async () => {
    const fatals: string[] = [];
    client.on('fatal', (m: string) => fatals.push(m));
    push({ type: 'result', id: 'x', ok: false, error: 'unauthorized' });
    await vi.waitFor(() => expect(fatals[0]).toMatch(/requires an access token/));
  });

  it('survives an unreadable frame and a result without an id', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    push('{not json');
    push({ type: 'result', ok: true });
    push({ type: 'line', serverId: 's1', line: 'still alive' });
    const lines: string[] = [];
    client.on('line', (_id: string, line: string) => lines.push(line));
    push({ type: 'line', serverId: 's1', line: 'after' });
    await vi.waitFor(() => expect(lines).toContain('after'));
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
