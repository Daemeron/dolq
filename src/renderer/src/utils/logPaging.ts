// The Log hides channel traffic, and older databases still hold channel lines
// there, so a page of its history can come back nearly empty. With too few
// lines to scroll, no scroll ever asks for the next page; keep fetching older
// pages until there is something to show.
export const LOG_MIN_MESSAGES = 30;
export const LOG_MAX_PAGES = 20;

export function wantsAnotherLogPage(forLog: boolean, shown: number, pagesFetched: number, exhausted: boolean): boolean {
  return forLog && !exhausted && shown < LOG_MIN_MESSAGES && pagesFetched < LOG_MAX_PAGES;
}
