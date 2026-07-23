import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mocks = vi.hoisted(() => ({
  socketWrite: vi.fn(),
  socketConnect: vi.fn(),
  socketEnd: vi.fn(),
  socketDestroy: vi.fn(),
  socketOn: vi.fn(),
  socketOnce: vi.fn((_event: string, cb: () => void) => cb()),
  readerOn: vi.fn(),
  readerClose: vi.fn(),
}));

vi.mock('node:net', () => ({
  default: {
    Socket: class MockSocket {
      write = mocks.socketWrite;
      connect = mocks.socketConnect;
      end = mocks.socketEnd;
      destroy = mocks.socketDestroy;
      on = mocks.socketOn;
      once = mocks.socketOnce;
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

import { IrcClient, PING_TIMEOUT_MS, PING_TIMEOUT_CHECK_INTERVAL_MS } from './IrcClient.js';

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

  it('strips a leading forward slash from the message', async () => {
    await client.send('/JOIN #test');
    expect(mocks.socketWrite).toHaveBeenCalledWith('JOIN #test\r\n', expect.any(Function));
  });

  it('preserves forward slashes elsewhere in the message', async () => {
    await client.send('PRIVMSG #chan :see https://example.com');
    expect(mocks.socketWrite).toHaveBeenCalledWith(
      'PRIVMSG #chan :see https://example.com\r\n', expect.any(Function),
    );
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
    expect(written).toContain('USER mynick 0 * Dolq IRC Client\r\n');
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

describe('IrcClient PING timeout detection', () => {
  let client: IrcClient;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    // Default socketOnce auto-invokes the 'close' callback immediately, which would
    // clear the timeout-check interval before these tests get to advance it - these
    // tests care about a close that hasn't happened yet, so don't auto-fire it.
    mocks.socketOnce.mockImplementation(vi.fn());
    client = new IrcClient('localhost', 6667, 'testnick');
    client.connect();
  });

  afterEach(() => {
    vi.useRealTimers();
    // Restore the default auto-invoking behavior so later describe blocks (which
    // rely on `once('close', cb)` resolving immediately) aren't affected.
    mocks.socketOnce.mockImplementation((_event: string, cb: () => void) => cb());
  });

  function lineHandler(): (line: string) => void {
    const lineCall = mocks.readerOn.mock.calls.find((call: any[]) => call[0] === 'line');
    return lineCall![1] as (line: string) => void;
  }

  it('destroys the socket once no data has arrived for longer than the timeout', () => {
    vi.advanceTimersByTime(PING_TIMEOUT_MS + PING_TIMEOUT_CHECK_INTERVAL_MS);
    expect(mocks.socketDestroy).toHaveBeenCalledWith(expect.any(Error));
  });

  it('does not destroy the socket before the timeout has elapsed', () => {
    vi.advanceTimersByTime(PING_TIMEOUT_MS - PING_TIMEOUT_CHECK_INTERVAL_MS);
    expect(mocks.socketDestroy).not.toHaveBeenCalled();
  });

  it('resets the timeout clock whenever a line is received', () => {
    const onLine = lineHandler();
    // Nearly time out, then receive a line just before the deadline...
    vi.advanceTimersByTime(PING_TIMEOUT_MS - PING_TIMEOUT_CHECK_INTERVAL_MS);
    onLine('PING :irc.example.net');
    // ...advancing the same distance again should not be enough to time out now.
    vi.advanceTimersByTime(PING_TIMEOUT_MS - PING_TIMEOUT_CHECK_INTERVAL_MS);
    expect(mocks.socketDestroy).not.toHaveBeenCalled();
  });

  it('stops checking once the socket closes', () => {
    // The interval-clearing handler is the one registered via `once`, not the
    // reader-closing one `connect()` registers via `on`.
    const closeCall = mocks.socketOnce.mock.calls.find((call: any[]) => call[0] === 'close');
    const onClose = closeCall![1] as () => void;
    onClose();

    vi.advanceTimersByTime(PING_TIMEOUT_MS * 2);
    expect(mocks.socketDestroy).not.toHaveBeenCalled();
  });
});

describe('IrcClient NAMES accumulation', () => {
  let client: IrcClient;

  function eventHandler(): (line: string) => void {
    const lineCalls = mocks.readerOn.mock.calls.filter((call: any[]) => call[0] === 'line');
    return lineCalls[1][1] as (line: string) => void;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('localhost', 6667, 'testnick');
    client.connect();
  });

  it('combines multiple 353 replies into one names event on 366', () => {
    const events: any[] = [];
    client.addEventListener((e) => events.push(e));
    const onLine = eventHandler();

    onLine(':irc.example.net 353 testnick = #general :alice @bob');
    onLine(':irc.example.net 353 testnick = #general :carol');
    expect(events).toEqual([]);

    onLine(':irc.example.net 366 testnick #general :End of /NAMES list.');
    expect(events).toEqual([{
      type: 'names',
      channel: '#general',
      users: [
        { nick: 'alice', privilege: 'none' },
        { nick: 'bob', privilege: 'op' },
        { nick: 'carol', privilege: 'none' },
      ],
    }]);
  });

  it('emits an empty names list when 366 arrives with no preceding 353', () => {
    const events: any[] = [];
    client.addEventListener((e) => events.push(e));
    const onLine = eventHandler();

    onLine(':irc.example.net 366 testnick #empty :End of /NAMES list.');
    expect(events).toEqual([{ type: 'names', channel: '#empty', users: [] }]);
  });
});

describe('IrcClient nick tracking', () => {
  let client: IrcClient;

  function eventHandler(): (line: string) => void {
    const lineCalls = mocks.readerOn.mock.calls.filter((call: any[]) => call[0] === 'line');
    return lineCalls[1][1] as (line: string) => void;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('localhost', 6667, 'testnick');
    client.connect();
  });

  it('updates the tracked nick when the server confirms our own NICK change', () => {
    const onLine = eventHandler();
    onLine(':testnick!u@host NICK :newnick');
    expect((client as any).nick).toBe('newnick');
  });

  it('ignores NICK events for other users', () => {
    const onLine = eventHandler();
    onLine(':someoneelse!u@host NICK :othernick');
    expect((client as any).nick).toBe('testnick');
  });
});

describe('IrcClient joined-channel tracking', () => {
  let client: IrcClient;

  function eventHandler(): (line: string) => void {
    const lineCalls = mocks.readerOn.mock.calls.filter((call: any[]) => call[0] === 'line');
    return lineCalls[1][1] as (line: string) => void;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.socketWrite.mockImplementation((_data: string, cb: (err?: Error) => void) => cb());
    client = new IrcClient('localhost', 6667, 'testnick');
    client.connect();
  });

  it('tracks a channel once we join it', () => {
    const onLine = eventHandler();
    onLine(':testnick!u@host JOIN #general');
    expect(client.getJoinedChannels()).toEqual(['#general']);
  });

  it('ignores JOIN events for other users', () => {
    const onLine = eventHandler();
    onLine(':someoneelse!u@host JOIN #general');
    expect(client.getJoinedChannels()).toEqual([]);
  });

  it('drops the channel when we PART it', () => {
    const onLine = eventHandler();
    onLine(':testnick!u@host JOIN #general');
    onLine(':testnick!u@host PART #general');
    expect(client.getJoinedChannels()).toEqual([]);
  });

  it('drops the channel when we get KICKed from it', () => {
    const onLine = eventHandler();
    onLine(':testnick!u@host JOIN #general');
    onLine(':alice!u@host KICK #general testnick :bye');
    expect(client.getJoinedChannels()).toEqual([]);
  });

  it('keeps the channel when someone else gets KICKed', () => {
    const onLine = eventHandler();
    onLine(':testnick!u@host JOIN #general');
    onLine(':alice!u@host KICK #general bob :bye');
    expect(client.getJoinedChannels()).toEqual(['#general']);
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

  it('PARTs every joined channel before sending QUIT', async () => {
    client.connect();
    const lineCalls = mocks.readerOn.mock.calls.filter((call: any[]) => call[0] === 'line');
    const onLine = lineCalls[1][1] as (line: string) => void;
    onLine(':testnick!u@host JOIN #general');
    onLine(':testnick!u@host JOIN #random');
    mocks.socketWrite.mockClear();

    await client.disconnect();

    expect(mocks.socketWrite).toHaveBeenCalledWith('PART #general\r\n', expect.any(Function));
    expect(mocks.socketWrite).toHaveBeenCalledWith('PART #random\r\n', expect.any(Function));
    const quitCallIndex = mocks.socketWrite.mock.calls.findIndex((c: any[]) => c[0] === 'QUIT\r\n');
    const partCallIndexes = mocks.socketWrite.mock.calls
      .map((c: any[], i: number) => (c[0].startsWith('PART') ? i : -1))
      .filter((i: number) => i !== -1);
    expect(partCallIndexes.every((i: number) => i < quitCallIndex)).toBe(true);
  });
});
