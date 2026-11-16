const MARGIN = 4;

/**
 * Where a menu opened at the pointer goes: with its corner at the pointer, or when it would run off the window the
 * other way round, with the opposite corner there; and in any case inside the window.
 */
export function placeMenu(
  pointer: { x: number; y: number },
  menu: { width: number; height: number },
  view: { width: number; height: number },
): { left: number; top: number } {
  const place = (at: number, size: number, max: number) => {
    const start = at + size + MARGIN > max ? at - size : at;
    return Math.max(MARGIN, Math.min(start, max - size - MARGIN));
  };
  return { left: place(pointer.x, menu.width, view.width), top: place(pointer.y, menu.height, view.height) };
}
