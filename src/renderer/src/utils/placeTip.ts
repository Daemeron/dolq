type Box = { left: number; top: number; width: number; height: number };

const GAP = 6;
const MARGIN = 4;

/** Where a tooltip goes: on its preferred side of the anchor, flipped when it would not fit, and always inside the window. */
export function placeTip(
  anchor: Box,
  tip: { width: number; height: number },
  view: { width: number; height: number },
  prefer: 'below' | 'right',
): { left: number; top: number } {
  const clamp = (v: number, size: number, max: number) => Math.max(MARGIN, Math.min(v, max - size - MARGIN));
  if (prefer === 'right') {
    const fits = anchor.left + anchor.width + GAP + tip.width + MARGIN <= view.width;
    const left = fits ? anchor.left + anchor.width + GAP : anchor.left - GAP - tip.width;
    return {
      left: clamp(left, tip.width, view.width),
      top: clamp(anchor.top + (anchor.height - tip.height) / 2, tip.height, view.height),
    };
  }
  const fits = anchor.top + anchor.height + GAP + tip.height + MARGIN <= view.height;
  const top = fits ? anchor.top + anchor.height + GAP : anchor.top - GAP - tip.height;
  return {
    left: clamp(anchor.left + (anchor.width - tip.width) / 2, tip.width, view.width),
    top: clamp(top, tip.height, view.height),
  };
}
