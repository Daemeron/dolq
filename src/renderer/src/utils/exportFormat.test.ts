import { describe, it, expect } from 'vitest';
import { formatEntry } from './exportFormat';
import type { HistoryEntry } from '../../../shared/ipc';

const ts = '2026-01-01T00:00:00.000Z';

function entry(partial: Partial<HistoryEntry>): HistoryEntry {
  return { id: 1, serverId: 'srv', channel: '#general', timestamp: ts, ...partial };
}

describe('formatEntry', () => {
  it('formats a raw line verbatim', () => {
    expect(formatEntry(entry({ isRaw: true, line: ':server NOTICE * :hi' }))).toBe(
      `[${ts}] :server NOTICE * :hi`,
    );
  });

  it('formats a PRIVMSG as <nick> text', () => {
    expect(formatEntry(entry({ event: { type: 'PRIVMSG', nick: 'alice', target: '#general', text: 'hello' } }))).toBe(
      `[${ts}] <alice> hello`,
    );
  });

  it('formats an ACTION as * nick text', () => {
    expect(formatEntry(entry({ event: { type: 'ACTION', nick: 'alice', target: '#general', text: 'waves' } }))).toBe(
      `[${ts}] * alice waves`,
    );
  });

  it('formats a PART with a reason', () => {
    expect(formatEntry(entry({ event: { type: 'PART', nick: 'alice', channel: '#general', reason: 'bye' } }))).toBe(
      `[${ts}] alice left #general (bye)`,
    );
  });

  it('formats a PART without a reason', () => {
    expect(formatEntry(entry({ event: { type: 'PART', nick: 'alice', channel: '#general' } }))).toBe(
      `[${ts}] alice left #general`,
    );
  });

  it('falls back to raw JSON for an event type without a dedicated format', () => {
    expect(
      formatEntry(entry({ event: { type: 'names', channel: '#general', users: [] } })),
    ).toBe(`[${ts}] ${JSON.stringify({ type: 'names', channel: '#general', users: [] })}`);
  });
});
