type Place = {
  view: 'chat' | 'dashboard' | 'connect' | 'preferences' | 'editServer';
  hasServers: boolean;
  serverName?: string;
  channel?: { name: string; isLog: boolean; isQuery?: boolean };
};

/** The title for the strip on top: where you are. */
export function locationTitle({ view, hasServers, serverName, channel }: Place): string {
  if (view === 'dashboard') return 'Dashboard';
  if (view === 'preferences') return 'Preferences';
  if (view === 'connect') return 'Add server';
  if (view === 'editServer') return 'Edit server';
  if (!hasServers || !channel) return 'Dolq';
  const where = channel.isLog ? 'Server log' : channel.isQuery ? `@${channel.name}` : `#${channel.name}`;
  return serverName ? `${where} · ${serverName}` : where;
}
