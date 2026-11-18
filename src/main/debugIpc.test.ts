import { describe, expect, it } from 'vitest';
import { IrcMessages } from '../shared/ipc';
import {
  formatTrace,
  installIpcTap,
  ipcDebugEnabled,
  redactArgs,
  redactFrame,
  redactLine,
  redactValue,
  shorten,
  traceFrame,
  traceWindowSend,
} from './debugIpc';

const AT = new Date('2026-11-17T10:20:30.456Z');

describe('ipcDebugEnabled', () => {
  it.each(['1', 'true', 'TRUE', 'yes', 'on', ' 1 '])('is on for %j', (v) => {
    expect(ipcDebugEnabled({ DOLQ_DEBUG_IPC: v })).toBe(true);
  });
  it.each([undefined, '', '0', 'false', 'no', 'off', 'banana'])('is off for %j', (v) => {
    expect(ipcDebugEnabled({ DOLQ_DEBUG_IPC: v })).toBe(false);
  });
});

describe('redactLine', () => {
  it.each([
    ['PRIVMSG NickServ :IDENTIFY hunter2', 'PRIVMSG NickServ :IDENTIFY «hidden»'],
    [
      'PRIVMSG nickserv@services.rizon.net :identify me hunter2',
      'PRIVMSG nickserv@services.rizon.net :identify «hidden»',
    ],
    ['/PRIVMSG NickServ :register hunter2 me@example.org', 'PRIVMSG NickServ :register «hidden»'],
    ['NOTICE ChanServ :recover #chan hunter2', 'NOTICE ChanServ :recover «hidden»'],
    ['PASS hunter2', 'PASS «hidden»'],
    ['OPER admin hunter2', 'OPER «hidden»'],
    ['AUTHENTICATE AGFsaWNlAGh1bnRlcjI=', 'AUTHENTICATE «hidden»'],
  ])('hides the secret in %j', (line, shown) => {
    expect(redactLine(line)).toBe(shown);
  });

  it.each(['PRIVMSG #chat :identify yourself, please', 'PRIVMSG alice :auth is fun', 'JOIN #dolq', 'PING :token'])(
    'leaves %j alone',
    (line) => {
      expect(redactLine(line)).toBe(line);
    },
  );
});

describe('redactValue', () => {
  it('hides secrets at any depth, and keeps a DCC token, which is public', () => {
    const shown = redactValue({
      remoteToken: 'abc',
      nested: { password: 'p', saslPass: 's', fine: 1, list: [{ authToken: 't', token: 'dcc7' }] },
      remoteUrl: 'nas:6789',
    });
    expect(shown).toEqual({
      remoteToken: '«hidden»',
      nested: { password: '«hidden»', saslPass: '«hidden»', fine: 1, list: [{ authToken: '«hidden»', token: 'dcc7' }] },
      remoteUrl: 'nas:6789',
    });
  });

  it('leaves an empty secret as it is, so "not set" can be told from "set"', () => {
    expect(redactValue({ password: '', remoteToken: undefined })).toEqual({ password: '', remoteToken: undefined });
  });

  it('checks a raw line wherever it sits', () => {
    expect(redactValue({ action: 'send', line: 'PRIVMSG NickServ :identify hunter2' })).toEqual({
      action: 'send',
      line: 'PRIVMSG NickServ :identify «hidden»',
    });
  });
});

describe('redactArgs', () => {
  it('hides the SASL login, SASL password and server password of a connect, by position', () => {
    const args = [
      's1',
      'irc.example',
      6697,
      'nick',
      true,
      'saslUser',
      'saslPass',
      'user',
      'real',
      ['alt'],
      'serverPass',
    ];
    expect(redactArgs(IrcMessages.connect, args)).toEqual([
      's1',
      'irc.example',
      6697,
      'nick',
      true,
      '«hidden»',
      '«hidden»',
      'user',
      'real',
      ['alt'],
      '«hidden»',
    ]);
  });

  it('hides a password typed to services, and the token inside saved settings', () => {
    expect(redactArgs(IrcMessages.send, ['s1', 'PRIVMSG NickServ :IDENTIFY hunter2'])).toEqual([
      's1',
      'PRIVMSG NickServ :IDENTIFY «hidden»',
    ]);
    expect(redactArgs(IrcMessages.setSettings, [{ remoteUrl: 'nas:6789', remoteToken: 'tok' }])).toEqual([
      { remoteUrl: 'nas:6789', remoteToken: '«hidden»' },
    ]);
  });
});

