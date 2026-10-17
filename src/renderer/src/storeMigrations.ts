// Versioning for the persisted store (localStorage key "dolq", written by
// zustand's persist middleware).
//
// Changing the shape of anything in `partialize`:
//   - Additive and optional (a new field with a default)? Nothing to do.
//   - Renamed, reshaped, retyped or removed? Bump STORE_VERSION by one and add
//     `migrations[<old version>]`, which turns a stored state of the old version
//     into one of the next. Return null to drop everything stored instead (the
//     app then starts from its defaults), or delete just the keys that cannot be
//     carried over and keep the rest.
//
// Stored data is flushed, never guessed at, when it cannot be brought up to date:
// a version newer than this build knows (a downgrade), a missing step, or a
// migration that throws.

export type PersistedState = Record<string, unknown>;
export type Migration = (state: PersistedState) => PersistedState | null;

export const STORE_VERSION = 1;

export const migrations: Record<number, Migration> = {
  // 0 -> 1: channel `joined` used to be saved, but it is live connection state.
  0: (state) => {
    if (!state.channelMap || typeof state.channelMap !== 'object') return state;
    const channelMap = Object.fromEntries(
      Object.entries(state.channelMap as Record<string, unknown>).map(([serverId, channels]) => [
        serverId,
        Array.isArray(channels)
          ? channels.map((c) => {
              const { joined: _, ...rest } = c as Record<string, unknown>;
              return rest;
            })
          : channels,
      ]),
    );
    return { ...state, channelMap };
  },
};

// Brings `persisted`, saved at `from`, up to `target` one step at a time.
// An empty object means "start fresh": persist merges it over the defaults.
export function migrateState(
  persisted: unknown,
  from: number,
  target: number,
  table: Record<number, Migration>,
): PersistedState {
  if (!persisted || typeof persisted !== 'object' || from > target) return {};
  let state = persisted as PersistedState;
  for (let v = from; v < target; v++) {
    const step = table[v];
    if (!step) return {};
    try {
      const next = step(state);
      if (next === null) return {};
      state = next;
    } catch (err) {
      console.warn(`store: migration ${v} -> ${v + 1} failed, starting fresh`, err);
      return {};
    }
  }
  return state;
}

export function migrateStore(persisted: unknown, from: number): PersistedState {
  return migrateState(persisted, from, STORE_VERSION, migrations);
}
