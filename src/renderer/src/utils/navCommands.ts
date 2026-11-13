export type PreferencesTabName = 'general' | 'appearance' | 'notifications' | 'keybindings' | 'backend';

export type NavAction =
  | { kind: 'transfers' | 'dashboard' | 'addServer' | 'editServer' | 'members' | 'log' | 'back' | 'forward' }
  | { kind: 'next' | 'prev' | 'mute' | 'close' }
  | { kind: 'search'; scope: 'channel' | 'everywhere' }
  | { kind: 'preferences'; tab?: PreferencesTabName }
  | { kind: 'goto'; channelId: string }
  | { kind: 'server'; serverId: string }
  | { kind: 'error'; text: string };

type Named = { id: string; name: string };

const PREFERENCE_TABS: PreferencesTabName[] = ['general', 'appearance', 'notifications', 'keybindings', 'backend'];

const SIMPLE: Record<string, NavAction> = {
  transfers: { kind: 'transfers' },
  dashboard: { kind: 'dashboard' },
  addserver: { kind: 'addServer' },
  editserver: { kind: 'editServer' },
  members: { kind: 'members' },
  log: { kind: 'log' },
  back: { kind: 'back' },
  forward: { kind: 'forward' },
  next: { kind: 'next' },
  prev: { kind: 'prev' },
  mute: { kind: 'mute' },
  close: { kind: 'close' },
  search: { kind: 'search', scope: 'channel' },
  searchall: { kind: 'search', scope: 'everywhere' },
};

// What a name or number picks out of a list: an exact match first, then a unique start of one.
function pick<T extends Named>(items: T[], query: string, label: (t: T) => string): T | string {
  const q = query.replace(/^[#@]/, '').toLowerCase();
  if (/^\d+$/.test(q) && items[Number(q) - 1]) return items[Number(q) - 1];
  const exact = items.filter((i) => i.name.toLowerCase().replace(/^#/, '') === q);
  if (exact.length === 1) return exact[0];
  const starts = items.filter((i) => i.name.toLowerCase().replace(/^#/, '').startsWith(q));
  if (starts.length === 1) return starts[0];
  if (starts.length > 1) return `"${query}" fits more than one: ${starts.map(label).join(', ')}.`;
  return `Nothing is open that matches "${query}".`;
}

// Slash commands that move around the app instead of talking to the server; null for anything else.
export function resolveNavCommand(text: string, servers: Named[], channels: Named[]): NavAction | null {
  const m = /^\/(\S+)(?:\s+(.*))?$/.exec(text.trim());
  if (!m) return null;
  const name = m[1].toLowerCase();
  const arg = (m[2] ?? '').trim();
  if (name in SIMPLE && !arg) return SIMPLE[name];
  if (['preferences', 'prefs', 'settings'].includes(name)) {
    if (!arg) return { kind: 'preferences' };
    const tab = PREFERENCE_TABS.find((t) => t === arg.toLowerCase());
    return tab ? { kind: 'preferences', tab } : { kind: 'error', text: `Tabs: ${PREFERENCE_TABS.join(', ')}.` };
  }
  if (['goto', 'go', 'window', 'w'].includes(name)) {
    if (!arg) return { kind: 'error', text: 'Say which chat: /goto #channel, a nick or its number in the list.' };
    const hit = pick(channels, arg, (c) => c.name);
    return typeof hit === 'string' ? { kind: 'error', text: hit } : { kind: 'goto', channelId: hit.id };
  }
  if (name === 'server') {
    if (!arg) return { kind: 'error', text: 'Say which server: /server name or its number in the list.' };
    const hit = pick(servers, arg, (s) => s.name);
    return typeof hit === 'string' ? { kind: 'error', text: hit } : { kind: 'server', serverId: hit.id };
  }
  return null;
}