describe('redactFrame', () => {
  it('hides the access token of an auth frame', () => {
    expect(JSON.parse(redactFrame('{"id":"1","action":"auth","authToken":"9b14e5594bf8"}'))).toEqual({
      id: '1',
      action: 'auth',
      authToken: '«hidden»',
    });
  });

  it('hides credentials in a connect frame, and a services password in a send frame', () => {
    const connect = JSON.parse(redactFrame('{"action":"connect","host":"h","saslPass":"s","password":"p","nick":"n"}'));
    expect(connect).toMatchObject({ saslPass: '«hidden»', password: '«hidden»', nick: 'n' });
    expect(redactFrame('{"action":"send","line":"PRIVMSG NickServ :identify x"}')).toContain('identify «hidden»');
  });

  it('passes on what is not JSON', () => {
    expect(redactFrame('not json')).toBe('not json');
  });
});

describe('the trace', () => {
  it('shortens a long payload and says by how much', () => {
    expect(shorten('x'.repeat(10), 20)).toBe('x'.repeat(10));
    expect(shorten('x'.repeat(30), 20)).toBe(`${'x'.repeat(20)}… (+10 characters)`);
  });

  it('marks each line with its layer and its direction', () => {
    expect(formatTrace(AT, 'window → main', 'irc:getStatus ["s1"]')).toMatch(
      /^\d\d:\d\d:\d\d\.\d{3} \[ipc\]\s+window → main\s+irc:getStatus \["s1"\]$/,
    );
    expect(formatTrace(AT, 'app → backend', '{"id":"1"}')).toMatch(/\[backend\] app → backend\s+\{"id":"1"\}$/);
  });

  it('prints a frame without its secret, and what is pushed to the window', () => {
    const out: string[] = [];
    traceFrame(
      (l) => out.push(l),
      'app → backend',
      '{"id":"1","action":"auth","authToken":"secret"}\n',
      () => AT,
    );
    traceWindowSend(
      (l) => out.push(l),
      IrcMessages.line,
      ['s1', ':srv NOTICE * :hi'],
      () => AT,
    );
    expect(out[0]).toContain('"authToken":"«hidden»"');
    expect(out[0]).not.toContain('secret');
    expect(out[1]).toContain('irc:line ["s1",":srv NOTICE * :hi"]');
  });
});

describe('installIpcTap', () => {
  function setup() {
    const handlers = new Map<string, (event: unknown, ...args: unknown[]) => unknown>();
    const ipc = { handle: (c: string, l: (event: unknown, ...args: unknown[]) => unknown) => void handlers.set(c, l) };
    const out: string[] = [];
    installIpcTap(
      ipc as never,
      (l) => out.push(l),
      () => AT,
    );
    return { ipc, handlers, out };
  }

  it('prints each call and its answer in order, and answers exactly as before', async () => {
    const { ipc, handlers, out } = setup();
    ipc.handle(IrcMessages.getStatus, (_e, serverId) => (serverId === 's1' ? 'connected' : 'disconnected'));
    const answer = await handlers.get(IrcMessages.getStatus)?.({}, 's1');
    expect(answer).toBe('connected');
    expect(out).toHaveLength(2);
    expect(out[0]).toMatch(/window → main\s+irc:getStatus \["s1"\]$/);
    expect(out[1]).toMatch(/main → window\s+reply to irc:getStatus: "connected"$/);
  });

  it('prints a failure and rethrows the same error', async () => {
    const { ipc, handlers, out } = setup();
    const boom = new Error('backend not connected');
    ipc.handle(IrcMessages.getHistory, () => {
      throw boom;
    });
    await expect(handlers.get(IrcMessages.getHistory)?.({}, 's1', '#c')).rejects.toBe(boom);
    expect(out[1]).toContain('irc:getHistory failed: backend not connected');
  });

  it('never prints a password or a token it was handed', async () => {
    const { ipc, handlers, out } = setup();
    ipc.handle(IrcMessages.connect, () => undefined);
    ipc.handle(IrcMessages.setSettings, () => undefined);
    await handlers.get(IrcMessages.connect)?.(
      {},
      's1',
      'h',
      6697,
      'n',
      true,
      'user1',
      'saslSecret',
      'u',
      'r',
      [],
      'serverSecret',
    );
    await handlers.get(IrcMessages.setSettings)?.({}, { remoteToken: 'tokenSecret' });
    const all = out.join('\n');
    for (const secret of ['user1', 'saslSecret', 'serverSecret', 'tokenSecret']) expect(all).not.toContain(secret);
  });
});
