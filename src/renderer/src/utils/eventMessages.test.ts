import { describe, expect, it } from 'vitest';
import { describeEvent, eventChannels } from './eventMessages';

describe('describeEvent', () => {
  it('marks other users joining, leaving, quitting and renaming as membership lines', () => {
    expect(describeEvent({ type: 'JOIN', nick: 'alice', channel: '#a' }, 'me')).toEqual({
      text: 'alice joined',
      membership: true,
    });
    expect(describeEvent({ type: 'PART', nick: 'alice', channel: '#a', reason: 'bye' }, 'me')).toEqual({
      text: 'alice left (bye)',
      membership: true,
    });
    expect(describeEvent({ type: 'QUIT', nick: 'alice', reason: 'Ping timeout' }, 'me')).toEqual({
      text: 'alice quit (Ping timeout)',
      membership: true,
    });
    expect(describeEvent({ type: 'NICK', oldNick: 'alice', newNick: 'alicia' }, 'me')).toEqual({
      text: 'alice is now known as alicia',
      membership: true,
    });
  });

  it('never marks your own events as hideable membership noise', () => {
    expect(describeEvent({ type: 'JOIN', nick: 'me', channel: '#a' }, 'me')).toEqual({ text: 'You joined #a' });
    expect(describeEvent({ type: 'NICK', oldNick: 'me', newNick: 'me2' }, 'me')).toEqual({
      text: 'You are now known as me2',
    });
  });

  it('describes kicks, modes, topics and system notices', () => {
    expect(describeEvent({ type: 'KICK', by: 'op', channel: '#a', nick: 'bob', reason: 'spam' }, 'me')?.text).toBe(
      'bob was kicked by op (spam)',
    );
    expect(describeEvent({ type: 'KICK', by: 'op', channel: '#a', nick: 'me' }, 'me')?.text).toBe(
      'You were kicked by op',
    );
    expect(
      describeEvent(
        {
          type: 'MODE',
          by: 'op',
          channel: '#a',
          changes: [
            { nick: 'bob', privilege: 'op', granted: true },
            { nick: 'carol', privilege: 'voice', granted: false },
          ],
        },
        'me',
      )?.text,
    ).toBe('op sets mode +o bob -v carol');
    expect(describeEvent({ type: 'TOPIC', channel: '#a', topic: 'hi', nick: 'op' }, 'me')?.text).toBe(
      'op changed the topic to: hi',
    );
    expect(describeEvent({ type: 'TOPIC', channel: '#a', topic: 'hi' }, 'me')?.text).toBe('Topic: hi');
    expect(describeEvent({ type: 'SYSTEM', channel: '#a', text: 'Disconnected' }, 'me')?.text).toBe('Disconnected');
  });

  it('ignores events that do not belong in a channel', () => {
    expect(describeEvent({ type: 'WELCOME', nick: 'me' }, 'me')).toBeNull();
  });
});

describe('eventChannels', () => {
  it('uses the channel an event names, or the shared channels for QUIT and NICK', () => {
    expect(eventChannels({ type: 'JOIN', nick: 'a', channel: '#x' })).toEqual(['#x']);
    expect(eventChannels({ type: 'QUIT', nick: 'a', channels: ['#x', '#y'] })).toEqual(['#x', '#y']);
    expect(eventChannels({ type: 'NICK', oldNick: 'a', newNick: 'b' })).toEqual([]);
    expect(eventChannels({ type: 'WELCOME', nick: 'a' })).toEqual([]);
  });
});
