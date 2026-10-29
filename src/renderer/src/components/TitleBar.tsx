/** The strip above the whole app: it drags the window and holds the window controls, and is where app-wide buttons can live. */
export function TitleBar() {
  return (
    <header
      // Off macOS the OS draws the window controls over the right end; on macOS the traffic lights take the left.
      className="titlebar-drag flex h-8 shrink-0 items-center border-b border-(--dolq-border) bg-(--dolq-bg-panel-alt) pr-[calc(100vw-env(titlebar-area-x,0px)-env(titlebar-area-width,100vw)+0.75rem)] pl-3 in-data-[platform=mac]:pl-20"
    >
      <span className="text-[12px] font-medium text-(--dolq-text-dim) select-none">Dolq</span>
    </header>
  );
}
