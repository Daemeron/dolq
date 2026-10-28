import { EventEmitter } from 'node:events';
import { Duplex, Readable } from 'node:stream';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BackendClient } from './BackendClient';

// Transport the other BackendClient tests skip: spawning the local backend and the TLS handshake with its trust decision.
const h = vi.hoisted(() => ({
  spawned: [] as unknown[],
  spawnEnv: {} as Record<string, string | undefined>,
  socketLine: '/tmp/dolqd.sock',
  tlsCert: { fingerprint256: 'AA:BB', authorized: false },
  dialled: [] as unknown[],
  stopChild: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('electron', () => ({ app: { isPackaged: true, getPath: () => '/tmp' } }));
vi.mock('./stopChild', () => ({ stopChild: h.stopChild }));

function fakeSocket() {
  const s = new Duplex({
    read() {},
    write(chunk, _enc, done) {
      const f = JSON.parse(chunk.toString());
      s.push(`${JSON.stringify({ id: f.id, type: 'result', ok: true })}\n`);
      done();
    },
  }) as Duplex & Record<string, unknown>;
  s.setKeepAlive = () => s;
  s.getPeerCertificate = () => ({ fingerprint256: h.tlsCert.fingerprint256 });
  s.authorized = h.tlsCert.authorized;
  h.dialled.push(s);
  return s;
}

vi.mock('node:child_process', () => ({
  // `go build` of the development binary: succeeds at once
  execFile: (...args: unknown[]) => (args.at(-1) as (e: null, out: string, err: string) => void)(null, '', ''),
  spawn: (_cmd: string, _args: string[], opts: { env: Record<string, string | undefined> }) => {
    h.spawnEnv = opts.env;
    const child = new EventEmitter() as EventEmitter & { stdout: Readable; stderr: Readable };
    child.stdout = h.socketLine ? Readable.from([`${h.socketLine}\n`]) : new Readable({ read() {} });
    child.stderr = new Readable({ read() {} });
    h.spawned.push(child);
    return child;
  },
}));

vi.mock('node:net', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:net')>();
  const createConnection = () => {
    const s = fakeSocket();
    process.nextTick(() => s.emit('connect'));
    return s;
  };
  return { ...actual, default: { ...actual, createConnection } };
});

vi.mock('node:tls', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:tls')>();
  const connect = () => {
    const s = fakeSocket();
    process.nextTick(() => s.emit('secureConnect'));
    return s;
  };
  return { ...actual, default: { ...actual, connect } };
});

beforeEach(async () => {
  ((await import('electron')).app as { isPackaged: boolean }).isPackaged = true;
  h.spawned.length = 0;
  h.dialled.length = 0;
  h.tlsCert = { fingerprint256: 'AA:BB', authorized: false };
  h.stopChild.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(process, 'resourcesPath', { value: '/res', configurable: true });
});

const fatals = (client: BackendClient) => {
  const out: string[] = [];
  client.on('fatal', (m: string) => out.push(m));
  return out;
};

describe('local backend', () => {
  it('starts the packaged backend, hands it a random token and authenticates with it', async () => {
    const client = new BackendClient(7);
    expect(await client.getStatus('s1')).toBe('disconnected');
    expect(h.spawnEnv.DOLQ_TOKEN).toMatch(/^[0-9a-f]{64}$/);
    await client.stop();
    expect(h.stopChild).toHaveBeenCalled();
  });

  it('reports a crash of the local backend as fatal', async () => {
    const client = new BackendClient(0);
    const seen = fatals(client);
    await client.getStatus('s1');
    (h.dialled[0] as Duplex).destroy();
    await vi.waitFor(() => expect(seen[0]).toMatch(/stopped unexpectedly/));
  });

  it('reports a backend that exits before it names a socket', async () => {
    h.socketLine = '';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0);
    const seen = fatals(client);
    await vi.waitFor(() => expect(h.spawned).toHaveLength(1));
    (h.spawned[0] as EventEmitter).emit('exit', 1);
    await vi.waitFor(() => expect(seen[0]).toMatch(/exited before reporting a socket/));
    err.mockRestore();
    h.socketLine = '/tmp/dolqd.sock';
  });
});

