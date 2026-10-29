import { describe, expect, it } from 'vitest';
import { locationTitle } from './locationTitle';

const base = { hasServers: true, serverName: 'Libera' };

describe('locationTitle', () => {
  it('names the page for the non-chat views', () => {
    expect(locationTitle({ ...base, view: 'dashboard' })).toBe('Dashboard');
    expect(locationTitle({ ...base, view: 'preferences' })).toBe('Preferences');
    expect(locationTitle({ ...base, view: 'connect' })).toBe('Add server');
    expect(locationTitle({ ...base, view: 'editServer' })).toBe('Edit server');
  });

  it('names a channel, a conversation or the log, with its server', () => {
    expect(locationTitle({ ...base, view: 'chat', channel: { name: 'dolq', isLog: false } })).toBe('#dolq · Libera');
    expect(locationTitle({ ...base, view: 'chat', channel: { name: 'mira', isLog: false, isQuery: true } })).toBe(
      '@mira · Libera',
    );
    expect(locationTitle({ ...base, view: 'chat', channel: { name: 'Log', isLog: true } })).toBe('Server log · Libera');
    expect(locationTitle({ view: 'chat', hasServers: true, channel: { name: 'dolq', isLog: false } })).toBe('#dolq');
  });

  it('is just the app name with nothing selected', () => {
    expect(locationTitle({ view: 'chat', hasServers: false })).toBe('Dolq');
    expect(locationTitle({ ...base, view: 'chat' })).toBe('Dolq');
  });
});
