import { describe, expect, it, vi } from 'vitest';
import { type Migration, migrateState, migrateStore } from './storeMigrations';

const add =
  (key: string): Migration =>
  (s) => ({ ...s, [key]: true });

describe('migrateState', () => {
  it('runs every step from the stored version up to the target, in order', () => {
    const order: number[] = [];
    const table: Record<number, Migration> = {
      1: (s) => {
        order.push(1);
        return { ...s, a: 1 };
      },
      2: (s) => {
        order.push(2);
        return { ...s, b: (s.a as number) + 1 };
      },
    };
    expect(migrateState({ keep: 'x' }, 1, 3, table)).toEqual({ keep: 'x', a: 1, b: 2 });
    expect(order).toEqual([1, 2]);
  });

  it('only runs the steps it has not been through', () => {
    expect(migrateState({}, 2, 3, { 1: add('one'), 2: add('two') })).toEqual({ two: true });
  });

  it('leaves current data alone', () => {
    const state = { servers: [1] };
    expect(migrateState(state, 3, 3, {})).toBe(state);
  });

  it('flushes when a step returns null', () => {
    expect(migrateState({ a: 1 }, 0, 1, { 0: () => null })).toEqual({});
  });

  it('flushes when a step is missing', () => {
    expect(migrateState({ a: 1 }, 0, 2, { 0: add('x') })).toEqual({});
  });

  it('flushes when a step throws', () => {
    const boom: Migration = () => {
      throw new Error('bad shape');
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(migrateState({ a: 1 }, 0, 1, { 0: boom })).toEqual({});
    expect(warn).toHaveBeenCalledWith('store: migration 0 -> 1 failed, starting fresh', expect.any(Error));
    warn.mockRestore();
  });

  it('flushes data written by a newer build', () => {
    expect(migrateState({ a: 1 }, 5, 3, {})).toEqual({});
  });

  it('flushes when there is no stored object', () => {
    expect(migrateState(null, 0, 1, { 0: add('x') })).toEqual({});
    expect(migrateState('junk', 0, 1, { 0: add('x') })).toEqual({});
  });
});

describe('migrations from the unversioned store', () => {
  it('drops the saved joined flag from channels and keeps everything else', () => {
    const out = migrateStore(
      {
        servers: [{ id: 's' }],
        channelMap: {
          s: [
            { id: '#a', name: 'a', joined: true },
            { id: 'bob', name: 'bob', isQuery: true },
          ],
        },
      },
      0,
    );
    expect(out).toEqual({
      servers: [{ id: 's' }],
      channelMap: {
        s: [
          { id: '#a', name: 'a' },
          { id: 'bob', name: 'bob', isQuery: true },
        ],
      },
    });
  });

  it('copes with a store that has no channels yet', () => {
    expect(migrateStore({ servers: [] }, 0)).toEqual({ servers: [] });
  });
});