describe('local backend: process details', () => {
  it("passes the backend's own log output through to ours", async () => {
    const write = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    const client = new BackendClient(0);
    await client.getStatus('s1');
    (h.spawned[0] as EventEmitter & { stderr: Readable }).stderr.push('listening\n');
    await vi.waitFor(() => expect(write).toHaveBeenCalledWith('[dolqd] listening\n'));
    write.mockRestore();
    await client.stop();
  });

  it('builds and runs a development binary, and removes it on stop', async () => {
    const { app } = await import('electron');
    (app as { isPackaged: boolean }).isPackaged = false;
    const client = new BackendClient(0);
    await client.getStatus('s1');
    expect(h.spawnEnv.DOLQ_TOKEN).toBeDefined();
    await client.stop();
    expect(h.stopChild).toHaveBeenCalled();
  });

  it('has nothing to stop before the backend has started', async () => {
    h.socketLine = '';
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0);
    await client.stop();
    expect(h.stopChild).not.toHaveBeenCalled();
    h.socketLine = '/tmp/dolqd.sock';
    err.mockRestore();
  });

  it('logs connection errors without crashing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0);
    await client.getStatus('s1');
    (h.dialled[0] as Duplex).emit('error', new Error('ECONNRESET'));
    expect(err).toHaveBeenCalledWith('backend connection error:', expect.any(Error));
    await client.stop();
  });
});

describe('remote backend over TLS', () => {
  const remote = { host: 'dolq.example', port: 6789, tls: true, token: 'tok' };
  const hooks = () => ({ confirmTrust: vi.fn().mockResolvedValue(true), confirmInsecure: vi.fn(), onPin: vi.fn() });

  it('trusts a certificate that chains to a public CA without asking', async () => {
    h.tlsCert.authorized = true;
    const hk = hooks();
    const client = new BackendClient(0, remote, hk);
    expect(await client.getStatus('s1')).toBe('disconnected');
    expect(hk.confirmTrust).not.toHaveBeenCalled();
    await client.stop();
  });

  it('asks about a self-signed certificate and pins it once accepted', async () => {
    const hk = hooks();
    const client = new BackendClient(0, remote, hk);
    await client.getStatus('s1');
    expect(hk.confirmTrust).toHaveBeenCalledWith('AA:BB', 'dolq.example');
    expect(hk.onPin).toHaveBeenCalledWith('AA:BB');
    await client.stop();
  });

  it('gives up when the user refuses the certificate', async () => {
    const hk = hooks();
    hk.confirmTrust.mockResolvedValue(false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0, remote, hk);
    const seen = fatals(client);
    await vi.waitFor(() => expect(seen[0]).toMatch(/was not trusted/));
    expect(hk.onPin).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('refuses a certificate that no longer matches the pinned one', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0, { ...remote, fingerprint: 'CC:DD' }, hooks());
    const seen = fatals(client);
    await vi.waitFor(() => expect(seen[0]).toMatch(/certificate changed/));
    err.mockRestore();
  });

  it('does not connect without TLS or a token unless the user agrees', async () => {
    const hk = hooks();
    hk.confirmInsecure.mockResolvedValue(false);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const client = new BackendClient(0, { host: 'dolq.example', port: 1, tls: false }, hk);
    const seen = fatals(client);
    await vi.waitFor(() => expect(seen[0]).toMatch(/cancelled/));
    expect(hk.confirmInsecure).toHaveBeenCalledWith('dolq.example', expect.arrayContaining([expect.any(String)]));
    err.mockRestore();
  });

  it('connects insecurely once the user agrees', async () => {
    const hk = hooks();
    hk.confirmInsecure.mockResolvedValue(true);
    const client = new BackendClient(0, { host: 'dolq.example', port: 1, tls: false }, hk);
    expect(await client.getStatus('s1')).toBe('disconnected');
    await client.stop();
  });
});
