import { describe, it, expect, vi, beforeEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  socketWrite: vi.fn(),
  socketConnect: vi.fn(),
  socketEnd: vi.fn(),
  socketOn: vi.fn(),
  readerOn: vi.fn(),
  readerClose: vi.fn(),
}));

vi.mock('node:net', () => ({
  default: {
    Socket: class MockSocket {
      write = mocks.socketWrite;
      connect = mocks.socketConnect;
      end = mocks.socketEnd;
      on = mocks.socketOn;
    },
  },
}));

vi.mock('node:readline', () => ({
  default: {
    createInterface: () => ({
      on: mocks.readerOn,
      close: mocks.readerClose,
    }),
  },
}));

import { IrcClient } from './client.js';

describe('IrcClient.send()', () => {
  let client: IrcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new IrcClient('localhost', 6667, 'testnick');
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
  });

  it('writes the message with \\r\\n appended', async () => {
    await client.send('NICK testnick');
    expect(mocks.socketWrite).toHaveBeenCalledWith('NICK testnick\r\n', expect.any(Function));
  });

  it('strips forward slashes from the message', async () => {
    await client.send('/JOIN #test');
    expect(mocks.socketWrite).toHaveBeenCalledWith('JOIN #test\r\n', expect.any(Function));
  });

  it('resolves when the socket write succeeds', async () => {
    await expect(client.send('PING :server')).resolves.toBeUndefined();
  });

  it('rejects when the socket write fails', async () => {
    const err = new Error('write error');
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb(err));
    await expect(client.send('PING :server')).rejects.toThrow('write error');
  });
});

describe('IrcClient.connect()', () => {
  let client: IrcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('irc.libera.chat', 6667, 'mynick');
  });

  it('calls socket.connect with host and port', () => {
    client.connect();
    expect(mocks.socketConnect).toHaveBeenCalledWith({ host: 'irc.libera.chat', port: 6667 });
  });

  it('sends NICK and USER handshake messages', () => {
    client.connect();
    const written = mocks.socketWrite.mock.calls.map((call: any[]) => call[0]);
    expect(written).toContain('NICK mynick\r\n');
    expect(written).toContain('USER mynick 0 * Reecord IRC Client\r\n');
  });

  it('registers a close handler on the socket', () => {
    client.connect();
    const closeCall = mocks.socketOn.mock.calls.find((call: any[]) => call[0] === 'close');
    expect(closeCall).toBeDefined();
  });
});

describe('IrcClient PING/PONG keepAlive', () => {
  let client: IrcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('localhost', 6667, 'testnick');
    client.connect();
  });

  it('responds to PING with PONG using the server token', () => {
    const lineCall = mocks.readerOn.mock.calls.find((call: any[]) => call[0] === 'line');
    expect(lineCall).toBeDefined();
    const lineHandler = lineCall![1] as (line: string) => void;

    vi.clearAllMocks();

    lineHandler('PING :irc.libera.chat');
    expect(mocks.socketWrite).toHaveBeenCalledWith('PONG :irc.libera.chat\r\n', expect.any(Function));
  });

  it('ignores non-PING lines', () => {
    const lineCall = mocks.readerOn.mock.calls.find((call: any[]) => call[0] === 'line');
    const lineHandler = lineCall![1] as (line: string) => void;

    vi.clearAllMocks();
    lineHandler(':nick!user@host PRIVMSG #chan :hello');
    expect(mocks.socketWrite).not.toHaveBeenCalled();
  });
});

describe('IrcClient.disconnect()', () => {
  let client: IrcClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('localhost', 6667, 'testnick');
  });

  it('sends QUIT and ends the socket', async () => {
    await client.disconnect();
    expect(mocks.socketWrite).toHaveBeenCalledWith('QUIT\r\n', expect.any(Function));
    expect(mocks.socketEnd).toHaveBeenCalled();
  });
});
