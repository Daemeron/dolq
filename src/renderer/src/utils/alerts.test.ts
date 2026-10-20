import { describe, expect, it } from 'vitest';
import { type AlertInput, shouldAlert } from './alerts';

const base: AlertInput = {
  target: '#linux',
  channelId: '#linux',
  selectedChannelId: '#other',
  muted: false,
  windowFocused: true,
  mentioned: true,
};

describe('shouldAlert', () => {
  it('alerts for a mention in a channel that is not on screen', () => {
    expect(shouldAlert(base)).toBe(true);
  });

  it('stays quiet without a mention, or when muted', () => {
    expect(shouldAlert({ ...base, mentioned: false })).toBe(false);
    expect(shouldAlert({ ...base, muted: true })).toBe(false);
  });

  it('stays quiet for the selected channel only while the window has focus', () => {
    const selected = { ...base, selectedChannelId: '#linux' };
    expect(shouldAlert(selected)).toBe(false);
    expect(shouldAlert({ ...selected, windowFocused: false })).toBe(true);
  });

  it('alerts for private messages without needing a mention', () => {
    expect(shouldAlert({ ...base, target: 'me', channelId: 'bob', mentioned: false })).toBe(true);
  });
});
