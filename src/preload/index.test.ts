import { beforeEach, describe, expect, it, vi } from 'vitest';
import { IrcMessages } from '../shared/ipc';

const electron = vi.hoisted(() => ({
  exposed: {} as Record<string, unknown>,
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
}));

vi.mock('electron', () => ({
  contextBridge: {
    exposeInMainWorld: (name: string, api: unknown) => {
      electron.exposed[name] = api;
    },
  },
  ipcRenderer: { invoke: electron.invoke, on: electron.on, removeListener: electron.removeListener },
}));

type Api = Record<string, (...args: unknown[]) => unknown>;
let api: Api;

beforeEach(async () => {
  electron.invoke.mockReset().mockResolvedValue('result');
  electron.on.mockReset();
  electron.removeListener.mockReset();
  vi.resetModules();
  await import('./index.js');
  api = electron.exposed.irc as Api;
});

describe('preload bridge: requests', () => {
  // Each renderer call must reach the channel main listens on, with its arguments in order.
  const cases: [string, unknown[], string][] = [
    ['connect', ['s', 'h', 1, 'n', true, 'u', 'p', 'user', 'real', ['alt'], 'pw'], IrcMessages.connect],
    ['secretsAvailable', [], IrcMessages.secretsAvailable],
    ['rememberSecrets', ['s', { password: 'p' }], IrcMessages.secretsRemember],
    ['forgetSecrets', ['s'], IrcMessages.secretsForget],
    ['disconnect', ['s'], IrcMessages.disconnect],
    ['getStatus', ['s'], IrcMessages.getStatus],
    ['getJoinedChannels', ['s'], IrcMessages.getJoinedChannels],
    ['getHistory', ['s', '#a', 1, 2], IrcMessages.getHistory],
    ['search', ['s', '#a', 'q', 3], IrcMessages.search],
    ['getSettings', [], IrcMessages.getSettings],
    ['setSettings', [{ retentionDays: 1 }], IrcMessages.setSettings],
    ['dccOffer', ['s', 'n'], IrcMessages.dccOffer],
    ['dccSendFile', ['s', 'n', '/tmp/a.iso'], IrcMessages.dccSendFile],
    ['chooseFile', [], IrcMessages.chooseFile],
    ['dccAccept', ['1.2.3.4', 5], IrcMessages.dccAccept],
    ['dccSend', ['d', 'l'], IrcMessages.dccSend],
    ['dccClose', ['d'], IrcMessages.dccClose],
    ['xdccAccept', ['s', 'n', 'ip', 1, 'f', 2, 't'], IrcMessages.xdccAccept],
    ['xdccClose', ['x'], IrcMessages.xdccClose],
    ['xdccPause', ['x'], IrcMessages.xdccPause],
    ['xdccResume', ['x'], IrcMessages.xdccResume],
    ['openExternal', ['https://example.org'], IrcMessages.openExternal],
    ['showInFolder', ['/tmp/a.iso'], IrcMessages.showInFolder],
    ['setTitleBar', ['#000000', '#ffffff'], IrcMessages.setTitleBar],
    ['saveTextFile', ['a.txt', 'body'], IrcMessages.saveTextFile],
    ['chooseDirectory', ['/tmp'], IrcMessages.chooseDirectory],
    ['setBadgeCount', [3], IrcMessages.setBadgeCount],
    ['setZoomFactor', [1.2], IrcMessages.setZoomFactor],
    ['playAlertSound', [], IrcMessages.playAlertSound],
  ];

  it.each(cases)('%s forwards its arguments to the right channel', async (method, args, channel) => {
    await expect(api[method](...args)).resolves.toBe('result');
    expect(electron.invoke).toHaveBeenCalledWith(channel, ...args);
  });

  it('sendLine forwards the line and logs a failed send instead of throwing', async () => {
    await api.sendLine('s', 'JOIN #a');
    expect(electron.invoke).toHaveBeenCalledWith(IrcMessages.send, 's', 'JOIN #a');

    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    electron.invoke.mockRejectedValueOnce(new Error('backend down'));
    await expect(api.sendLine('s', 'x')).resolves.toBeUndefined();
    expect(log).toHaveBeenCalled();
    log.mockRestore();
  });
});

describe('preload bridge: subscriptions', () => {
  const listeners: [string, string, unknown[]][] = [
    ['onLine', IrcMessages.line, ['s', ':line']],
    ['onEvent', IrcMessages.event, ['s', { type: 'JOIN' }]],
    ['onStatus', IrcMessages.status, ['s', 'connected']],
    ['onOpenIrcUrl', IrcMessages.openIrcUrl, [{ host: 'h', port: 1, secure: true }]],
    ['onOpenPreferences', IrcMessages.openPreferences, []],
    ['onBackendReconnected', IrcMessages.backendReconnected, []],
  ];

  it.each(listeners)('%s passes the payload without the IPC event, and unsubscribes', (method, channel, payload) => {
    const callback = vi.fn();
    const off = api[method](callback) as () => void;
    expect(electron.on).toHaveBeenCalledWith(channel, expect.any(Function));
    const handler = electron.on.mock.calls[0][1];
    handler({ ipc: 'event' }, ...payload);
    expect(callback).toHaveBeenCalledWith(...payload);
    off();
    expect(electron.removeListener).toHaveBeenCalledWith(channel, handler);
  });
});
