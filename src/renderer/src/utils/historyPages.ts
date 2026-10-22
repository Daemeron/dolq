import type { Channel } from '../types';

// How far back one channel's history has been loaded.
export type HistoryPage = {
  serverId: string;
  channelId: string;
  oldestId: number | null;
  exhausted: boolean;
  loading: boolean;
};

// A removed server's pages would otherwise make a re-added one skip its first load.
export function dropServerPages(pages: Map<string, HistoryPage>, serverId: string): void {
  for (const [key, page] of pages) {
    if (page.serverId === serverId) pages.delete(key);
  }
}

// The pages to fetch again after a redial. Pages of channels that were closed
// are dropped, and DCC chats keep no history so theirs stay as they are.
export function pagesToReload(pages: Map<string, HistoryPage>, channelMap: Record<string, Channel[]>): HistoryPage[] {
  const reload: HistoryPage[] = [];
  for (const [key, page] of pages) {
    const c = channelMap[page.serverId]?.find((ch) => ch.id === page.channelId);
    if (!c) pages.delete(key);
    else if (!c.isDCC) reload.push(page);
  }
  return reload;
}
