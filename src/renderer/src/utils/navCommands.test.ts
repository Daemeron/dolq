import { describe, expect, it } from 'vitest';
import { resolveNavCommand } from './navCommands';

const servers = [
  { id: 's1', name: 'Libera' },
  { id: 's2', name: 'Rizon' },
  { id: 's3', name: 'Rusnet' },
];
const channels = [
  { id: '__log__', name: 'Log' },
  { id: '#dolq', name: 'dolq' },
  { id: '#dolphins', name: 'dolphins' },
  { id: 'mira', name: 'mira' },
];
const run = (t: string) => resolveNavCommand(t, servers, channels);

describe('resolveNavCommand', () => {
  it('opens panels and views', () => {
    expect(run('/transfers')).toEqual({ kind: 'transfers' });
    expect(run('/dashboard')).toEqual({ kind: 'dashboard' });
    expect(run('/search')).toEqual({ kind: 'search', scope: 'channel' });
    expect(run('/searchall')).toEqual({ kind: 'search', scope: 'everywhere' });
    expect(run('/members')).toEqual({ kind: 'members' });
    expect(run('/BACK')).toEqual({ kind: 'back' });
  });

  it('opens preferences, on a tab when named', () => {
    expect(run('/prefs')).toEqual({ kind: 'preferences' });
    expect(run('/settings keybindings')).toEqual({ kind: 'preferences', tab: 'keybindings' });
    expect(run('/settings nope')).toMatchObject({ kind: 'error', text: expect.stringContaining('Tabs:') });
  });

  it('goes to a chat by exact name, start of a name or number', () => {
    expect(run('/goto #dolq')).toEqual({ kind: 'goto', channelId: '#dolq' });
    expect(run('/go mi')).toEqual({ kind: 'goto', channelId: 'mira' });
    expect(run('/w 3')).toEqual({ kind: 'goto', channelId: '#dolphins' });
    expect(run('/goto dol')).toMatchObject({ kind: 'error', text: expect.stringContaining('dolq, dolphins') });
    expect(run('/goto zzz')).toMatchObject({ kind: 'error' });
    expect(run('/goto')).toMatchObject({ kind: 'error' });
  });

  it('switches server', () => {
    expect(run('/server riz')).toEqual({ kind: 'server', serverId: 's2' });
    expect(run('/server ru')).toEqual({ kind: 'server', serverId: 's3' });
    expect(run('/server r')).toMatchObject({ kind: 'error' });
  });

  it('leaves everything else to the other handlers', () => {
    expect(run('/join #a')).toBeNull();
    expect(run('/transfers now')).toBeNull();
    expect(run('hello')).toBeNull();
  });
});
