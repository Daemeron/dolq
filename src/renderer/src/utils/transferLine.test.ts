import { describe, expect, it } from 'vitest';
import { activeLine, transferPercent } from './transferLine';

const t = { nick: 'bot', received: 512, total: 2048 };

describe('transferPercent', () => {
  it('rounds, caps at 100 and is 0 for an unknown size', () => {
    expect(transferPercent(t)).toBe(25);
    expect(transferPercent({ received: 9, total: 3 })).toBe(100);
    expect(transferPercent({ received: 5, total: 0 })).toBe(0);
  });
});

describe('activeLine', () => {
  it('shows the sender, progress and speed of a download', () => {
    expect(activeLine({ ...t, speedBps: 1024 })).toBe('bot · 25% of 2.0 KB · 1.0 KB/s');
    expect(activeLine(t)).toBe('bot · 25% of 2.0 KB');
  });

  it('says so when paused', () => {
    expect(activeLine({ ...t, paused: true })).toBe('bot · 25% of 2.0 KB · paused');
  });

  it('describes a file going out, or still waiting for the other side', () => {
    expect(activeLine({ ...t, sending: true })).toBe('Sending to bot · 25% of 2.0 KB');
    expect(activeLine({ nick: 'bot', received: 0, total: 0, sending: true })).toBe('Waiting for bot to connect');
  });
});
