import type { Channel, Message } from '../types';

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

// An older page is fetched only after the latest one landed, never while
// another is loading, and not once history runs out. The view keeps asking
// while it does not fill, so these are what end that.
export function canLoadOlder(page: HistoryPage | undefined): page is HistoryPage {
  return !!page && !page.loading && !page.exhausted && page.oldestId !== null;
}

// The lines to store when a fetch for page lands, or null when reloadHistory
// or a close replaced the page meanwhile. A page with nothing to show is still
// stored, so the view re-renders and can ask for the next one.
export function linesToStore(
  pages: Map<string, HistoryPage>,
  key: string,
  page: HistoryPage,
  messages: Message[],
): Message[] | null {
  return pages.get(key) === page ? messages : null;
}
